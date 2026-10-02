#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { HomedataClient } from "../client.js";
import { isMain } from "../entry.js";
import { checkAppsChallenge, checkCallsPerMinute, noStoreOnErrors } from "../http.js";
import { VERSION } from "../index.js";
import { MinuteLimiter } from "../limiter.js";
import { AccountTools, DEFAULT_ACCOUNT_MCP_URL, DEFAULT_ISSUER, DEFAULT_RESOURCE, protectedResourceMetadata, type AccountSettings } from "./account.js";
import { HomeClient } from "./client.js";
import { buildHomeServer } from "./server.js";

export interface HomeHttpOptions {
  client: HomeClient;
  mcpPath?: string;
  callsPerMinute?: number;
  enrichmentsPerMinute?: number;
  /** A proxy header trusted only when the deployment strips caller-supplied copies. */
  clientIpHeader?: string;
  /** The plugin portal's domain token, served at /.well-known/openai-apps-challenge; unset answers 404. */
  appsChallenge?: string;
  /**
   * Saved searches and price alerts on the user's home.co.uk account. When set,
   * the account tools are listed (oauth2), protected-resource metadata is
   * published, and a signed-in call is forwarded to atlas with its bearer.
   */
  account?: AccountSettings;
  /** Server-only Mapbox token. When absent the widget and HTTP surface expose no map. */
  mapboxToken?: string;
  mapsPerMinute?: number;
  mapOrigin?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}
const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));

async function read(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += (chunk as Buffer).length; if (size > 1_000_000) throw new Error("large"); chunks.push(chunk as Buffer); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

type ToolCall = { name: unknown; arguments: unknown };

function toolCalls(body: unknown): ToolCall[] {
  return (Array.isArray(body) ? body : [body])
    .filter((message) => (message as { method?: unknown })?.method === "tools/call")
    .map((message) => {
      const params = (message as { params?: { name?: unknown; arguments?: unknown } }).params;
      return { name: params?.name, arguments: params?.arguments };
    });
}

class CallerLimits {
  private readonly byCaller = new Map<string, MinuteLimiter>();
  constructor(private readonly limit: number, private readonly now: () => number) {}

  take(caller: string, count: number): boolean {
    let limiter = this.byCaller.get(caller);
    if (!limiter) {
      if (this.byCaller.size >= 10_000) this.byCaller.clear();
      limiter = new MinuteLimiter(this.limit, this.now);
      this.byCaller.set(caller, limiter);
    }
    for (let i = 0; i < count; i++) if (!limiter.take()) return false;
    return true;
  }
}

function callerAddress(req: IncomingMessage, trustedHeader?: string): string {
  if (trustedHeader) {
    const value = req.headers[trustedHeader.toLowerCase()];
    if (typeof value === "string" && isIP(value.trim())) return value.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** The caller's bearer token, or null. Never logged: it only ever goes to atlas. */
function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  const match = typeof header === "string" ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match ? match[1]! : null;
}

function enrichmentUnits(call: ToolCall): number {
  if (call.name === "get_home") return 1;
  if (call.name !== "compare_homes") return 0;
  const ids = (call.arguments as { listing_ids?: unknown } | null)?.listing_ids;
  return Array.isArray(ids) ? Math.max(1, ids.length) : 1;
}

/** Turns the transport's 200 into a 401 with WWW-Authenticate once a call's token was refused. */
function challengeOnRefusal(res: ServerResponse, challenge: () => string | undefined): void {
  const writeHead = res.writeHead.bind(res) as (status: number, ...rest: unknown[]) => ServerResponse;
  res.writeHead = ((status: number, ...rest: unknown[]) => {
    const header = challenge();
    if (header !== undefined && status === 200) {
      res.setHeader("WWW-Authenticate", header);
      status = 401;
    }
    return writeHead(status, ...rest);
  }) as typeof res.writeHead;
}

const mapCache = new Map<string, { body: Uint8Array; contentType: string }>();

function mapboxRequest(requestUrl: URL, token: string): URL | null {
  const raw = requestUrl.searchParams.get("points");
  const theme = requestUrl.searchParams.get("theme") === "dark" ? "dark-v11" : "light-v11";
  if (!raw || raw.length > 2_000) return null;
  const points = raw.split(";").map((part) => part.split(",").map(Number));
  if (!points.length || points.length > 20 || points.some(([lat, lon]) => !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat!) > 85 || Math.abs(lon!) > 180)) return null;
  const overlay = encodeURIComponent(JSON.stringify({
    type: "FeatureCollection",
    features: points.map(([latitude, longitude]) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [longitude, latitude] },
      properties: { "marker-color": "#111827", "marker-size": "small" },
    })),
  }));
  const mapbox = new URL(`https://api.mapbox.com/styles/v1/mapbox/${theme}/static/geojson(${overlay})/auto/900x520@2x`);
  mapbox.searchParams.set("padding", "64");
  mapbox.searchParams.set("access_token", token);
  return mapbox;
}

