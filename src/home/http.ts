#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { HomedataClient } from "../client.js";
import { isMain } from "../entry.js";
import { checkAppsChallenge, checkCallsPerMinute, noStoreOnErrors } from "../http.js";
import { VERSION } from "../index.js";
import { MinuteLimiter } from "../limiter.js";
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

function enrichmentUnits(call: ToolCall): number {
  if (call.name === "get_home") return 1;
  if (call.name !== "compare_homes") return 0;
  const ids = (call.arguments as { listing_ids?: unknown } | null)?.listing_ids;
  return Array.isArray(ids) ? Math.max(1, ids.length) : 1;
}

/** The same stateless Streamable HTTP shape as the Homedata app, for a public no-auth surface. */
export function createHomeHttpHandler(options: HomeHttpOptions) {
  const path = options.mcpPath ?? "/mcp";
  if (!path.startsWith("/")) throw new Error("HOME_MCP_PATH must start with /");
  const now = options.now ?? Date.now;
  const callLimits = new CallerLimits(options.callsPerMinute ?? 30, now);
  const enrichmentLimits = new CallerLimits(options.enrichmentsPerMinute ?? 4, now);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    noStoreOnErrors(res);
    const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
    if (requestPath === "/healthz") return void send(res, 200, { ok: true, service: "home", version: VERSION });
    if (requestPath === "/.well-known/openai-apps-challenge") {
      if (!options.appsChallenge) return void send(res, 404, { error: "not_found" });
      // Exactly the token: OpenAI rejects JSON, a list or a trailing newline.
      return void res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end(options.appsChallenge);
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
    const server = buildHomeServer(options.client);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}

async function main(): Promise<void> {
  const apiKey = (process.env["HOMEDATA_API_KEY"] ?? "").trim();
  if (!apiKey) throw new Error("HOMEDATA_API_KEY is required for Home listing enrichment");
  const client = new HomeClient({
    homeBaseUrl: (process.env["HOME_BASE_URL"] ?? "").trim() || undefined,
    homedata: new HomedataClient({ apiKey, baseUrl: (process.env["HOMEDATA_BASE_URL"] ?? "").trim() || undefined, version: VERSION }),
  });
  const handler = createHomeHttpHandler({
    client,
    mcpPath: process.env["HOME_MCP_PATH"] || "/mcp",
    callsPerMinute: checkCallsPerMinute(process.env["MCP_CALLS_PER_MINUTE"]),
    enrichmentsPerMinute: checkCallsPerMinute(process.env["HOME_ENRICHMENTS_PER_MINUTE"] || "4"),
    clientIpHeader: (process.env["HOME_CLIENT_IP_HEADER"] ?? "").trim() || undefined,
    appsChallenge: checkAppsChallenge(process.env["OPENAI_APPS_CHALLENGE"]),
  });
  const port = Number(process.env["PORT"] || 4177); const host = process.env["HOST"] || "127.0.0.1";
  createServer((req, res) => void handler(req, res).catch((error) => { console.error("[home-mcp-http] request failed:", error); if (!res.headersSent) send(res, 500, { error: "internal_error" }); })).listen(port, host, () => console.error(`home-mcp-http ${VERSION} listening on http://${host}:${port}`));
}

if (isMain(import.meta.url)) void main().catch((error) => { console.error(`home-mcp-http: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
