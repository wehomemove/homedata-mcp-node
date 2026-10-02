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
const SALE = { id: 1, price: 538000, sold_date: "2026-08-21", postcode: "BA2 3PL", property_type: "Terraced", full_address: "17 CLARENCE STREET, BATH, BA2 3PL", display_address: "17 CLARENCE STREET, BATH, BA2 3PL", bedrooms: 2, latitude: 51.39, longitude: -2.35 };
const ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

type FixtureOptions = {
  detail?: Record<string, unknown>;
  address?: unknown;
  reverseGeocode?: unknown;
  status?: Record<string, number>;
  responseBody?: Record<string, unknown>;
  logger?: (message: string, detail: unknown) => void;
};

function fixtures(options: FixtureOptions = {}) {
  const requests: URL[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input)); requests.push(url);
    let body: unknown = {};
    if (url.pathname.startsWith("/api/for-sale/")) body = { displayLocation: "Bath", total: 2, pagination: { current_page: 1, last_page: 1 }, properties: [ID, ID2].map((listing_id) => ({ listing_id, latest_price: 325000, bedrooms: 3, agent_name: "Search Agent", added_date: "2026-10-01", reduced_date: "2026-09-20", first_offer_date: "2026-10-02", days_listed: 12, card_html: "MUST NOT LEAK", images: [{ cdn_url: "https://cdn.home.co.uk/full.jpg", thumbnail_cdn_url: "https://cdn.home.co.uk/one.jpg", is_primary: true }] })) };
    else if (url.pathname.startsWith("/api/property-details/")) body = { id: url.pathname.split("/").pop(), latest_price: 325000, building_number: "12", street_name: "Heritage Close", town_name: "Bath", postcode: "BA2 8TJ", description: "Full description", images: ["/api/image/one"], agent_name: "Example Agent", ...options.detail };
    else if (url.pathname === "/api/reverse-geocode") body = options.reverseGeocode ?? { success: true, place_name: "Heritage Close, Bath, BA2 8TJ, United Kingdom", context: [{ id: "postcode.123", text: "BA2 8TJ" }] };
    else if (url.pathname === "/address/find/") body = options.address ?? { results: [{ uprn: "100012345678", postcode: "BA2 8TJ", building_number: "12", full_address: "12 Heritage Close, Bath, BA2 8TJ" }] };
    else if (url.pathname === "/property/100012345678/core/") body = { epc: { rating: "C" }, council_tax: { band: "D" }, flood: { risk: "low" } };
    else if (url.pathname === "/sold-properties/ba1-1/") body = { isNationalSearch: false, total: 2, filters: { gid: 121 }, pagination: { current_page: 1, last_page: 1 }, properties: [] };
    else if (url.pathname === "/sold-properties/ba2-3/") body = { isNationalSearch: false, total: 40, filters: { gid: 122 }, pagination: { current_page: 1, last_page: 2, total: 40 }, properties: [SALE, { ...SALE, postcode: "BA2 3QQ", price: 410000 }] };
    else if (url.pathname === "/sold-properties/ba1/") body = { isNationalSearch: false, total: 296, filters: { gid: 120 }, pagination: { current_page: 1, last_page: 15, total: 296 }, properties: [{ ...SALE, postcode: "BA1 5NS" }] };
    else if (url.pathname.startsWith("/sold-properties/")) body = { isNationalSearch: true, total: null, filters: { gid: null }, pagination: null, properties: [SALE] };
    else if (url.pathname === "/api/agents/search/bath/lettings") body = { searchMode: "property", displayLocation: "Bath", boundaryName: "Bath", agents: [
      { id: 1, agent_name: "Partner Lettings", branch_name: "Bath", property_count: 6, boundary_listing_count: 6, is_hm_agent: true, card_html: "MUST NOT LEAK", email: "x@example.test" },
      { id: 2, agent_name: "Busy Lettings", branch_name: "Bath", property_count: 23, boundary_listing_count: 23, address_lines: "1 Saville Row, Bath", postcode: "BA1 2QP", website_url: "https://busy.example" },
      { id: 3, agent_name: "Featured Only", branch_name: "Bath", property_count: 0, boundary_listing_count: 0, is_founder_250: true },
    ] };
    else if (url.pathname === "/api/agents/search/london/sales" || url.pathname === "/api/agents/search/leeds/sales") {
      // Partner-first page order, as live: the busiest agent is on a later page.
      const page = Number(url.searchParams.get("page") ?? 1);
      const pages = [
        [{ id: 66292, agent_name: "Exp UK", branch_name: "London", boundary_listing_count: 1095, property_count: 1095, is_hm_agent: true }, { id: 7, agent_name: "Featured Only", boundary_listing_count: 0, property_count: 0, is_founder_250: true }],
        [{ id: 8, agent_name: "Quiet Agent", branch_name: "Soho", boundary_listing_count: 3, property_count: 3 }],
        [{ id: 65570, agent_name: "Purplebricks", branch_name: "London", boundary_listing_count: 1133, property_count: 1133, address_lines: "1 Example Road, London", postcode: "W10 6TR" }],
      ];
      const london = url.pathname.includes("london");
      body = { searchMode: "property", boundaryName: london ? "London" : "Leeds", total: 4, pagination: { current_page: page, last_page: 3, total: 4 },
        agents: london ? (page === 1 ? pages[0] : []) : pages[page - 1],
        ...(london ? { allPins: pages.flat().map(({ id, agent_name, property_count }) => ({ id, agent_name, property_count, postcode: "PIN" })) } : {}) };
    }
    else if (url.pathname.startsWith("/api/agents/search/")) body = { searchMode: "located", agents: [{ id: 9, agent_name: "Somewhere Else", property_count: 500 }] };
    else if (url.pathname === "/rental-prices/postcode/ba1/current") body = { location: { tier: "postcode", code: "BA1", name: "BA1" }, currency: "GBP", frequency: "pcm", summary: { listings: 232, median_rent: 1600 }, by_bedrooms: [{ bedrooms: "2", listings: 58, median_rent: 1685 }], by_property_type: [] };
    else if (url.pathname.startsWith("/rental-prices/")) return new Response("<!DOCTYPE html><html></html>", { status: 200, headers: { "Content-Type": "text/html" } });
    else body = { source: url.pathname };
    body = options.responseBody?.[url.pathname] ?? body;
    const status = options.status?.[url.pathname] ?? 200;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const homedata = new HomedataClient({ apiKey: "test", baseUrl: "https://data.test", fetchImpl });
  return { client: new HomeClient({ homeBaseUrl: "https://home.test", homedata, fetchImpl, logger: options.logger }), requests };
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

