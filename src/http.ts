#!/usr/bin/env node
/**
 * Remote MCP endpoint: streamable HTTP, the transport ChatGPT requires.
 *
 * Stateless: every POST gets a fresh server and transport, so any instance can
 * answer any request and nothing is kept between calls. It serves the
 * `chatgpt` profile (src/profile.ts) from the same manifest as the stdio server.
 *
 * Two auth modes (MCP_AUTH), see docs/chatgpt-app/RUNNING.md:
 *
 * - `oauth` (the default): users link their Homedata account in ChatGPT through
 *   thor's OAuth server. Listing tools is anonymous, as ChatGPT expects; a tool
 *   call needs a bearer token, which src/auth.ts checks with thor, and runs on
 *   the key thor returns, so it charges the user's own wallet. No key is held
 *   here.
 * - `server-key` (developer-mode testing only): ChatGPT cannot send an API key,
 *   so the server holds one (HOMEDATA_API_KEY, a dedicated test wallet) and the
 *   tools are declared `noauth`. MCP_PATH must then be an unguessable path,
 *   because it is the only thing between the internet and that wallet.
 *
 * MCP_CALLS_PER_MINUTE caps tool calls per caller (per signed-in user, or for
 * the whole server in server-key mode). Unsigned calls in oauth mode are not
 * capped: they only receive the sign-in challenge. It bounds the rate, not access.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { challengeHeader, Introspector, protectedResourceMetadata, SCOPE, type OAuthSettings } from "./auth.js";
import { HomedataClient } from "./client.js";
import { VERSION } from "./index.js";
import { PROFILES } from "./profile.js";
import { buildServer } from "./server.js";
import { isMain } from "./entry.js";

const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_ISSUER = "https://homedata.co.uk";

export type HttpAuth =
  | { mode: "server-key"; client: HomedataClient }
  | {
      mode: "oauth";
      settings: OAuthSettings;
      introspector: Introspector;
      /** Builds the API client for a signed-in user's key. */
      clientFor: (apiKey: string) => HomedataClient;
    };

export interface HttpOptions {
  auth: HttpAuth;
  /** Where the MCP endpoint answers. */
  mcpPath: string;
  /** Tool calls allowed per rolling minute, per caller. */
  callsPerMinute?: number;
  now?: () => number;
  /**
   * The token OpenAI's plugin portal asks the MCP host to serve as plain text
   * at /.well-known/openai-apps-challenge to prove domain ownership. Unset
   * answers 404.
   */
  appsChallenge?: string;
}

export class ConfigError extends Error {}

/** A secret path's last segment: at least 16 URL-safe characters (16 hex = 64 bits). */
const SECRET_SEGMENT = /^[A-Za-z0-9_-]{16,}$/;

/**
 * In server-key mode the path is the only thing between the internet and the
 * server-held key, so accept only one whose last segment is long and
 * random-looking, and never a well-known route such as /mcp.
 */
export function checkMcpPath(path: string | undefined): string {
  if (!path) {
    throw new ConfigError("MCP_PATH is required: set it to an unguessable path such as /mcp/<32 random hex>.");
  }
  const segments = path.split("/");
  if (!path.startsWith("/") || segments.length < 3 || !SECRET_SEGMENT.test(segments[segments.length - 1]!)) {
    throw new ConfigError(
      "MCP_PATH must end in a secret segment of at least 16 URL-safe characters, such as /mcp/<32 random hex>.",
    );
  }
  return path;
}

/** The portal's challenge token: plain, single-line, URL-safe text. */
export function checkAppsChallenge(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (!/^[A-Za-z0-9._~-]{8,512}$/.test(raw)) {
    throw new ConfigError("OPENAI_APPS_CHALLENGE must be the portal's token exactly: 8-512 URL-safe characters, no spaces.");
  }
  return raw;
}

export function checkCallsPerMinute(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 30;
  const n = Number(raw);
  // NaN would never compare >= in the limiter, so a typo would remove the cap.
  if (!Number.isInteger(n) || n < 1) throw new ConfigError("MCP_CALLS_PER_MINUTE must be a whole number of at least 1.");
  return n;
}

