#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { HomedataClient } from "../client.js";
import { isMain } from "../entry.js";
import { VERSION } from "../index.js";
import { MinuteLimiter } from "../limiter.js";
import { HomeClient } from "./client.js";
import { buildHomeServer } from "./server.js";

export interface HomeHttpOptions { client: HomeClient; mcpPath?: string; callsPerMinute?: number; now?: () => number }
const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));

async function read(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += (chunk as Buffer).length; if (size > 1_000_000) throw new Error("large"); chunks.push(chunk as Buffer); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** The same stateless Streamable HTTP shape as the Homedata app, for a public no-auth surface. */
export function createHomeHttpHandler(options: HomeHttpOptions) {
  const path = options.mcpPath ?? "/mcp";
  if (!path.startsWith("/")) throw new Error("HOME_MCP_PATH must start with /");
  const limiter = new MinuteLimiter(options.callsPerMinute ?? 60, options.now ?? Date.now);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
    if (requestPath === "/healthz") return void send(res, 200, { ok: true, service: "home", version: VERSION });
    if (requestPath !== path) return void send(res, 404, { error: "not_found" });
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return void send(res, 405, { error: "method_not_allowed" }); }
    let body: unknown;
    try { body = await read(req); } catch { return void send(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }); }
    const messages = Array.isArray(body) ? body : [body];
    if (messages.some((m) => (m as { method?: unknown })?.method === "tools/call") && !limiter.take()) return void send(res, 429, { jsonrpc: "2.0", error: { code: -32000, message: "Too many requests. Try again in a minute." }, id: null }, { "Retry-After": "60" });
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
  const handler = createHomeHttpHandler({ client, mcpPath: process.env["HOME_MCP_PATH"] || "/mcp", callsPerMinute: Number(process.env["MCP_CALLS_PER_MINUTE"] || 60) });
  const port = Number(process.env["PORT"] || 4177); const host = process.env["HOST"] || "127.0.0.1";
  createServer((req, res) => void handler(req, res).catch((error) => { console.error("[home-mcp-http] request failed:", error); if (!res.headersSent) send(res, 500, { error: "internal_error" }); })).listen(port, host, () => console.error(`home-mcp-http ${VERSION} listening on http://${host}:${port}`));
}

if (isMain(import.meta.url)) void main().catch((error) => { console.error(`home-mcp-http: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