test("Home lists only its nine no-auth read-only tools and its golden set holds", async () => {
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

test("search applies market signals across at most three pages and reports incomplete coverage", async () => {
  const requests: URL[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input)); requests.push(url);
    const page = Number(url.searchParams.get("page"));
    const properties = [
      { listing_id: `${page}9f9c51d-987e-41f6-88cb-ffe1d8f2e01b`, days_listed: 100, reduced_date: "2026-09-25T00:00:00Z", added_date: "2026-06-01T00:00:00Z" },
      { listing_id: `${page}8f9c51d-987e-41f6-88cb-ffe1d8f2e01b`, days_listed: 10, reduced_date: "2026-09-01T00:00:00Z", added_date: "2026-09-30T00:00:00Z" },
    ];
    return new Response(JSON.stringify({ displayLocation: "Bath", total: 10, pagination: { current_page: page, last_page: 5 }, properties }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const homedata = new HomedataClient({ apiKey: "test", baseUrl: "https://data.test", fetchImpl });
  const client = new HomeClient({ homeBaseUrl: "https://home.test", homedata, fetchImpl, now: () => new Date("2026-10-02T00:00:00Z") });
  const body = await client.search({ location: "Bath", listing_type: "sale", reduced_within_days: 14, on_market_at_least_days: 90 });
  assert.equal((body["homes"] as unknown[]).length, 3);
  assert.equal(body["total"], null);
  assert.equal(body["source_total"], 10);
  assert.equal(body["matching_homes_returned"], 3);
  assert.equal(body["pages_scanned"], 3);
  assert.equal(body["results_limited"], true);
  assert.equal(body["next_page"], 4);
  assert.match(String(body["note"]), /page 4.*continue/i);
  assert.deepEqual(requests.map((url) => url.searchParams.get("page")), ["1", "2", "3"]);
  assert.ok(requests.every((url) => !url.searchParams.has("reduced_within_days") && !url.searchParams.has("on_market_at_least_days")));
});

test("market-signal continuation returns no duplicates or gaps when a source page would cross the cap", async () => {
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page"));
    const properties = Array.from({ length: 15 }, (_, index) => ({
      listing_id: `00000000-0000-4000-8000-${String(page * 100 + index).padStart(12, "0")}`,
      days_listed: 100,
    }));
    return new Response(JSON.stringify({ total: 60, pagination: { current_page: page, last_page: 4 }, properties }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const homedata = new HomedataClient({ apiKey: "test", baseUrl: "https://data.test", fetchImpl });
  const client = new HomeClient({ homeBaseUrl: "https://home.test", homedata, fetchImpl });
  const first = await client.search({ location: "Bath", listing_type: "sale", on_market_at_least_days: 90 });
  assert.equal(first["next_page"], 2);
  const second = await client.search({ location: "Bath", listing_type: "sale", on_market_at_least_days: 90, page: Number(first["next_page"]) });
  assert.equal(second["next_page"], 3);
  const ids = [...first["homes"] as Array<Record<string, unknown>>, ...second["homes"] as Array<Record<string, unknown>>].map((home) => home["id"]);
  assert.equal(new Set(ids).size, 30);
  assert.deepEqual(ids, [1, 2].flatMap((page) => Array.from({ length: 15 }, (_, index) => `00000000-0000-4000-8000-${String(page * 100 + index).padStart(12, "0")}`)));
});

test("day windows include today and the exact London calendar-day boundary", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ total: 2, pagination: { current_page: 1, last_page: 1 }, properties: [
    { listing_id: ID, reduced_date: "2026-07-15" },
    { listing_id: ID2, reduced_date: "2026-07-01" },
  ] }), { headers: { "Content-Type": "application/json" } })) as typeof fetch;
  const homedata = new HomedataClient({ apiKey: "test", baseUrl: "https://data.test", fetchImpl });
  const client = new HomeClient({ homeBaseUrl: "https://home.test", homedata, fetchImpl, now: () => new Date("2026-07-14T23:30:00Z") });
  const body = await client.search({ location: "Bath", listing_type: "sale", reduced_within_days: 14 });
  assert.deepEqual((body["homes"] as Array<Record<string, unknown>>).map((home) => home["id"]), [ID, ID2]);
});

