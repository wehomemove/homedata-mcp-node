import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { HomedataClient } from "../client.js";
import { checkAppsChallenge, checkCallsPerMinute, checkMcpPath, ConfigError, createHttpHandler, MinuteLimiter } from "../http.js";
import { descriptionFor, tools } from "../manifest.js";
import { CHATGPT_DESCRIPTIONS, CHATGPT_TOOLS, withoutPrice } from "../profile.js";

const MCP_PATH = "/mcp/0123456789abcdef0123456789abcdef";
const HTTP_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "http.js");

async function start(opts: { callsPerMinute?: number; body?: unknown; status?: number; appsChallenge?: string } = {}) {
  const sent: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    sent.push(new URL(String(input)).pathname);
    return new Response(JSON.stringify(opts.body ?? { ok: true }), {
      status: opts.status ?? 200,
      headers: { "Content-Type": "application/json", "X-Tokens-Charged": "2" },
    });
  }) as typeof fetch;
  const handler = createHttpHandler({
    auth: { mode: "server-key", client: new HomedataClient({ apiKey: "http-test", fetchImpl }) },
    mcpPath: MCP_PATH,
    callsPerMinute: opts.callsPerMinute,
    appsChallenge: opts.appsChallenge,
  });
  const http: HttpServer = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + MCP_PATH)));
  const stop = async () => {
    await client.close();
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  };
  return { base, client, sent, stop };
}

test("the HTTP endpoint offers exactly the ChatGPT tool set", async () => {
  const { client, stop } = await start();
  const listed = (await client.listTools()).tools;
  assert.deepEqual(listed.map((t) => t.name).sort(), [...CHATGPT_TOOLS].sort());
  for (const name of CHATGPT_TOOLS) {
    assert.ok(tools().some((t) => t.name === name), `${name} is not in the manifest`);
  }
  await stop();
});