/** An https URL with no query or fragment; plain http only for this machine (local testing). */
function checkUrl(name: string, raw: string | undefined): string {
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    throw new ConfigError(`${name} must be an absolute URL.`);
  }
  const local = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !local) || url.search || url.hash || url.username || url.password) {
    throw new ConfigError(`${name} must be an https URL with no query, fragment or credentials.`);
  }
  return raw!;
}

export type HttpConfig =
  | { mode: "server-key"; mcpPath: string; callsPerMinute: number; port: number; host: string; appsChallenge?: string }
  | {
      mode: "oauth";
      mcpPath: string;
      callsPerMinute: number;
      port: number;
      host: string;
      appsChallenge?: string;
      oauth: OAuthSettings;
    };

export function configFromEnv(env: NodeJS.ProcessEnv): HttpConfig {
  const common = {
    callsPerMinute: checkCallsPerMinute(env["MCP_CALLS_PER_MINUTE"]),
    appsChallenge: checkAppsChallenge(env["OPENAI_APPS_CHALLENGE"]),
    port: Number(env["PORT"] ?? 4176),
    host: env["HOST"] ?? "127.0.0.1",
  };
  const mode = env["MCP_AUTH"] || "oauth";

  if (mode === "server-key") {
    if (!(env["HOMEDATA_API_KEY"] ?? "").trim()) throw new ConfigError("MCP_AUTH=server-key needs HOMEDATA_API_KEY.");
    return { mode, mcpPath: checkMcpPath(env["MCP_PATH"]), ...common };
  }
  if (mode !== "oauth") throw new ConfigError("MCP_AUTH must be oauth or server-key.");

  // A key here would be unused at best and a silent second wallet at worst.
  if ((env["HOMEDATA_API_KEY"] ?? "").trim()) {
    throw new ConfigError("HOMEDATA_API_KEY is not used with MCP_AUTH=oauth: calls run on each user's own key. Unset it.");
  }
  const mcpPath = env["MCP_PATH"] || "/mcp";
  if (!mcpPath.startsWith("/")) throw new ConfigError("MCP_PATH must start with /.");
  const issuer = checkUrl("OAUTH_ISSUER", env["OAUTH_ISSUER"] || DEFAULT_ISSUER).replace(/\/+$/, "");
  const secret = env["OAUTH_INTROSPECTION_SECRET"] ?? "";
  if (secret.length < 32) {
    throw new ConfigError("OAUTH_INTROSPECTION_SECRET must be set to thor's introspection secret (at least 32 characters).");
  }
  return {
    mode,
    mcpPath,
    ...common,
    oauth: {
      resource: checkUrl("MCP_RESOURCE", env["MCP_RESOURCE"]),
      issuer,
      introspectionUrl: checkUrl("OAUTH_INTROSPECTION_URL", env["OAUTH_INTROSPECTION_URL"] || `${issuer}/oauth/introspect`),
      introspectionSecret: secret,
    },
  };
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

/** One MinuteLimiter per caller, created on first use. */
class CallerLimits {
  private readonly limiters = new Map<string, MinuteLimiter>();
  constructor(private readonly limit: number, private readonly now: () => number) {}

  take(caller: string): boolean {
    let limiter = this.limiters.get(caller);
    if (!limiter) {
      // Bound memory: a caller idle for a minute has nothing left to remember.
      if (this.limiters.size >= 10_000) this.limiters.clear();
      limiter = new MinuteLimiter(this.limit, this.now);
      this.limiters.set(caller, limiter);
    }
    return limiter.take();
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));
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

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  const match = typeof header === "string" ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match ? match[1]! : null;
}

const rpcError = (message: string) => ({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });

