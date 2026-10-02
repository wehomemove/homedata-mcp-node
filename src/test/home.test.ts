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
const ID2 = "c9f9c51d-987e-41f6-88cb-ffe1d8f2e01b";
const ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

type FixtureOptions = {
  detail?: Record<string, unknown>;
  address?: unknown;
  status?: Record<string, number>;
};

function fixtures(options: FixtureOptions = {}) {
  const requests: URL[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input)); requests.push(url);
    let body: unknown = {};
    if (url.pathname.startsWith("/api/for-sale/")) body = { displayLocation: "Bath", total: 2, pagination: { current_page: 1, last_page: 1 }, properties: [ID, ID2].map((listing_id) => ({ listing_id, latest_price: 325000, bedrooms: 3, agent_name: "Search Agent", added_date: "2026-10-01", reduced_date: "2026-09-20", first_offer_date: "2026-10-02", days_listed: 12, card_html: "MUST NOT LEAK", images: [{ cdn_url: "https://cdn.home.co.uk/full.jpg", thumbnail_cdn_url: "https://cdn.home.co.uk/one.jpg", is_primary: true }] })) };
    else if (url.pathname.startsWith("/api/property-details/")) body = { id: url.pathname.split("/").pop(), latest_price: 325000, building_number: "12", street_name: "Heritage Close", town_name: "Bath", postcode: "BA2 8TJ", description: "Full description", images: ["/api/image/one"], agent_name: "Example Agent", ...options.detail };
    else if (url.pathname === "/address/find/") body = options.address ?? { results: [{ uprn: "100012345678", postcode: "BA2 8TJ", building_number: "12", full_address: "12 Heritage Close, Bath, BA2 8TJ" }] };
    else if (url.pathname === "/property/100012345678/core/") body = { epc: { rating: "C" }, council_tax: { band: "D" }, flood: { risk: "low" } };
    else body = { source: url.pathname };
    const status = options.status?.[url.pathname] ?? 200;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const homedata = new HomedataClient({ apiKey: "test", baseUrl: "https://data.test", fetchImpl });
  return { client: new HomeClient({ homeBaseUrl: "https://home.test", homedata, fetchImpl }), requests };
}