/**
 * The same stateless Streamable HTTP shape as the Homedata app. Search tools
 * are no-auth; the account tools need a home.co.uk sign-in, which atlas checks.
 */
export function createHomeHttpHandler(options: HomeHttpOptions) {
  const path = options.mcpPath ?? "/mcp";
  if (!path.startsWith("/")) throw new Error("HOME_MCP_PATH must start with /");
  const now = options.now ?? Date.now;
  const callLimits = new CallerLimits(options.callsPerMinute ?? 30, now);
  const enrichmentLimits = new CallerLimits(options.enrichmentsPerMinute ?? 4, now);
  const mapLimits = new CallerLimits(options.mapsPerMinute ?? 20, now);
  const account = options.account ? new AccountTools(options.account, options.client) : undefined;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    noStoreOnErrors(res);
    const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
    if (requestPath === "/healthz") return void send(res, 200, { ok: true, service: "home", version: VERSION });
    if (requestPath === "/maps/static") {
      if (req.method !== "GET" || !options.mapboxToken) return void send(res, 404, { error: "not_found" });
      const upstream = mapboxRequest(new URL(req.url ?? "/", "http://localhost"), options.mapboxToken);
      if (!upstream) return void send(res, 400, { error: "invalid_map_points" });
      const key = upstream.pathname + upstream.searchParams.get("padding");
      let image = mapCache.get(key);
      if (!image) {
        const caller = callerAddress(req, options.clientIpHeader);
        if (!mapLimits.take(caller, 1)) return void send(res, 429, { error: "too_many_map_requests" }, { "Retry-After": "60" });
        const response = await (options.fetchImpl ?? fetch)(upstream, {
          headers: { Accept: "image/avif,image/webp,image/png" },
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) return void send(res, 502, { error: "map_unavailable" }, { "Cache-Control": "no-store" });
        image = { body: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "image/png" };
        if (mapCache.size >= 200) mapCache.delete(mapCache.keys().next().value!);
        mapCache.set(key, image);
      }
      res.writeHead(200, { "Content-Type": image.contentType, "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800", "X-Content-Type-Options": "nosniff" });
      return void res.end(image.body);
    }
    if (requestPath === "/.well-known/openai-apps-challenge") {
      if (!options.appsChallenge) return void send(res, 404, { error: "not_found" });
      // Exactly the token: OpenAI rejects JSON, a list or a trailing newline.
      return void res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end(options.appsChallenge);
    }
    // RFC 9728, at the root and with the MCP path appended. Never cached, so a
    // change to the OAuth settings takes effect at once.
    if (options.account && req.method === "GET" &&
        (requestPath === "/.well-known/oauth-protected-resource" || requestPath === `/.well-known/oauth-protected-resource${path}`)) {
      return void send(res, 200, protectedResourceMetadata(options.account), { "Cache-Control": "no-store" });
    }
    if (requestPath !== path) return void send(res, 404, { error: "not_found" });
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return void send(res, 405, { error: "method_not_allowed" }); }
    let body: unknown;
    try { body = await read(req); } catch { return void send(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }); }
    const calls = toolCalls(body);
    const caller = callerAddress(req, options.clientIpHeader);
    const enrichmentCount = calls.reduce((total, call) => total + enrichmentUnits(call), 0);
    if ((calls.length && !callLimits.take(caller, calls.length)) ||
        (enrichmentCount && !enrichmentLimits.take(caller, enrichmentCount))) {
      return void send(res, 429, { jsonrpc: "2.0", error: { code: -32000, message: "Too many requests. Try again in a minute." }, id: null }, { "Retry-After": "60" });
    }
    // When atlas refuses the caller's token, the tool result carries the challenge
    // and the HTTP answer becomes a 401 with it, which is what makes ChatGPT ask
    // the user to reconnect. An unsigned call keeps a 200 with the challenge in
    // the result, as on the Homedata endpoint.
    let refused: string | undefined;
    challengeOnRefusal(res, () => refused);
    const server = buildHomeServer(
      options.client,
      account ? { tools: account, token: bearerToken(req), onRefused: (challenge) => { refused ??= challenge; } } : undefined,
      { mapsEnabled: Boolean(options.mapboxToken), mapOrigin: options.mapOrigin },
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}

