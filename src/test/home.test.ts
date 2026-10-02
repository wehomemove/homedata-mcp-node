import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import golden from "../../docs/home-chatgpt-app/golden-prompts.json" with { type: "json" };
import { HomedataClient } from "../client.js";
import { checkGoldenSet, type GoldenSet } from "../golden.js";
import { HomeClient } from "../home/client.js";
import { createHomeHttpHandler } from "../home/http.js";
import { HOME_TOOLS } from "../home/server.js";

const ID = "b9f9c51d-987e-41f6-88cb-ffe1d8f2e01b";
const ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function fixtures() {
  const requests: URL[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input)); requests.push(url);
    let body: unknown = {};
    if (url.pathname.startsWith("/api/for-sale/")) body = { displayLocation: "Bath", total: 1, pagination: { current_page: 1, last_page: 1 }, properties: [{ listing_id: ID, latest_price: 325000, bedrooms: 3, agent_name: "Search Agent", added_date: "2026-10-01", reduced_date: "2026-09-20", first_offer_date: "2026-10-02", days_listed: 12, card_html: "MUST NOT LEAK", images: [{ cdn_url: "https://cdn.home.co.uk/full.jpg", thumbnail_cdn_url: "https://cdn.home.co.uk/one.jpg", is_primary: true }] }] };
    else if (url.pathname === `/api/property-details/${ID}`) body = { id: ID, latest_price: 325000, building_number: "12", street_name: "Heritage Close", town_name: "Bath", postcode: "BA2 8TJ", description: "Full description", images: ["/api/image/one"], agent_name: "Example Agent" };
    else if (url.pathname === "/address/find/") body = { results: [{ uprn: "100012345678" }] };
    else if (url.pathname === "/property/100012345678/core/") body = { epc: { rating: "C" }, council_tax: { band: "D" }, flood: { risk: "low" } };
    else body = { source: url.pathname };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const homedata = new HomedataClient({ apiKey: "test", baseUrl: "https://data.test", fetchImpl });
  return { client: new HomeClient({ homeBaseUrl: "https://home.test", homedata, fetchImpl }), requests };
}

async function start() {
  const { client, requests } = fixtures();
  const handler = createHomeHttpHandler({ client, callsPerMinute: 20 });
  const http: HttpServer = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const mcp = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp")));
  return { mcp, requests, stop: async () => { await mcp.close(); http.closeAllConnections(); await new Promise((resolve) => http.close(resolve)); } };
}

test("Home lists only its six no-auth read-only tools and its golden set holds", async () => {
  const { mcp, stop } = await start();
  try {
    const tools = (await mcp.listTools()).tools;
    assert.deepEqual(tools.map((t) => t.name), HOME_TOOLS.map((t) => t.name));
    for (const tool of tools) {
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: true });
      assert.deepEqual((tool as unknown as Record<string, unknown>)["securitySchemes"], undefined); // SDK strips extension fields.
      assert.doesNotMatch(JSON.stringify(tool), /Rightmove|Zoopla|OnTheMarket/i);
    }
    assert.deepEqual(checkGoldenSet(golden as GoldenSet, tools), []);
  } finally { await stop(); }
});

test("search translates filters and strips the multi-megabyte response to card fields", async () => {
  const { mcp, requests, stop } = await start();
  try {
    const answer = await mcp.callTool({ name: "search_homes", arguments: { location: "Bath", listing_type: "sale", max_price: 500000, min_beds: 3, property_type: "semi_detached", new_build: true, sort: "newest", page: 1 } });
    const body = answer.structuredContent as { homes: Array<Record<string, unknown>> };
    assert.equal(body.homes.length, 1);
    assert.equal(body.homes[0]?.["under_offer_date"], "2026-10-02");
    assert.equal("card_html" in body.homes[0]!, false);
    const url = requests[0]!;
    assert.equal(url.pathname, "/api/for-sale/Bath/");
    assert.equal(url.searchParams.get("maxprice"), "500000");
    assert.equal(url.searchParams.get("semi"), "1");
    assert.equal(url.searchParams.get("is_new_build"), "1");
    assert.equal(url.searchParams.get("sort"), "date_desc");
    assert.equal(url.searchParams.get("per_page"), "20");
  } finally { await stop(); }
});

test("get_home returns full listing content and matches it to Homedata enrichment", async () => {
  const { mcp, requests, stop } = await start();
  try {
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const body = answer.structuredContent as Record<string, unknown>;
    assert.equal(body["description"], "Full description");
    assert.deepEqual(body["photos"], ["https://cdn.home.co.uk/full.jpg"]);
    assert.equal((body["enrichment"] as Record<string, unknown>)["uprn"], "100012345678");
    assert.deepEqual(requests.map((u) => u.pathname), [`/api/property-details/${ID}`, "/api/for-sale/BA2%208TJ/", "/address/find/", "/property/100012345678/core/"]);
  } finally { await stop(); }
});

test("Home source and tests stay out of the npm package", () => {
  const cache = mkdtempSync(join(tmpdir(), "home-npm-pack-"));
  try {
    const listing = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, npm_config_cache: cache } })) as Array<{ files: Array<{ path: string }> }>;
    const paths = listing[0]!.files.map((f) => f.path);
    assert.equal(paths.some((path) => path.startsWith("dist/home/") || path.endsWith("/home.test.js")), false, paths.filter((p) => p.includes("home")).join("\n"));
  } finally { rmSync(cache, { recursive: true, force: true }); }
});