test("every ChatGPT tool has a title, explicit annotations and a security scheme", async () => {
  // Read the wire, not the SDK client: the client's schema drops fields it does
  // not know, such as the top-level securitySchemes ChatGPT reads.
  const { base, stop } = await start();
  const response = await fetch(base + MCP_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const listed = ((await response.json()) as { result: { tools: Array<Record<string, unknown>> } }).result.tools;
  assert.equal(listed.length, CHATGPT_TOOLS.length);
  for (const tool of listed) {
    assert.ok(tool["title"], `${tool["name"]} has no title`);
    // OpenAI requires all three as explicit booleans; every catalogue tool is a GET.
    assert.deepEqual(tool["annotations"], { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    assert.deepEqual(tool["securitySchemes"], [{ type: "noauth" }], String(tool["name"]));
    assert.deepEqual((tool["_meta"] as Record<string, unknown>)["securitySchemes"], [{ type: "noauth" }]);
  }
  await stop();
});

test("no ChatGPT-visible text mentions what a call costs", async () => {
  const { client, stop } = await start();
  const instructions = client.getInstructions() ?? "";
  assert.doesNotMatch(instructions, /token|cheap|balance|prepaid/i);
  for (const tool of (await client.listTools()).tools) {
    assert.doesNotMatch(JSON.stringify(tool), /\btokens?\b|\bcheap/i, tool.name);
  }
  await stop();
});

test("a tool call reaches the API and keeps spend out of the model's text", async () => {
  const { client, sent, stop } = await start();
  const result = await client.callTool({ name: "address_find", arguments: { q: "10 Downing Street" } });
  assert.notEqual(result.isError, true);
  assert.deepEqual(sent, ["/address/find/"]);
  assert.deepEqual(result._meta, { homedata: { tokens_charged: "2" } });
  await stop();
});

test("tools outside the ChatGPT set are refused without calling the API", async () => {
  const { client, sent, stop } = await start();
  for (const name of ["start_homedata_signup", "check_homedata_api_key", "property_complete"]) {
    const result = await client.callTool({ name, arguments: name === "property_complete" ? { uprn: "1" } : {} });
    assert.equal(result.isError, true, name);
    assert.match(JSON.stringify(result.content), /unknown_tool/, name);
  }
  assert.deepEqual(sent, []);
  await stop();
});

test("the call cap answers 429 and the refused call never reaches the API", async () => {
  const { client, sent, stop } = await start({ callsPerMinute: 1 });
  await client.callTool({ name: "crime", arguments: { postcode: "SW1A 2AA" } });
  await assert.rejects(client.callTool({ name: "crime", arguments: { postcode: "SW1A 2AA" } }), /429|Too many/);
  assert.equal(sent.length, 1);
  await stop();
});

test("only the configured path answers MCP; GET is refused; health is open", async () => {
  const { base, stop } = await start();
  const post = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };
  assert.equal((await fetch(base + "/mcp", post)).status, 404);
  assert.equal((await fetch(base + MCP_PATH)).status, 405);
  assert.equal((await fetch(base + "/healthz")).status, 200);
  assert.equal((await fetch(base + MCP_PATH, { ...post, body: "not json" })).status, 400);
  await stop();
});

test("MinuteLimiter frees a slot once a call is a minute old", () => {
  let now = 0;
  const limiter = new MinuteLimiter(1, () => now);
  assert.equal(limiter.take(), true);
  now = 59_999;
  assert.equal(limiter.take(), false);
  now = 60_000;
  assert.equal(limiter.take(), true);
});

test("withoutPrice drops pricing sentences and keeps costs that are subject matter", () => {
  assert.equal(withoutPrice("Find addresses. Costs 2 tokens."), "Find addresses.");
  assert.equal(withoutPrice("Risks. Costs 1 token; 5 tokens when risk_type is all."), "Risks.");
  assert.equal(withoutPrice("A summary. Cheaper than calling those tools separately. Slow at first."), "A summary. Slow at first.");
  assert.equal(
    withoutPrice("Improvements, each with estimated minimum and maximum cost. Costs 1 token."),
    "Improvements, each with estimated minimum and maximum cost.",
  );
  // Every catalogue description keeps some text once its price is gone.
  for (const t of tools()) assert.ok(withoutPrice(descriptionFor(t.name)).length > 0, t.name);
});

test("every ChatGPT tool publishes an output schema its real results satisfy", async () => {
  // Bodies the API really returns: an object, a bare list, and an error.
  for (const [body, status] of [[{ results: [{ uprn: "1" }] }, 200], [[{ uprn: "1" }], 200], [{ detail: "Not found." }, 404]] as const) {
    const { client, stop } = await start({ body, status });
    const listed = (await client.listTools()).tools;
    for (const tool of listed) {
      assert.equal(tool.outputSchema?.type, "object", tool.name);
    }
    // listTools armed the SDK client's validator: callTool rejects any
    // structuredContent that does not satisfy the tool's outputSchema.
    const result = await client.callTool({ name: "crime", arguments: { postcode: "SW1A 2AA" } });
    assert.equal(typeof result.structuredContent, "object", JSON.stringify(body));
    await stop();
  }
});

test("MCP_PATH must be present and unguessable", () => {
  for (const bad of [undefined, "", "/", "/mcp", "/mcp/", "/mcp/short", "/mcp/has space 0123456789", "mcp/0123456789abcdef"]) {
    assert.throws(() => checkMcpPath(bad), ConfigError, String(bad));
  }
  assert.equal(checkMcpPath(MCP_PATH), MCP_PATH);
  // The handler applies the same check, so a caller cannot bypass it.
  assert.throws(
    () => createHttpHandler({ auth: { mode: "server-key", client: new HomedataClient({ apiKey: "x" }) }, mcpPath: "/mcp" }),
    ConfigError,
  );
});

test("MCP_CALLS_PER_MINUTE must be a whole number of at least 1", () => {
  assert.equal(checkCallsPerMinute(undefined), 30);
  assert.equal(checkCallsPerMinute("5"), 5);
  for (const bad of ["abc", "0", "-1", "1.5"]) assert.throws(() => checkCallsPerMinute(bad), ConfigError, bad);
});

test("the server refuses to start with a missing or unsafe configuration", () => {
  const base: NodeJS.ProcessEnv = { ...process.env, MCP_AUTH: "server-key", HOMEDATA_API_KEY: "startup-test-key", PORT: "0" };
  delete base["MCP_PATH"];
  for (const [env, mentions] of [
    [{}, /MCP_PATH is required/],
    [{ MCP_PATH: "/mcp" }, /MCP_PATH must end in a secret segment/],
    [{ MCP_PATH, MCP_CALLS_PER_MINUTE: "abc" }, /MCP_CALLS_PER_MINUTE/],
  ] as const) {
    const run = spawnSync(process.execPath, [HTTP_ENTRY], { env: { ...base, ...env }, encoding: "utf8", timeout: 10_000 });
    assert.equal(run.status, 1, `${JSON.stringify(env)} started: ${run.stderr}`);
    assert.match(run.stderr, mentions);
    assert.doesNotMatch(run.stderr, /listening/);
    assert.doesNotMatch(run.stderr, /startup-test-key/);
  }
});

test("no ChatGPT description points at a tool or tier ChatGPT cannot use", async () => {
  // Plugin Creator flagged council_tax ("use council_tax_full") and
  // property_core ("everything in Base"): the catalogue text is written for
  // the full tool set. A tool reference has an identifier's shape (snake_case);
  // plain words such as "solar" are prose.
  const { client, stop } = await start();
  const exposed = new Set<string>(CHATGPT_TOOLS);
  const hidden = tools().map((t) => t.name).filter((n) => n.includes("_") && !exposed.has(n));
  for (const tool of (await client.listTools()).tools) {
    const text = tool.description ?? "";
    for (const name of hidden) assert.doesNotMatch(text, new RegExp(`\\b${name}\\b`), `${tool.name} mentions ${name}`);
    assert.doesNotMatch(text, /\b(Base|Core|Complete|Discovery)\b/, `${tool.name} names a tier`);
  }
  await stop();
});

test("postcode_profile stays out of ChatGPT until it returns full data, and stays in stdio", async () => {
  // Measured 2026-10-01: empty deprivation, school and transport sections for
  // every postcode tried, which its description promises.
  assert.ok(!(CHATGPT_TOOLS as readonly string[]).includes("postcode_profile"));
  assert.ok(tools().some((t) => t.name === "postcode_profile"));
  const { client, sent, stop } = await start();
  const result = await client.callTool({ name: "postcode_profile", arguments: { postcode: "M1 1AE" } });
  assert.match(JSON.stringify(result.content), /unknown_tool/);
  assert.deepEqual(sent, []);
  await stop();
});

test("ChatGPT description overrides only cover exposed tools and carry no prices", () => {
  for (const [name, text] of Object.entries(CHATGPT_DESCRIPTIONS)) {
    assert.ok((CHATGPT_TOOLS as readonly string[]).includes(name), name);
    assert.equal(withoutPrice(text), text, `${name} override carries price text`);
  }
});

test("the domain-verification route serves exactly the portal's token, or 404 when unset", async () => {
  const set = await start({ appsChallenge: "oai-challenge_Token.123" });
  const response = await fetch(set.base + "/.well-known/openai-apps-challenge");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(await response.text(), "oai-challenge_Token.123");
  await set.stop();

  const unset = await start();
  assert.equal((await fetch(unset.base + "/.well-known/openai-apps-challenge")).status, 404);
  await unset.stop();

  assert.equal(checkAppsChallenge(undefined), undefined);
  for (const bad of ["short", "has space here", "line\nbreak", "{\"token\":1}"]) {
    assert.throws(() => checkAppsChallenge(bad), ConfigError, bad);
  }
});