/** An https URL with no query, fragment or credentials; http only for this machine. */
function checkUrl(name: string, raw: string, origin = false): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${name} must be an absolute URL`); }
  const local = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !local) || url.search || url.hash || url.username || url.password) throw new Error(`${name} must be an https URL with no query, fragment or credentials`);
  if (origin && url.pathname !== "/") throw new Error(`${name} must be an origin with no path, such as ${DEFAULT_RESOURCE}`);
  return origin ? url.origin : raw.replace(/\/+$/, "");
}

/** Account settings from the environment; HOME_ACCOUNTS=off lists the search tools only. */
export function accountFromEnv(env: NodeJS.ProcessEnv): AccountSettings | undefined {
  const switchValue = (env["HOME_ACCOUNTS"] ?? "").trim();
  if (switchValue === "off") return undefined;
  if (switchValue !== "" && switchValue !== "on") throw new Error("HOME_ACCOUNTS must be on or off");
  return {
    resource: checkUrl("HOME_MCP_RESOURCE", (env["HOME_MCP_RESOURCE"] ?? "").trim() || DEFAULT_RESOURCE, true),
    issuer: checkUrl("HOME_OAUTH_ISSUER", (env["HOME_OAUTH_ISSUER"] ?? "").trim() || DEFAULT_ISSUER),
    accountMcpUrl: checkUrl("HOME_ACCOUNT_MCP_URL", (env["HOME_ACCOUNT_MCP_URL"] ?? "").trim() || DEFAULT_ACCOUNT_MCP_URL),
  };
}

async function main(): Promise<void> {
  const apiKey = (process.env["HOMEDATA_API_KEY"] ?? "").trim();
  if (!apiKey) throw new Error("HOMEDATA_API_KEY is required for Home listing enrichment");
  const client = new HomeClient({
    homeBaseUrl: (process.env["HOME_BASE_URL"] ?? "").trim() || undefined,
    listingViewSecret: (process.env["HOME_MCP_LISTING_VIEW_SECRET"] ?? "").trim() || undefined,
    homedata: new HomedataClient({ apiKey, baseUrl: (process.env["HOMEDATA_BASE_URL"] ?? "").trim() || undefined, version: VERSION }),
  });
  const handler = createHomeHttpHandler({
    client,
    mcpPath: process.env["HOME_MCP_PATH"] || "/mcp",
    callsPerMinute: checkCallsPerMinute(process.env["MCP_CALLS_PER_MINUTE"]),
    enrichmentsPerMinute: checkCallsPerMinute(process.env["HOME_ENRICHMENTS_PER_MINUTE"] || "4"),
    mapsPerMinute: checkCallsPerMinute(process.env["HOME_MAPS_PER_MINUTE"] || "20"),
    clientIpHeader: (process.env["HOME_CLIENT_IP_HEADER"] ?? "").trim() || undefined,
    appsChallenge: checkAppsChallenge(process.env["OPENAI_APPS_CHALLENGE"]),
    account: accountFromEnv(process.env),
    mapboxToken: (process.env["MAPBOX_SECRET_TOKEN"] ?? "").trim() || undefined,
    mapOrigin: checkUrl("HOME_MCP_RESOURCE", (process.env["HOME_MCP_RESOURCE"] ?? "").trim() || DEFAULT_RESOURCE, true),
  });
  const port = Number(process.env["PORT"] || 4177); const host = process.env["HOST"] || "127.0.0.1";
  createServer((req, res) => void handler(req, res).catch((error) => { console.error("[home-mcp-http] request failed:", error); if (!res.headersSent) send(res, 500, { error: "internal_error" }); })).listen(port, host, () => console.error(`home-mcp-http ${VERSION} listening on http://${host}:${port}`));
}

if (isMain(import.meta.url)) void main().catch((error) => { console.error(`home-mcp-http: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
