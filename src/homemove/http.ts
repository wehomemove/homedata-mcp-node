#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { HomedataClient } from "../client.js";
import { isMain } from "../entry.js";
import { checkAppsChallenge, checkCallsPerMinute, noStoreOnErrors } from "../http.js";
import { callerKey } from "../home/http.js";
import { VERSION } from "../index.js";
import { MinuteLimiter } from "../limiter.js";
import { DEFAULT_MOTUS_BASE_URL, MotusClient } from "./motus.js";
import { PropertyLookup } from "./property.js";
import { buildHomemoveServer } from "./server.js";
import { HOMEMOVE_WIDGET_ASSETS } from "./widget.js";

export const DEFAULT_HOMEMOVE_ORIGIN = "https://mcp.homemove.com";
export const CALL_LIMIT_TEXT = "Homemove has reached its request limit for the moment. Tell the user Homemove is busy right now and to try again in a minute. Do not retry straight away.";

export interface HomemoveHttpOptions {
  motus: MotusClient;
  property: PropertyLookup;
  mcpPath?: string;
  callsPerMinute?: number;
  clientIpHeader?: string;
  appsChallenge?: string;
  /** Public origin this endpoint is served from; the widget loads its art from here. */
  assetOrigin?: string;
  now?: () => number;
}

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
  res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));

async function read(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += (chunk as Buffer).length; if (size > 1_000_000) throw new Error("large"); chunks.push(chunk as Buffer); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function callerAddress(req: IncomingMessage, trustedHeader?: string): string {
  if (trustedHeader) {
    const value = req.headers[trustedHeader.toLowerCase()];
    if (typeof value === "string" && isIP(value.trim())) return value.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Stateless Streamable HTTP, no sign-in: quoting needs no account. motus applies its own per-principal limit too. */
export function createHomemoveHttpHandler(options: HomemoveHttpOptions) {
  const path = options.mcpPath ?? "/mcp";
  const now = options.now ?? Date.now;
  const limit = options.callsPerMinute ?? 30;
  const byCaller = new Map<string, MinuteLimiter>();
  const take = (caller: string, count: number) => {
    let limiter = byCaller.get(caller);
    if (!limiter) { if (byCaller.size >= 10_000) byCaller.clear(); limiter = new MinuteLimiter(limit, now); byCaller.set(caller, limiter); }
    for (let i = 0; i < count; i++) if (!limiter.take()) return false;
    return true;
  };
  const assetOrigin = options.assetOrigin ?? DEFAULT_HOMEMOVE_ORIGIN;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    noStoreOnErrors(res);
    const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
    const asset = HOMEMOVE_WIDGET_ASSETS.get(requestPath);
    if (asset) {
      if (req.method !== "GET" && req.method !== "HEAD") { res.setHeader("Allow", "GET, HEAD"); return void send(res, 405, { error: "method_not_allowed" }); }
      res.writeHead(200, {
        "Content-Type": asset.contentType,
        "Content-Length": String(asset.body.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      });
      return void res.end(req.method === "HEAD" ? undefined : asset.body);
    }
    if (requestPath === "/healthz") return void send(res, 200, { ok: true, service: "homemove", version: VERSION }, { "Cache-Control": "no-store" });
    if (requestPath === "/.well-known/openai-apps-challenge") {
      if (!options.appsChallenge) return void send(res, 404, { error: "not_found" });
      return void res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end(options.appsChallenge);
    }
    if (requestPath !== path) return void send(res, 404, { error: "not_found" });
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return void send(res, 405, { error: "method_not_allowed" }); }
    let body: unknown;
    try { body = await read(req); } catch { return void send(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }); }
    const calls = (Array.isArray(body) ? body : [body]).filter((m) => (m as { method?: unknown })?.method === "tools/call").length;
    if (calls && !take(callerKey(body, callerAddress(req, options.clientIpHeader)), calls)) {
      // A single call gets a tool answer the model can relay; ChatGPT's desktop client hangs on a 429.
      const single = !Array.isArray(body);
      return void (single
        ? send(res, 200, { jsonrpc: "2.0", id: (body as { id?: unknown }).id ?? null, result: { content: [{ type: "text", text: CALL_LIMIT_TEXT }], structuredContent: { available: false, limit_reached: true, reason: CALL_LIMIT_TEXT }, isError: true } })
        : send(res, 429, { jsonrpc: "2.0", error: { code: -32000, message: "Too many requests. Try again in a minute." }, id: null }, { "Retry-After": "60" }));
    }
    const server = buildHomemoveServer({ motus: options.motus, property: options.property, assetOrigin });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}

async function main(): Promise<void> {
  const apiKey = (process.env["HOMEDATA_API_KEY"] ?? "").trim();
  if (!apiKey) throw new Error("HOMEDATA_API_KEY is required for address lookups");
  const motus = new MotusClient({
    bearer: (process.env["HOMEMOVE_MCP_BEARER"] ?? "").trim(),
    baseUrl: (process.env["MOTUS_BASE_URL"] ?? "").trim() || DEFAULT_MOTUS_BASE_URL,
  });
  const property = new PropertyLookup(new HomedataClient({ apiKey, baseUrl: (process.env["HOMEDATA_BASE_URL"] ?? "").trim() || undefined, version: VERSION }));
  const handler = createHomemoveHttpHandler({
    motus,
    property,
    mcpPath: process.env["HOMEMOVE_MCP_PATH"] || "/mcp",
    callsPerMinute: checkCallsPerMinute(process.env["MCP_CALLS_PER_MINUTE"]),
    clientIpHeader: (process.env["HOMEMOVE_CLIENT_IP_HEADER"] ?? "").trim() || undefined,
    appsChallenge: checkAppsChallenge(process.env["OPENAI_APPS_CHALLENGE"]),
    assetOrigin: (process.env["HOMEMOVE_MCP_ORIGIN"] ?? "").trim() || DEFAULT_HOMEMOVE_ORIGIN,
  });
  const port = Number(process.env["PORT"] || 4178); const host = process.env["HOST"] || "127.0.0.1";
  createServer((req, res) => void handler(req, res).catch((error) => { console.error("[homemove-mcp-http] request failed:", error); if (!res.headersSent) send(res, 500, { error: "internal_error" }); }))
    .listen(port, host, () => console.error(`homemove-mcp-http ${VERSION} listening on http://${host}:${port}`));
}

if (isMain(import.meta.url)) void main().catch((error) => { console.error(`homemove-mcp-http: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
