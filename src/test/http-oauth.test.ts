import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import type { ToolCallEvent } from "../activity.js";
import { Introspector, type OAuthSettings } from "../auth.js";
import { HomedataClient } from "../client.js";
import { configFromEnv, ConfigError, createHttpHandler } from "../http.js";

const SETTINGS: OAuthSettings = {
  resource: "https://mcp.homedata.test",
  issuer: "https://homedata.test",
  introspectionUrl: "https://homedata.test/oauth/introspect",
  introspectionSecret: "s".repeat(40),
};

type Answer = Record<string, unknown>;
const active = (key: string, sub: string, over: Answer = {}): Answer => ({
  active: true,
  iss: SETTINGS.issuer,
  aud: SETTINGS.resource,
  scope: "homedata.read",
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub,
  homedata_api_key: key,
  ...over,
});

async function start(
  opts: {
    answers?: Record<string, Answer | "down">;
    callsPerMinute?: number;
    now?: () => number;
    activity?: (event: ToolCallEvent) => void;
  } = {},
) {
  const introspected: string[] = [];
  const thor = (async (_url: unknown, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>)["Authorization"], `Bearer ${SETTINGS.introspectionSecret}`);
    const token = new URLSearchParams(String(init?.body)).get("token")!;
    introspected.push(token);
    const answer = opts.answers?.[token];
    if (answer === "down") throw new Error("connect ECONNREFUSED");
    return new Response(JSON.stringify(answer ?? { active: false }), { status: 200 });
  }) as unknown as typeof fetch;

  const apiCalls: string[] = [];
  const api = (async (_url: unknown, init?: RequestInit) => {
    apiCalls.push((init?.headers as Record<string, string>)["Authorization"]!);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;

  const handler = createHttpHandler({
    auth: {
      mode: "oauth",
      settings: SETTINGS,
      introspector: new Introspector(SETTINGS, thor, opts.now),
      clientFor: (apiKey) => new HomedataClient({ apiKey, fetchImpl: api }),
    },
    mcpPath: "/mcp",
    callsPerMinute: opts.callsPerMinute,
    now: opts.now,
    activity: opts.activity,
  });
  const http: HttpServer = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  const rpc = async (method: string, params: unknown = {}, token?: string) => {
    const response = await fetch(base + "/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return { status: response.status, headers: response.headers, body: (await response.json()) as Record<string, any> };
  };
  const call = (token?: string, name = "crime") => rpc("tools/call", { name, arguments: { postcode: "SW1A 2AA" } }, token);
  const stop = async () => {
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  };
  return { base, rpc, call, introspected, apiCalls, stop };
}

test("protected-resource metadata points ChatGPT at thor", async () => {
  const { base, stop } = await start();
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), {
      resource: SETTINGS.resource,
      authorization_servers: [SETTINGS.issuer],
      scopes_supported: ["homedata.read"],
      bearer_methods_supported: ["header"],
      resource_documentation: "https://homedata.co.uk/docs/mcp",
    });
  }
  await stop();
});

test("tools are listed without signing in and declare oauth2", async () => {
  const { rpc, introspected, stop } = await start();
  const tools = (await rpc("tools/list")).body["result"].tools as Array<Record<string, any>>;
  assert.equal(tools.length, 15);
  for (const tool of tools) {
    assert.deepEqual(tool["securitySchemes"], [{ type: "oauth2", scopes: ["homedata.read"] }], tool["name"]);
    assert.deepEqual(tool["_meta"].securitySchemes, [{ type: "oauth2", scopes: ["homedata.read"] }]);
  }
  assert.deepEqual(introspected, []);
  await stop();
});