async function start(fixtureOptions: FixtureOptions = {}, httpOptions: { callsPerMinute?: number; enrichmentsPerMinute?: number; clientIpHeader?: string } = {}) {
  const { client, requests } = fixtures(fixtureOptions);
  const handler = createHomeHttpHandler({ client, callsPerMinute: 20, ...httpOptions });
  const http: HttpServer = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const mcp = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp")));
  return { base, mcp, requests, stop: async () => { await mcp.close(); http.closeAllConnections(); await new Promise((resolve) => http.close(resolve)); } };
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
    assert.equal(body.homes.length, 2);
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

test("get_home uses the property-details UPRN before address matching", async () => {
  const { mcp, requests, stop } = await start({ detail: { uprn: "100012345678" } });
  try {
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const body = answer.structuredContent as Record<string, unknown>;
    assert.equal(body["description"], "Full description");
    assert.deepEqual(body["photos"], ["https://cdn.home.co.uk/full.jpg"]);
    const enrichment = body["enrichment"] as Record<string, unknown>;
    assert.equal(enrichment["uprn"], "100012345678");
    assert.equal(enrichment["scope"], "home");
    assert.equal(enrichment["source"], "listing_uprn");
    assert.deepEqual(requests.map((u) => u.pathname), [`/api/property-details/${ID}`, "/api/for-sale/BA2%208TJ/", "/property/100012345678/core/"]);
  } finally { await stop(); }
});

test("get_home falls back to an exact address match when details have no UPRN", async () => {
  const { mcp, requests, stop } = await start();
  try {
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const enrichment = (answer.structuredContent as Record<string, unknown>)["enrichment"] as Record<string, unknown>;
    assert.equal(enrichment["scope"], "home");
    assert.equal(enrichment["source"], "exact_address_match");
    assert.equal(enrichment["uprn"], "100012345678");
    assert.ok(requests.some((url) => url.pathname === "/address/find/"));
  } finally { await stop(); }
});

test("get_home returns clearly labelled postcode facts when no UPRN can be found", async () => {
  const { mcp, requests, stop } = await start({ detail: { building_number: null, building_name: null } });
  try {
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const enrichment = (answer.structuredContent as Record<string, unknown>)["enrichment"] as Record<string, unknown>;
    assert.equal(enrichment["available"], true);
    assert.equal(enrichment["scope"], "area");
    assert.match(String(enrichment["notice"]), /not facts about this home/i);
    const area = enrichment["area"] as Record<string, unknown>;
    assert.deepEqual(Object.keys(area), ["postcode", "crime", "schools", "broadband", "deprivation", "price_growth"]);
    assert.equal(requests.some((url) => url.pathname === "/address/find/" || url.pathname.includes("/core/")), false);
    assert.ok(requests.some((url) => url.pathname === "/schools/nearby"));
    assert.ok(requests.some((url) => url.pathname === "/price-growth/BA2/"));
  } finally { await stop(); }
});

test("get_home never turns an inexact address candidate into home facts", async () => {
  const { mcp, requests, stop } = await start({ address: { results: [{ uprn: "100012345678", postcode: "BA2 8TJ", building_number: "14", full_address: "14 Heritage Close, Bath, BA2 8TJ" }] } });
  try {
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const enrichment = (answer.structuredContent as Record<string, unknown>)["enrichment"] as Record<string, unknown>;
    assert.equal(enrichment["scope"], "area");
    assert.equal(requests.some((url) => url.pathname.includes("/core/")), false);
  } finally { await stop(); }
});

test("compare_homes gets two homes and rejects counts outside two to four", async () => {
  const { mcp, stop } = await start({}, { enrichmentsPerMinute: 4 });
  try {
    const answer = await mcp.callTool({ name: "compare_homes", arguments: { listing_ids: [ID, ID2] } });
    assert.equal(((answer.structuredContent as { homes: unknown[] }).homes).length, 2);
    const invalid = await mcp.callTool({ name: "compare_homes", arguments: { listing_ids: [ID] } });
    assert.equal(invalid.isError, true);
  } finally { await stop(); }
});

test("area_insights normalises the postcode, uses its outcode and wraps an upstream failure", async () => {
  const { mcp, requests, stop } = await start({ status: { "/crime/": 503 } });
  try {
    const answer = await mcp.callTool({ name: "area_insights", arguments: { postcode: "ba11lz" } });
    const body = answer.structuredContent as Record<string, unknown>;
    assert.equal(body["postcode"], "BA1 1LZ");
    assert.equal((body["crime"] as Record<string, unknown>)["status_code"], 503);
    assert.ok(requests.some((url) => url.pathname === "/price-growth/BA1/"));
    assert.ok(requests.filter((url) => url.hostname === "data.test").every((url) => url.searchParams.get("postcode") === "BA1 1LZ" || url.pathname === "/price-growth/BA1/"));
    const invalid = await mcp.callTool({ name: "area_insights", arguments: { postcode: "find BA1 1LZ please" } });
    assert.equal(invalid.isError, true);
  } finally { await stop(); }
});

test("both affordability calculators send validated arguments", async () => {
  const { mcp, requests, stop } = await start();
  try {
    await mcp.callTool({ name: "calculate_stamp_duty", arguments: { price: 450000, buyer_type: "first_time" } });
    await mcp.callTool({ name: "calculate_mortgage", arguments: { price: 400000, deposit: 60000, rate: 0, term: 30 } });
    assert.ok(requests.some((url) => url.pathname === "/calculators/stamp-duty/" && url.searchParams.get("buyer_type") === "first_time"));
    assert.ok(requests.some((url) => url.pathname === "/calculators/mortgage/" && url.searchParams.get("rate") === "0"));
    const invalid = await mcp.callTool({ name: "calculate_mortgage", arguments: { price: 400000, deposit: 400000, rate: 4, term: 30 } });
    assert.equal(invalid.isError, true);
  } finally { await stop(); }
});

test("health is open, non-POST MCP is refused and upstream outages are distinct", async () => {
  const { base, mcp, stop } = await start({ status: { [`/api/property-details/${ID}`]: 503 } });
  try {
    assert.deepEqual(await (await fetch(base + "/healthz")).json(), { ok: true, service: "home", version: "1.0.0" });
    assert.equal((await fetch(base + "/mcp")).status, 405);
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    assert.equal((answer.structuredContent as Record<string, unknown>)["error"], "upstream_unavailable");
  } finally { await stop(); }
});

test("limits are per caller, count every batch call and cap enrichment units separately", async () => {
  const { base, stop } = await start({}, { callsPerMinute: 1, enrichmentsPerMinute: 1, clientIpHeader: "x-test-client-ip" });
  const rpc = (id: number, name: string, args: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const post = (body: unknown, ip: string) => fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-Test-Client-IP": ip }, body: JSON.stringify(body) });
  try {
    // Two calls in one accepted SDK batch must consume two slots, so a cap of
    // one rejects the whole request before either call reaches an upstream.
    assert.equal((await post([rpc(1, "search_homes", { location: "Bath", listing_type: "sale" }), rpc(2, "search_homes", { location: "Bath", listing_type: "sale" })], "192.0.2.1")).status, 429);
    // A different caller has a separate bucket.
    assert.equal((await post(rpc(3, "search_homes", { location: "Bath", listing_type: "sale" }), "192.0.2.2")).status, 200);
    assert.equal((await post(rpc(4, "search_homes", { location: "Bath", listing_type: "sale" }), "192.0.2.2")).status, 429);
    // Comparison consumes one enrichment unit per home, not one per tool call.
    assert.equal((await post(rpc(5, "compare_homes", { listing_ids: [ID, ID2] }), "192.0.2.3")).status, 429);
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
