import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { HomedataClient } from "../client.js";
import { createHttpHandler, MinuteLimiter } from "../http.js";
import { descriptionFor, tools } from "../manifest.js";
import { CHATGPT_TOOLS, withoutPrice } from "../profile.js";

const MCP_PATH = "/mcp/secret-path";

async function start(opts: { callsPerMinute?: number } = {}) {
  const sent: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    sent.push(new URL(String(input)).pathname);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Tokens-Charged": "2" },
    });
  }) as typeof fetch;
  const handler = createHttpHandler({
    client: new HomedataClient({ apiKey: "http-test", fetchImpl }),
    mcpPath: MCP_PATH,
    callsPerMinute: opts.callsPerMinute,
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