test("a call without signing in returns the challenge ChatGPT turns into a connect button", async () => {
  const { call, apiCalls, stop } = await start();
  const { status, body } = await call();
  assert.equal(status, 200);
  const result = body["result"];
  assert.equal(result.isError, true);
  const [challenge] = result._meta["mcp/www_authenticate"] as string[];
  assert.match(challenge!, /^Bearer scope="homedata\.read", resource_metadata="https:\/\/mcp\.homedata\.test\/\.well-known\/oauth-protected-resource"/);
  assert.match(challenge!, /error="invalid_token"/);
  assert.match(challenge!, /error_description="/);
  assert.deepEqual(apiCalls, []);
  await stop();
});

test("a signed-in call runs on that user's own key", async () => {
  const { call, apiCalls, stop } = await start({ answers: { "tok-a": active("key-a", "1"), "tok-b": active("key-b", "2") } });
  assert.notEqual((await call("tok-a")).body["result"].isError, true);
  await call("tok-b");
  assert.deepEqual(apiCalls, ["Api-Key key-a", "Api-Key key-b"]);
  await stop();
});

test("a token thor will not vouch for gets a 401 challenge and never reaches the API", async () => {
  const past = Math.floor(Date.now() / 1000) - 1;
  const answers: Record<string, Answer> = {
    inactive: { active: false },
    "wrong-audience": active("k", "1", { aud: "https://other.example" }),
    "wrong-issuer": active("k", "1", { iss: "https://evil.example" }),
    "no-scope": active("k", "1", { scope: "other" }),
    expired: active("k", "1", { exp: past }),
    "no-key": active("k", "1", { homedata_api_key: "" }),
  };
  const { call, apiCalls, stop } = await start({ answers });
  for (const token of Object.keys(answers)) {
    const { status, headers } = await call(token);
    assert.equal(status, 401, token);
    assert.match(headers.get("www-authenticate") ?? "", /resource_metadata=".*oauth-protected-resource".*error="invalid_token"/, token);
  }
  assert.deepEqual(apiCalls, []);
  await stop();
});

test("thor being unreachable is a 503, never a sign-out", async () => {
  const { call, apiCalls, stop } = await start({ answers: { down: "down" } });
  const { status, headers } = await call("down");
  assert.equal(status, 503);
  assert.equal(headers.get("www-authenticate"), null);
  assert.deepEqual(apiCalls, []);
  await stop();
});

test("an active answer is cached for a minute; an inactive one is not cached", async () => {
  let now = Date.now();
  const { call, introspected, stop } = await start({ answers: { good: active("k", "1") }, now: () => now });
  await call("good");
  await call("good");
  assert.equal(introspected.filter((t) => t === "good").length, 1);
  now += 61_000;
  await call("good");
  assert.equal(introspected.filter((t) => t === "good").length, 2);

  await call("bad");
  await call("bad");
  assert.equal(introspected.filter((t) => t === "bad").length, 2);
  await stop();
});

test("the call cap is per user: one user at the cap does not block another", async () => {
  const { call, stop } = await start({ callsPerMinute: 1, answers: { a: active("ka", "1"), b: active("kb", "2") } });
  assert.equal((await call("a")).status, 200);
  assert.equal((await call("a")).status, 429);
  assert.equal((await call("b")).status, 200);
  await stop();
});

test("oauth is the default mode and its configuration is checked", () => {
  const good = { MCP_RESOURCE: "https://mcp.homedata.co.uk", OAUTH_INTROSPECTION_SECRET: "x".repeat(32) };
  const config = configFromEnv(good);
  assert.equal(config.mode, "oauth");
  assert.equal(config.mcpPath, "/mcp");
  assert.deepEqual(config.mode === "oauth" && config.oauth, {
    resource: "https://mcp.homedata.co.uk",
    issuer: "https://homedata.co.uk",
    introspectionUrl: "https://homedata.co.uk/oauth/introspect",
    introspectionSecret: "x".repeat(32),
  });

  for (const [env, message] of [
    [{ ...good, HOMEDATA_API_KEY: "k" }, /HOMEDATA_API_KEY is not used/],
    [{ ...good, MCP_RESOURCE: undefined }, /MCP_RESOURCE must be an absolute URL/],
    [{ ...good, MCP_RESOURCE: "http://mcp.homedata.co.uk" }, /MCP_RESOURCE must be an https URL/],
    [{ ...good, OAUTH_INTROSPECTION_SECRET: "short" }, /OAUTH_INTROSPECTION_SECRET/],
    [{ ...good, OAUTH_ISSUER: "https://homedata.co.uk/?x=1" }, /OAUTH_ISSUER must be an https URL/],
    [{ ...good, MCP_AUTH: "none" }, /MCP_AUTH must be oauth or server-key/],
    [{ MCP_AUTH: "server-key", MCP_PATH: "/mcp/" + "a".repeat(32) }, /needs HOMEDATA_API_KEY/],
  ] as const) {
    assert.throws(() => configFromEnv(env as NodeJS.ProcessEnv), (err: Error) => err instanceof ConfigError && message.test(err.message));
  }
});

test("unsigned calls spend no quota, so they cannot block anyone's sign-in challenge", async () => {
  const { call, apiCalls, stop } = await start({ callsPerMinute: 1, answers: { a: active("ka", "1") } });
  // One unsigned client calls far past the cap.
  for (let i = 0; i < 5; i++) assert.equal((await call()).status, 200);
  // Another new user still gets the challenge, not a 429.
  const { status, body } = await call();
  assert.equal(status, 200);
  assert.ok(body["result"]._meta["mcp/www_authenticate"]);
  // And a signed-in user's own quota is untouched.
  assert.equal((await call("a")).status, 200);
  assert.deepEqual(apiCalls, ["Api-Key ka"]);
  await stop();
});

test("every tool call is reported with the organisation thor names, and never its arguments", async () => {
  const events: ToolCallEvent[] = [];
  const answers = {
    named: active("ka", "1", { organization_id: "42", organization_name: "Acme  Estates\n" }),
    unnamed: active("kb", "2", { organization_id: "7" }),
  };
  const { call, stop } = await start({ answers, activity: (e) => events.push(e) });
  await call("named");
  await call("unnamed");
  await call();
  await call("named", "SW1A 2AA <!channel>");
  assert.deepEqual(
    events.map(({ organisation, tool, outcome }) => ({ organisation, tool, outcome })),
    [
      { organisation: "Acme Estates", tool: "crime", outcome: "ok" },
      { organisation: "organisation 7", tool: "crime", outcome: "ok" },
      { organisation: "not signed in", tool: "crime", outcome: "sign-in required" },
      { organisation: "Acme Estates", tool: "unknown tool", outcome: "unknown tool" },
    ],
  );
  for (const event of events) assert.ok(event.ms >= 0 && event.ms < 5000);
  assert.doesNotMatch(JSON.stringify(events), /SW1A|channel/);
  await stop();
});

test("a reporter that throws never fails the tool call", async () => {
  const { call, stop } = await start({
    answers: { a: active("ka", "1") },
    activity: () => {
      throw new Error("slack is on fire");
    },
  });
  const { status, body } = await call("a");
  assert.equal(status, 200);
  assert.notEqual(body["result"].isError, true);
  await stop();
});

test("a rate-limited call is still reported, with a safe tool name and no arguments", async () => {
  const events: ToolCallEvent[] = [];
  const { call, stop } = await start({
    callsPerMinute: 1,
    answers: { a: active("ka", "1", { organization_id: "42", organization_name: "Acme Estates" }) },
    activity: (e) => events.push(e),
  });
  assert.equal((await call("a")).status, 200);
  assert.equal((await call("a")).status, 429);
  assert.equal((await call("a", "SW1A 2AA <!channel>")).status, 429);
  assert.deepEqual(
    events.map(({ organisation, tool, outcome }) => ({ organisation, tool, outcome })),
    [
      { organisation: "Acme Estates", tool: "crime", outcome: "ok" },
      { organisation: "Acme Estates", tool: "crime", outcome: "rate limited" },
      { organisation: "Acme Estates", tool: "unknown tool", outcome: "rate limited" },
    ],
  );
  assert.doesNotMatch(JSON.stringify(events), /SW1A|channel/);
  await stop();
});
