/**
 * End to end over stdio: a real MCP client session drives the built server
 * process, which calls a local stand-in for the Homedata API.
 *
 * This proves the whole path in one test: process start, initialize, tools/list,
 * tools/call, the HTTP request that reaches "the API", the response that comes
 * back to the client, and the cost the API reported.
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { VERSION } from "../index.js";
import { staticTools, tools } from "../manifest.js";

const DIST = dirname(dirname(fileURLToPath(import.meta.url)));

interface Received {
  path: string;
  query: Record<string, string>;
  authorization: string | undefined;
}

async function standInApi(): Promise<{ url: string; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server: HttpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    received.push({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      authorization: req.headers.authorization,
    });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "X-Tokens-Charged": "2",
      "X-Tokens-Balance": "998",
    });
    res.end(JSON.stringify({ echo: url.pathname }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("stdio round trip", async () => {
  const api = await standInApi();
  after(() => api.close());

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(DIST, "server.js")],
    env: { ...process.env, HOMEDATA_API_KEY: "hk_test_smoke", HOMEDATA_BASE_URL: api.url } as Record<string, string>,
  });
  const client = new Client({ name: "smoke", version: "1" }, { capabilities: {} });
  await client.connect(transport);

  const info = client.getServerVersion();
  assert.equal(info?.name, "homedata");
  assert.equal(info?.version, VERSION);

  const listed = (await client.listTools()).tools;
  assert.deepEqual(
    listed.map((t) => t.name).sort(),
    [...tools().map((t) => t.name), ...staticTools().map((t) => t.name)].sort(),
  );

  const result = await client.callTool({ name: "address_find", arguments: { q: "10 Downing Street" } });
  assert.deepEqual(result.structuredContent, { echo: "/address/find/" });
  assert.deepEqual(result._meta, { homedata: { tokens_charged: "2", tokens_balance: "998" } });

  await client.callTool({ name: "check_homedata_api_key", arguments: {} });

  assert.deepEqual(
    api.received,
    [{ path: "/address/find/", query: { q: "10 Downing Street" }, authorization: "Api-Key hk_test_smoke" }],
    "expected exactly one API request, from address_find; the key check must send none",
  );
  await client.close();
});
