#!/usr/bin/env node
/**
 * Remote MCP endpoint: streamable HTTP, the transport ChatGPT requires.
 *
 * Stateless: every POST gets a fresh server and transport, so any instance can
 * answer any request and nothing is kept between calls. It serves the
 * `chatgpt` profile (src/profile.ts) from the same manifest as the stdio server.
 *
 * Auth, phase 1 (developer-mode testing only, see docs/chatgpt-app/RESEARCH.md):
 * ChatGPT cannot send an API key, so the server holds one (HOMEDATA_API_KEY,
 * a dedicated test wallet) and the tools are declared `noauth`. Two guards keep
 * that wallet from being spent by whoever finds the URL:
 *   - MCP_PATH: serve only at an unguessable path, e.g. /mcp/<random>.
 *   - MCP_CALLS_PER_MINUTE: a process-wide cap on data tool calls.
 * Phase 2 replaces this with OAuth and the user's own Homedata key.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { HomedataClient } from "./client.js";
import { VERSION } from "./index.js";
import { PROFILES } from "./profile.js";
import { buildServer } from "./server.js";

const MAX_BODY_BYTES = 1_000_000;

export interface HttpOptions {
  client: HomedataClient;
  /** Where the MCP endpoint answers. */
  mcpPath?: string;
  /** Data tool calls allowed per rolling minute, across all callers. */
  callsPerMinute?: number;
  now?: () => number;
}

/** A rolling one-minute window of call timestamps. */
export class MinuteLimiter {
  private readonly stamps: number[] = [];
  constructor(private readonly limit: number, private readonly now: () => number = Date.now) {}

  take(): boolean {
    const t = this.now();
    while (this.stamps.length && t - this.stamps[0]! >= 60_000) this.stamps.shift();
    if (this.stamps.length >= this.limit) return false;
    this.stamps.push(t);
    return true;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** JSON-RPC requests in a body that call a tool (a body may be a batch). */
function toolCalls(body: unknown): number {
  const messages = Array.isArray(body) ? body : [body];
  return messages.filter((m) => (m as { method?: unknown })?.method === "tools/call").length;
}

export function createHttpHandler(opts: HttpOptions) {
  const mcpPath = opts.mcpPath ?? "/mcp";
  const limiter = new MinuteLimiter(opts.callsPerMinute ?? 30, opts.now);

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path === "/healthz") return sendJson(res, 200, { ok: true, version: VERSION });
    if (path !== mcpPath) return sendJson(res, 404, { error: "not_found" });

    // Stateless streamable HTTP: no session to resume, so no GET stream and no DELETE.
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    }

    for (let i = toolCalls(body); i > 0; i--) {
      if (!limiter.take()) {
        res.setHeader("Retry-After", "60");
        return sendJson(res, 429, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Too many requests. Try again in a minute." },
          id: null,
        });
      }
    }

    const server = buildServer(opts.client, PROFILES.chatgpt);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}

async function main(): Promise<void> {
  const client = HomedataClient.fromEnv(VERSION);
  const port = Number(process.env["PORT"] ?? 4176);
  const host = process.env["HOST"] ?? "127.0.0.1";
  const handler = createHttpHandler({
    client,
    mcpPath: process.env["MCP_PATH"] || "/mcp",
    callsPerMinute: Number(process.env["MCP_CALLS_PER_MINUTE"] ?? 30),
  });
  createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error("[homedata-mcp-http] request failed:", err);
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    });
  }).listen(port, host, () => {
    // Never log MCP_PATH: it is the only thing keeping the test wallet private.
    console.error(`homedata-mcp-http ${VERSION} listening on http://${host}:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[homedata-mcp-http] fatal:", err);
    process.exit(1);
  });
}