export function createHttpHandler(opts: HttpOptions) {
  const { auth } = opts;
  const mcpPath = auth.mode === "server-key" ? checkMcpPath(opts.mcpPath) : opts.mcpPath;
  const limits = new CallerLimits(opts.callsPerMinute ?? 30, opts.now ?? Date.now);

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path === "/healthz") return sendJson(res, 200, { ok: true, version: VERSION });

    if (path === "/.well-known/openai-apps-challenge") {
      if (!opts.appsChallenge) return sendJson(res, 404, { error: "not_found" });
      // Exactly the token: OpenAI rejects JSON, a list or a trailing newline.
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end(opts.appsChallenge);
      return;
    }

    // RFC 9728: at the root, and with the MCP path appended for clients that
    // derive the metadata URL from the endpoint URL.
    if (auth.mode === "oauth" && req.method === "GET" &&
        (path === "/.well-known/oauth-protected-resource" || path === `/.well-known/oauth-protected-resource${mcpPath}`)) {
      return sendJson(res, 200, protectedResourceMetadata(auth.settings), { "Cache-Control": "public, max-age=300" });
    }

    if (path !== mcpPath) return sendJson(res, 404, { error: "not_found" });

    // Stateless streamable HTTP: no session to resume, so no GET stream and no DELETE.
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, rpcError("Method not allowed."));
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    }

    let client: HomedataClient | null = null;
    // Who the call cap is charged to; null means no cap applies.
    let caller: string | null = "server";
    if (auth.mode === "server-key") {
      client = auth.client;
    } else {
      const token = bearerToken(req);
      if (token !== null) {
        const check = await auth.introspector.check(token);
        if (!check.ok && check.reason === "unavailable") {
          // Not a 401: an outage must not make ChatGPT sign the user out.
          res.setHeader("Retry-After", "30");
          return sendJson(res, 503, rpcError("Homedata sign-in is temporarily unavailable. Try again shortly."));
        }
        if (!check.ok) {
          const header = challengeHeader(auth.settings.resource, {
            code: "invalid_token",
            description: "Your Homedata connection has expired. Connect your account again.",
          });
          return sendJson(res, 401, rpcError("Your Homedata connection has expired."), { "WWW-Authenticate": header });
        }
        client = auth.clientFor(check.apiKey);
        caller = `user:${check.subject}`;
      } else {
        // Unsigned calls only ever get the sign-in challenge: they never reach
        // the API or a wallet, so they spend no quota. One shared bucket here
        // would let anyone exhaust it and leave every new user facing 429
        // instead of the connect button.
        caller = null;
      }
    }

    for (let i = caller === null ? 0 : toolCalls(body); i > 0; i--) {
      if (!limits.take(caller!)) {
        return sendJson(res, 429, rpcError("Too many requests. Try again in a minute."), { "Retry-After": "60" });
      }
    }

    const server =
      auth.mode === "server-key"
        ? buildServer(client, PROFILES.chatgpt)
        : buildServer(client, PROFILES.chatgpt, {
            securitySchemes: [{ type: "oauth2", scopes: [SCOPE] }],
            signInRequired: () => ({
              content: [{ type: "text", text: "Connect your Homedata account to use this tool." }],
              isError: true,
              _meta: {
                "mcp/www_authenticate": [
                  challengeHeader(auth.settings.resource, {
                    code: "invalid_token",
                    description: "Connect your Homedata account to continue.",
                  }),
                ],
              },
            }),
          });
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
  let config: HttpConfig;
  try {
    config = configFromEnv(process.env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`homedata-mcp-http: ${err.message}`);
    process.exit(1);
  }
  const baseUrl = (process.env["HOMEDATA_BASE_URL"] ?? "").trim() || undefined;
  const auth: HttpAuth =
    config.mode === "server-key"
      ? { mode: "server-key", client: HomedataClient.fromEnv(VERSION) }
      : {
          mode: "oauth",
          settings: config.oauth,
          introspector: new Introspector(config.oauth),
          clientFor: (apiKey) => new HomedataClient({ apiKey, baseUrl, version: VERSION }),
        };
  const handler = createHttpHandler({
    auth,
    mcpPath: config.mcpPath,
    callsPerMinute: config.callsPerMinute,
    appsChallenge: config.appsChallenge,
  });
  createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error("[homedata-mcp-http] request failed:", err);
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    });
  }).listen(config.port, config.host, () => {
    // Never log MCP_PATH or any secret: in server-key mode the path guards the test wallet.
    console.error(`homedata-mcp-http ${VERSION} (${config.mode}) listening on http://${config.host}:${config.port}`);
  });
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error("[homedata-mcp-http] fatal:", err);
    process.exit(1);
  });
}
