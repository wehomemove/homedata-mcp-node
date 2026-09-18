import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { HomedataClient } from "../client.js";
import { staticTools, tools } from "../manifest.js";
import { buildServer } from "../server.js";

interface Sent {
  method: string;
  path: string;
  query: Record<string, string>;
}

async function connect(opts: { response?: () => Response; withKey?: boolean } = {}) {
  const sent: Sent[] = [];
  const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url = new URL(String(input));
    sent.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
    });
    return opts.response?.() ?? new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const homedata = opts.withKey === false ? null : new HomedataClient({ apiKey: "parity-test", fetchImpl });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await Promise.all([buildServer(homedata).connect(a), client.connect(b)]);
  return { client, sent };
}

test("the server offers exactly the manifest", async () => {
  const { client } = await connect();
  const listed = (await client.listTools()).tools.map((t) => t.name).sort();
  const expected = [...tools().map((t) => t.name), ...staticTools().map((t) => t.name)].sort();
  assert.deepEqual(listed, expected);
  await client.close();
});

test("without a key only the helpers are offered", async () => {
  const { client } = await connect({ withKey: false });
  const listed = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(listed, staticTools().map((t) => t.name).sort());
  await client.close();
});

test("invalid arguments never reach the API", async () => {
  const { client, sent } = await connect();
  for (const args of [{ uprn: "not-digits" }, {}, { uprn: "1", nope: "x" }]) {
    const result = await client.callTool({ name: "property_core", arguments: args });
    assert.equal(result.isError, true, JSON.stringify(args));
  }
  const badEnum = await client.callTool({ name: "risks", arguments: { risk_type: "volcano", uprn: "1" } });
  assert.equal(badEnum.isError, true);
  assert.deepEqual(sent, [], "a rejected call still reached the API");
  await client.close();
});

test("a call reports what it cost", async () => {
  const { client } = await connect({
    response: () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Tokens-Charged": "25", "X-Tokens-Balance": "975" },
      }),
  });
  const result = await client.callTool({ name: "property_core", arguments: { uprn: "100023336956" } });
  assert.deepEqual(result._meta, { homedata: { tokens_charged: "25", tokens_balance: "975" } });
  await client.close();
});

test("an API error is reported as an error", async () => {
  const { client } = await connect({
    response: () => new Response(JSON.stringify({ error: "insufficient_tokens" }), { status: 402, headers: { "Content-Type": "application/json" } }),
  });
  const result = await client.callTool({ name: "property_core", arguments: { uprn: "100023336956" } });
  assert.equal(result.isError, true);
  await client.close();
});

test("the helpers spend nothing", async () => {
  // Watches both routes out: the client the server was given, and the global fetch a
  // helper could reach for directly. Recording only the injected client would miss that.
  const { client, sent } = await connect();
  const realFetch = globalThis.fetch;
  const globalCalls: string[] = [];
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    globalCalls.push(String(args[0]));
    return realFetch(...args);
  }) as typeof fetch;
  try {
    for (const helper of staticTools()) await client.callTool({ name: helper.name, arguments: {} });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(sent, [], "a helper called the API through the client");
  assert.deepEqual(globalCalls, [], "a helper called the API through global fetch");
  await client.close();
});

test("every tool sends one request to its manifest endpoint", async () => {
  const { client, sent } = await connect();
  for (const spec of tools()) {
    const args: Record<string, unknown> = {};
    spec.params.forEach((param, index) => {
      if (param.enum) args[param.name] = param.enum[0];
      else if (param.type === "number") args[param.name] = index + 2;
      else if (param.pattern === "^\\d+$") args[param.name] = "100023336956";
      else args[param.name] = `${param.name}-sample`;
    });
    sent.length = 0;
    const result = await client.callTool({ name: spec.name, arguments: args });
    assert.notEqual(result.isError, true, `${spec.name}: ${JSON.stringify(result.content)}`);
    assert.equal(sent.length, 1, `${spec.name} sent ${sent.length} requests`);
    assert.equal(sent[0]!.method, spec.method);
    const expectedQuery = Object.fromEntries(
      spec.params.filter((p) => p.in === "query").map((p) => [p.name, String(args[p.name])]),
    );
    assert.deepEqual(sent[0]!.query, expectedQuery, spec.name);
  }
  await client.close();
});

test("a path parameter is percent-encoded on the wire", async () => {
  // The parity dump reports decoded paths to match the guard's convention, so the
  // encoding itself is asserted here, where it cannot be normalised away.
  //
  // A space alone proves nothing: new URL() normalises " " to %20 whether or not
  // the code encodes it. A value carrying "/" and "#" does prove it, and those are
  // the characters that matter: unencoded they become a different path and a
  // fragment, so the request would go somewhere else entirely.
  const { client, sent } = await connect();
  await client.callTool({ name: "address_postcode", arguments: { postcode: "SW1A 2AA" } });
  assert.deepEqual(sent, [{ method: "GET", path: "/address/postcode/SW1A%202AA/", query: {} }]);

  sent.length = 0;
  await client.callTool({ name: "address_postcode", arguments: { postcode: "A/B#C" } });
  assert.deepEqual(sent, [{ method: "GET", path: "/address/postcode/A%2FB%23C/", query: {} }]);
  await client.close();
});

test("a request that never reached the API is an error, not a silent success", async () => {
  // A transport failure used to come back as status 0, which is not >= 400, so the
  // server reported success and the CLI exited 0.
  const fetchImpl = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const homedata = new HomedataClient({ apiKey: "k", fetchImpl });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await Promise.all([buildServer(homedata).connect(a), client.connect(b)]);
  const result = await client.callTool({ name: "property_core", arguments: { uprn: "100023336956" } });
  assert.equal(result.isError, true);
  await client.close();
});

test("a non-JSON error body is preserved", async () => {
  const { client } = await connect({
    response: () => new Response("upstream is down", { status: 503, headers: { "Content-Type": "text/plain" } }),
  });
  const result = await client.callTool({ name: "property_core", arguments: { uprn: "100023336956" } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.structuredContent), /upstream is down/);
  await client.close();
});