test("new-listing market signal stops at the last source page and validates day counts", async () => {
  const requests: URL[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input)); requests.push(url);
    const page = Number(url.searchParams.get("page"));
    return new Response(JSON.stringify({ total: 2, pagination: { current_page: page, last_page: 2 }, properties: [
      { listing_id: page === 1 ? ID : ID2, added_date: page === 1 ? "2026-10-01T00:00:00Z" : "2026-09-01T00:00:00Z" },
    ] }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const homedata = new HomedataClient({ apiKey: "test", baseUrl: "https://data.test", fetchImpl });
  const client = new HomeClient({ homeBaseUrl: "https://home.test", homedata, fetchImpl, now: () => new Date("2026-10-02T00:00:00Z") });
  const body = await client.search({ location: "Bath", listing_type: "sale", new_within_days: 3 });
  assert.equal((body["homes"] as unknown[]).length, 1);
  assert.equal(body["results_limited"], false);
  assert.equal("note" in body, false);
  await assert.rejects(() => client.search({ location: "Bath", listing_type: "sale", new_within_days: 0 }), /starting at 1/);
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

test("get_home reverse geocodes coordinates when property details omit the postcode", async () => {
  const { mcp, requests, stop } = await start({ detail: { postcode: null, building_number: null, building_name: null, street_name: null, town_name: null, latitude: 51.357, longitude: -2.37 } });
  try {
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const enrichment = (answer.structuredContent as Record<string, unknown>)["enrichment"] as Record<string, unknown>;
    assert.equal(enrichment["scope"], "area");
    assert.equal(enrichment["postcode"], "BA2 8TJ");
    const reverse = requests.find((url) => url.pathname === "/api/reverse-geocode");
    assert.equal(reverse?.searchParams.get("lat"), "51.357");
    assert.equal(reverse?.searchParams.get("lng"), "-2.37");
    assert.ok(requests.some((url) => url.pathname === "/api/for-sale/BA2%208TJ/"));
  } finally { await stop(); }
});

test("get_home reports unavailable only when it has no UPRN, postcode or coordinates", async () => {
  const { mcp, requests, stop } = await start({ detail: { uprn: null, postcode: null, building_number: null, building_name: null, street_name: null, town_name: null, latitude: null, longitude: null } });
  try {
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const enrichment = (answer.structuredContent as Record<string, unknown>)["enrichment"] as Record<string, unknown>;
    assert.equal(enrichment["available"], false);
    assert.match(String(enrichment["reason"]), /No UPRN or valid full postcode/);
    assert.equal(requests.some((url) => url.hostname === "data.test"), false);
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

test("area_insights normalises the postcode, uses its outcode and marks an upstream failure", async () => {
  const { mcp, requests, stop } = await start({ status: { "/crime/": 503 } });
  try {
    const answer = await mcp.callTool({ name: "area_insights", arguments: { postcode: "ba11lz" } });
    const body = answer.structuredContent as Record<string, unknown>;
    assert.equal(body["postcode"], "BA1 1LZ");
    assert.deepEqual(body["crime"], { available: false, reason: "Not available right now." });
    assert.ok(requests.some((url) => url.pathname === "/price-growth/BA1/"));
    assert.ok(requests.filter((url) => url.hostname === "data.test").every((url) => url.searchParams.get("postcode") === "BA1 1LZ" || url.pathname === "/price-growth/BA1/"));
    const invalid = await mcp.callTool({ name: "area_insights", arguments: { postcode: "find BA1 1LZ please" } });
    assert.equal(invalid.isError, true);
  } finally { await stop(); }
});

test("sold_prices searches the postcode sector, widens a thin one and never reports national sales", async () => {
  const { mcp, requests, stop } = await start();
  try {
    const sector = await mcp.callTool({ name: "sold_prices", arguments: { postcode: "ba23pl", property_type: "terraced", months: 24, max_price: 600000 } });
    const body = sector.structuredContent as Record<string, unknown> & { sales: Array<Record<string, unknown>> };
    assert.equal(body["area"], "BA2 3");
    assert.equal(body["area_type"], "postcode sector");
    assert.deepEqual(body.sales.map((sale) => sale["same_postcode"]), [true, false]);
    assert.deepEqual(Object.keys(body.sales[0]!).sort(), ["address", "bedrooms", "postcode", "price", "property_type", "same_postcode", "sold_date"]);
    assert.match(String(body["not_a_valuation"]), /not a valuation/);
    const url = requests.find((u) => u.pathname === "/sold-properties/ba2-3/")!;
    assert.equal(url.searchParams.get("daterange"), "24months");
    assert.equal(url.searchParams.get("terraced"), "1");
    assert.equal(url.searchParams.get("maxprice"), "600000");
    assert.equal(url.searchParams.get("sort"), "date_desc");

    const thin = await mcp.callTool({ name: "sold_prices", arguments: { postcode: "BA1 1LZ" } });
    assert.equal((thin.structuredContent as Record<string, unknown>)["area"], "BA1");
    assert.equal((thin.structuredContent as Record<string, unknown>)["area_type"], "postcode district");

    const unknown = await mcp.callTool({ name: "sold_prices", arguments: { postcode: "ZZ9 9ZZ" } });
    assert.equal(unknown.isError, true);
    assert.equal((unknown.structuredContent as Record<string, unknown>)["error"], "invalid_request");
    for (const bad of [{ postcode: "my house" }, { postcode: "BA1", months: 7 }, { postcode: "BA1", min_price: 5, max_price: 1 }]) {
      assert.equal((await mcp.callTool({ name: "sold_prices", arguments: bad })).isError, true);
    }
  } finally { await stop(); }
});

test("find_agents ranks by homes listed in the area, not by partner placement", async () => {
  const { mcp, requests, stop } = await start();
  try {
    const answer = await mcp.callTool({ name: "find_agents", arguments: { location: "Bath", agent_type: "lettings" } });
    const body = answer.structuredContent as Record<string, unknown> & { agents: Array<Record<string, unknown>> };
    assert.deepEqual(body.agents.map((a) => [a["rank"], a["name"], a["homes_to_let_here"]]), [[1, "Busy Lettings", 23], [2, "Partner Lettings", 6]]);
    assert.equal(body["agents_with_listings"], 2);
    assert.equal(body.agents[0]!["profile_url"], "https://home.co.uk/agents/2/busy-lettings");
    assert.doesNotMatch(JSON.stringify(body), /MUST NOT LEAK|x@example\.test/);
    const url = requests.find((u) => u.pathname.startsWith("/api/agents/search/"))!;
    assert.equal(url.pathname, "/api/agents/search/bath/lettings");
    assert.equal(url.searchParams.get("per_page"), "120");

    // Outside a matched boundary the counts are each agent's whole stock, which cannot rank an area.
    const located = await mcp.callTool({ name: "find_agents", arguments: { location: "Nowhere", agent_type: "sales" } });
    assert.equal(located.isError, true);
    assert.equal((await mcp.callTool({ name: "find_agents", arguments: { location: "Bath", agent_type: "buyers" } })).isError, true);
    assert.equal((await mcp.callTool({ name: "find_agents", arguments: { location: "Bath", agent_type: "sales", limit: 50 } })).isError, true);
  } finally { await stop(); }
});

test("find_agents ranks the whole area, so an agent on a later directory page can rank first", async () => {
  const { mcp, requests, stop } = await start();
  try {
    // allPins carries every agent's in-area count in the first answer: one request.
    const pinned = await mcp.callTool({ name: "find_agents", arguments: { location: "London", agent_type: "sales", limit: 3 } });
    const fromPins = (pinned.structuredContent as { agents: Array<Record<string, unknown>>; agents_with_listings: number });
    assert.deepEqual(fromPins.agents.map((a) => [a["name"], a["homes_for_sale_here"]]), [["Purplebricks", 1133], ["Exp UK", 1095], ["Quiet Agent", 3]]);
    assert.equal(fromPins.agents_with_listings, 3);
    assert.equal(fromPins.agents[1]!["branch"], "London"); // card details still joined where the page had them
    assert.equal(requests.filter((u) => u.pathname === "/api/agents/search/london/sales").length, 1);

    // Without pins, every page is read before ranking.
    const paged = await mcp.callTool({ name: "find_agents", arguments: { location: "Leeds", agent_type: "sales" } });
    const fromPages = (paged.structuredContent as { agents: Array<Record<string, unknown>> }).agents;
    assert.deepEqual(fromPages.map((a) => a["name"]), ["Purplebricks", "Exp UK", "Quiet Agent"]);
    assert.equal(fromPages[0]!["office"], "1 Example Road, London");
    assert.deepEqual(requests.filter((u) => u.pathname === "/api/agents/search/leeds/sales").map((u) => u.searchParams.get("page") ?? "1"), ["1", "2", "3"]);
  } finally { await stop(); }
});

test("typical_rents reads the district's rental price data and refuses a page that is not JSON", async () => {
  const { mcp, requests, stop } = await start();
  try {
    const answer = await mcp.callTool({ name: "typical_rents", arguments: { location: "BA1 1LZ" } });
    const body = answer.structuredContent as Record<string, unknown>;
    assert.equal((body["summary"] as Record<string, unknown>)["median_rent"], 1600);
    assert.equal(body["frequency"], "pcm");
    assert.match(String(body["note"]), /whole BA1 postcode district/);
    assert.match(String(body["not_achieved_rents"]), /asking rents/);
    assert.equal(requests[0]!.pathname, "/rental-prices/postcode/ba1/current");
    const town = await mcp.callTool({ name: "typical_rents", arguments: { location: "Milton Keynes" } });
    assert.equal(town.isError, true);
    assert.equal(requests[1]!.pathname, "/rental-prices/location/milton-keynes/current");
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

test("billing and upstream details never reach enrichment, search or calculator results", async () => {
  const billing = { error: { code: "insufficient_tokens", message: "£12.34 required; balance £0.00", topup_url: "https://homedata.co.uk/subscription" } };
  const logs: Array<[string, unknown]> = [];
  const failures = {
    detail: { uprn: "100012345678" },
    status: { "/property/100012345678/core/": 402, "/crime/": 402, "/calculators/stamp-duty/": 402, "/api/for-sale/Bath/": 502 },
    responseBody: { "/property/100012345678/core/": billing, "/crime/": billing, "/calculators/stamp-duty/": billing, "/api/for-sale/Bath/": billing },
    logger: (message: string, detail: unknown) => logs.push([message, detail]),
  };
  const { mcp, stop } = await start(failures);
  try {
    const answers = [
      await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } }),
      await mcp.callTool({ name: "area_insights", arguments: { postcode: "BA1 1LZ" } }),
      await mcp.callTool({ name: "search_homes", arguments: { location: "Bath", listing_type: "sale" } }),
      await mcp.callTool({ name: "calculate_stamp_duty", arguments: { price: 450000, buyer_type: "first_time" } }),
    ];
    assert.deepEqual((answers[0]!.structuredContent as Record<string, unknown>)["enrichment"], { available: false, reason: "Not available right now." });
    assert.deepEqual((answers[1]!.structuredContent as Record<string, unknown>)["crime"], { available: false, reason: "Not available right now." });
    assert.deepEqual(answers[2]!.structuredContent, { available: false, reason: "Not available right now." });
    assert.deepEqual(answers[3]!.structuredContent, { available: false, reason: "Not available right now." });
    for (const answer of answers) {
      const wire = JSON.stringify(answer);
      assert.doesNotMatch(wire, /homedata\.co\.uk|subscription|insufficient_tokens|12\.34|0\.00|status_code|402|502/i);
      assert.match(wire, /Not available right now/);
    }
    assert.equal(logs.length, 4);
    assert.ok(logs.every(([, detail]) => JSON.stringify(detail).includes("insufficient_tokens")));
  } finally { await stop(); }
});

test("health is open, non-POST MCP is refused and upstream outages are distinct", async () => {
  const { base, mcp, stop } = await start({ status: { [`/api/property-details/${ID}`]: 503 } });
  try {
    assert.deepEqual(await (await fetch(base + "/healthz")).json(), { ok: true, service: "home", version: "1.0.0" });
    assert.equal((await fetch(base + "/mcp")).status, 405);
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    assert.deepEqual(answer.structuredContent, { available: false, reason: "Not available right now." });
  } finally { await stop(); }
});

test("every Home error answer is no-store, so Cloudflare never caches it", async () => {
  const { base, stop } = await start({}, { callsPerMinute: 1 });
  const post = (body: string, accept = "application/json, text/event-stream") => fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: accept }, body });
  const call = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_homes", arguments: { location: "Bath", listing_type: "sale" } } });
  try {
    const answers: Array<[string, Response, number]> = [
      ["unknown path", await fetch(base + "/.well-known/openai-apps-challenge"), 404],
      ["GET on MCP", await fetch(base + "/mcp"), 405],
      ["bad JSON", await post("not json"), 400],
      ["no Accept", await post(call, "text/plain"), 406],
    ];
    await post(call);
    answers.push(["over the cap", await post(call), 429]);
    for (const [name, response, status] of answers) {
      assert.equal(response.status, status, name);
      assert.equal(response.headers.get("cache-control"), "no-store", name);
    }
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
