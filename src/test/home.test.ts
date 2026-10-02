import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import { TtlCache } from "../home/cache.js";
import { cleanListingDescription, HomeClient, HomeUpstreamError, type HomeClientOptions } from "../home/client.js";
import { ACCOUNT_TOOLS, SAVED_SEARCH_TYPES, type AccountSettings } from "../home/account.js";
import { accountFromEnv, createHomeHttpHandler, mapboxTokenFromEnv } from "../home/http.js";
import { HOME_RULES } from "../home/plugin.js";
import { buildHomeServer, HOME_TOOLS } from "../home/server.js";
import { buildManifest, readSkills, validatePackage, validateSkills, type Manifest, type Skill } from "../plugin-package.js";
import { HOME_WIDGET_HTML, HOME_WIDGET_URI, homeMapLayout, homeMapProject, homePinLabel, humaniseDaysListed } from "../home/widget.js";

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
  client?: Pick<HomeClientOptions, "now" | "enrichmentTtlMs" | "cachedHomes" | "cachedAreas">;
};

function fixtures(options: FixtureOptions = {}) {
  const requests: URL[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input)); requests.push(url);
    let body: unknown = {};
    if (url.pathname.startsWith("/api/for-sale/")) body = { displayLocation: "Bath", total: 2, pagination: { current_page: 1, last_page: 1 }, properties: [ID, ID2].map((listing_id, index) => ({ listing_id, latest_price: 325000, bedrooms: 3, postcode: "BA1 1LZ", is_new: true, latitude: 51.38 + index / 100, longitude: -2.36, agent_name: "Search Agent", added_date: "2026-10-01", reduced_date: "2026-09-20", first_offer_date: "2026-10-02", days_listed: 12, card_html: "MUST NOT LEAK", images: [{ cdn_url: "https://cdn.home.co.uk/full.jpg", thumbnail_cdn_url: "https://cdn.home.co.uk/one.jpg", is_primary: true }] })) };
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
    else if (url.pathname === "/api/v1/rental-prices/BA1%201LZ") body = { area: { type: "postcode_district", code: "ba1", name: "BA1" }, currency: "GBP", rent_period: "per_calendar_month", homes_to_rent: 232, median_asking_rent_pcm_pounds: 1600, by_bedrooms: [{ bedrooms: "2", homes_to_rent: 58, median_asking_rent_pcm_pounds: 1685 }], by_property_type: [] };
    else if (url.pathname.startsWith("/api/v1/rental-prices/")) return new Response(JSON.stringify({ error: "area_not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    else body = { source: url.pathname };
    body = options.responseBody?.[url.pathname] ?? body;
    const status = options.status?.[url.pathname] ?? 200;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const homedata = new HomedataClient({ apiKey: "test", baseUrl: "https://data.test", fetchImpl });
  return { client: new HomeClient({ homeBaseUrl: "https://home.test", homedata, fetchImpl, logger: options.logger, ...options.client }), requests };
}

async function start(fixtureOptions: FixtureOptions = {}, httpOptions: { callsPerMinute?: number; enrichmentsPerMinute?: number; clientIpHeader?: string; appsChallenge?: string; account?: AccountSettings; mapboxToken?: string } = {}) {
  const { client, requests } = fixtures(fixtureOptions);
  const handler = createHomeHttpHandler({ client, callsPerMinute: 20, ...httpOptions });
  const http: HttpServer = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const mcp = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp")));
  return { base, mcp, requests, stop: async () => { await mcp.close(); http.closeAllConnections(); await new Promise((resolve) => http.close(resolve)); } };
}

test("without account settings Home lists its no-auth read-only data and render tools and publishes no OAuth metadata", async () => {
  const { base, mcp, stop } = await start();
  try {
    const tools = (await mcp.listTools()).tools;
    assert.deepEqual(tools.map((t) => t.name), HOME_TOOLS.map((t) => t.name));
    for (const tool of tools) {
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: true });
      assert.deepEqual((tool as unknown as Record<string, unknown>)["securitySchemes"], undefined); // SDK strips extension fields.
      assert.doesNotMatch(JSON.stringify(tool), /Rightmove|Zoopla|OnTheMarket/i);
    }
    const renderNames = new Set(["render_home_listings", "render_home_detail"]);
    for (const tool of tools) {
      const uri = (tool._meta?.["ui"] as { resourceUri?: string } | undefined)?.resourceUri;
      assert.equal(Boolean(uri), renderNames.has(tool.name), `${tool.name} UI resource linkage`);
    }
    assert.equal((await fetch(`${base}/.well-known/oauth-protected-resource`)).status, 404);
  } finally { await stop(); }
});

test("search translates filters and strips the multi-megabyte response to card fields", async () => {
  const { mcp, requests, stop } = await start();
  try {
    const answer = await mcp.callTool({ name: "search_homes", arguments: { location: "Bath", listing_type: "sale", max_price: 500000, min_beds: 3, property_type: "semi_detached", new_build: true, sort: "newest", page: 1 } });
    const body = answer.structuredContent as { homes: Array<Record<string, unknown>> };
    assert.equal(body.homes.length, 2);
    assert.equal(body.homes[0]?.["under_offer_date"], "2026-10-02");
    assert.deepEqual(body.homes[0]?.["coordinates"], { latitude: 51.38, longitude: -2.36 });
    assert.equal("area" in body.homes[0]!, false);
    assert.equal(body.homes[0]?.["new_listing"], true);
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

test("map pins use the same measured pixel coordinate system as map tiles", () => {
  const points = [
    { latitude: 51.381, longitude: -2.361 },
    { latitude: 51.395, longitude: -2.325 },
  ];
  for (const [width, height] of [[540, 360], [320, 250], [900, 640]]) {
    const layout = homeMapLayout(points, width!, height!);
    points.forEach((point, index) => {
      const projected = homeMapProject(point.latitude, point.longitude, layout.zoom);
      assert.equal(layout.pins[index]!.x, projected.x - layout.left);
      assert.equal(layout.pins[index]!.y, projected.y - layout.top);
      assert.ok(layout.pins[index]!.x >= 0 && layout.pins[index]!.x <= width!);
      assert.ok(layout.pins[index]!.y >= 0 && layout.pins[index]!.y <= height!);
    });
  }
});

test("rental map pins show exact prices rather than rounded thousands", () => {
  assert.equal(homePinLabel(1500, "pcm"), "£1,500");
  assert.equal(homePinLabel(450, "pw"), "£450");
  assert.equal(homePinLabel(325000, null), "£325k");
});

test("listing ages are rounded into human time without exposing raw source floats", () => {
  assert.equal(humaniseDaysListed(0.4), "Listed today");
  assert.equal(humaniseDaysListed(1.483834589386574), "1 day");
  assert.equal(humaniseDaysListed(3.2), "3 days");
  assert.equal(humaniseDaysListed(42.1), "6 weeks");
  assert.equal(humaniseDaysListed(undefined), null);
});

test("the generated dependency-free widget script is valid JavaScript", () => {
  const script = HOME_WIDGET_HTML.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
  // These are the allowlisted home-enrichment keys. Keep the producer's
  // contract and the dependency-free widget consumer in lockstep.
  assert.match(script, /obj\(p\.epc\)\.rating/);
  assert.match(script, /risk\('Flood',p\.flood/);
  assert.match(script, /b\.max_speed\|\|b\.max_download_speed/);
  assert.match(script, /risk\('Crime',p\.crime/);
});

test("listing descriptions become clean plain-text paragraphs", () => {
  assert.equal(
    cleanListingDescription('<p>A bright &amp; airy home.</p><p>Two bedrooms<br>Near the park&nbsp;&#163;.</p><script>ignore()</script>'),
    "A bright & airy home.\n\nTwo bedrooms\n\nNear the park £.",
  );
  assert.equal(cleanListingDescription(" <div> </div> "), null);
});

test("the widget follows ChatGPT events, MCP host context and the system fallback for cards and live maps", () => {
  const source = HOME_WIDGET_HTML
    .replace("__HOME_MAPBOX_ASSETS__", "")
    .replace("__HOME_MAPBOX_TOKEN__", JSON.stringify("pk.test"));
  const script = source.match(/<script>([\s\S]*)<\/script>/)?.[1];
  if (!script) throw new Error("widget script missing");
  const widgetScript = script;
  assert.match(source, /@media\(prefers-color-scheme:dark\)\{:root:not\(\.light\)/);

  function harness(systemDark = false, openai: Record<string, unknown> | undefined = undefined) {
    const listeners = new Map<string, Array<(event: any) => void>>();
    const classes = new Set<string>();
    const styles: string[] = [];
    const mapElement = { clientWidth: 600, dataset: {} as Record<string, string>, querySelectorAll: () => [], querySelector: () => null };
    const root = {
      innerHTML: "", querySelector: () => null,
      querySelectorAll: (selector: string) => selector === "[data-map]" ? [mapElement] : [],
    };
    const classList = { toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name) };
    const parent = { postMessage: () => undefined };
    const window = {
      parent, openai, mapboxgl: undefined as unknown,
      addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    };
    const button = () => ({
      dataset: {} as Record<string, string>, className: "", type: "", textContent: "",
      classList: { contains: () => false, toggle: () => undefined },
      matches: (selector: string) => selector === "[data-index]", setAttribute: () => undefined,
      addEventListener: () => undefined,
    });
    const mapboxListeners = new Map<string, () => void>();
    const mapboxScript = { addEventListener: (type: string, listener: () => void) => mapboxListeners.set(type, listener) };
    const document = { getElementById: (id: string) => id === "root" ? root : id === "home-mapbox" ? mapboxScript : null, documentElement: { classList }, createElement: button };
    class FakeMap {
      constructor(options: { style: string }) { styles.push(options.style); }
      addControl() {} jumpTo() {} fitBounds() {} remove() {}
      setStyle(style: string) { styles.push(style); }
    }
    class Marker { setLngLat() { return this; } addTo() { return this; } }
    class Bounds { extend() { return this; } }
    const mapboxgl = { Map: FakeMap, Marker, LngLatBounds: Bounds, NavigationControl: class {}, accessToken: "" };
    window.mapboxgl = mapboxgl;
    new Function("window", "document", "matchMedia", "mapboxgl", widgetScript)(window, document, () => ({ matches: systemDark }), mapboxgl);
    const dispatch = (type: string, event: any) => (listeners.get(type) ?? []).forEach((listener) => listener(event));
    const render = () => dispatch("message", { source: parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "listings", homes: [{ price: 325000, coordinates: { latitude: 51.38, longitude: -2.36 } }] } } } });
    return { classes, styles, parent, dispatch, render, root, window, mapboxgl, mapboxListeners };
  }

  const chatgpt = harness(false, { theme: "dark" });
  assert.ok(chatgpt.classes.has("dark"));
  chatgpt.render();
  chatgpt.dispatch("openai:set_globals", { detail: { globals: { theme: "light" } } });
  assert.ok(chatgpt.classes.has("light"));
  assert.equal(chatgpt.styles.at(-1), "mapbox://styles/mapbox/light-v11");

  const mcp = harness();
  mcp.dispatch("message", { source: mcp.parent, data: { jsonrpc: "2.0", id: "home-ui-init", result: { hostContext: { theme: "dark" } } } });
  assert.ok(mcp.classes.has("dark"));

  const system = harness(true);
  system.render();
  assert.equal(system.styles[0], "mapbox://styles/mapbox/dark-v11");

  const delayed = harness();
  delayed.window.mapboxgl = undefined;
  delayed.render();
  assert.match(delayed.root.innerHTML, /data-map/);
  assert.equal(delayed.styles.length, 0);
  delayed.window.mapboxgl = delayed.mapboxgl;
  delayed.mapboxListeners.get("load")?.();
  assert.equal(delayed.styles[0], "mapbox://styles/mapbox/light-v11");

  const detail = harness();
  detail.dispatch("message", { source: detail.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {
    view: "detail", home: { enrichment: { scope: "area", area: { broadband: { max_download_speed: 1000 }, crime: { level: "14 recorded crimes" }, schools: [{ name: "Area Primary" }] } } },
  } } } });
  assert.match(detail.root.innerHTML, /Know before you view/);
  assert.equal((detail.root.innerHTML.match(/for the area/g) ?? []).length, 3);
  detail.dispatch("message", { source: detail.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {
    view: "detail", home: { enrichment: { available: false } },
  } } } });
  assert.doesNotMatch(detail.root.innerHTML, /Know before you view/);
});

test("render tools reuse supplied homes without another search and keep text fallbacks", async () => {
  const { mcp, requests, stop } = await start();
  try {
    const searched = await mcp.callTool({ name: "search_homes", arguments: { location: "Bath", listing_type: "sale" } });
    const homes = (searched.structuredContent as { homes: unknown[] }).homes;
    const before = requests.length;
    const listingRender = await mcp.callTool({ name: "render_home_listings", arguments: { title: "Three-bed homes", homes: [homes[1]] } });
    assert.equal(requests.length, before);
    assert.deepEqual(listingRender.structuredContent, { view: "listings", title: "Three-bed homes", homes: [homes[1]] });
    assert.match((listingRender.content as Array<{ text: string }>)[0]!.text, /Three-bed homes/);

    const detail = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const beforeDetailRender = requests.length;
    const detailRender = await mcp.callTool({ name: "render_home_detail", arguments: { home: detail.structuredContent } });
    assert.equal(requests.length, beforeDetailRender);
    assert.equal((detailRender.structuredContent as { view: string }).view, "detail");
  } finally { await stop(); }
});

test("Home publishes a v4 MCP Apps resource without a map surface when the browser token is absent", async () => {
  const { mcp, stop } = await start();
  try {
    const resources = await mcp.listResources();
    assert.deepEqual(resources.resources.map((resource) => resource.uri), ["ui://home/listings-and-detail-v4.html"]);
    const resource = await mcp.readResource({ uri: resources.resources[0]!.uri });
    const content = resource.contents[0] as { mimeType?: string; text?: string; _meta?: Record<string, unknown> };
    assert.equal(content.mimeType, "text/html;profile=mcp-app");
    assert.match(content.text ?? "", /ui\/notifications\/tool-result/);
    assert.match(content.text ?? "", /ui\/initialize/);
    assert.match(content.text ?? "", /ui\/notifications\/initialized/);
    assert.match(content.text ?? "", /@media\(max-width:700px\)/);
    const ui = content._meta?.["ui"] as { csp?: { connectDomains?: string[]; resourceDomains?: string[] } };
    assert.deepEqual(ui.csp?.connectDomains, []);
    assert.deepEqual(ui.csp?.resourceDomains, ["https://home.co.uk", "https://cdn.home.co.uk", "https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
    assert.doesNotMatch(content.text ?? "", /openstreetmap|tile\.openstreetmap/i);
    assert.doesNotMatch(content.text ?? "", /mapbox-gl-js/);
    assert.match(content.text ?? "", /mapboxToken=""/);
  } finally { await stop(); }
});

test("Home publishes the integrity-pinned interactive Mapbox client and CSP domains when configured", async () => {
  const { base, mcp, stop } = await start({}, { mapboxToken: "pk.browser-token" });
  try {
    const resource = await mcp.readResource({ uri: HOME_WIDGET_URI });
    const content = resource.contents[0] as { text?: string; _meta?: Record<string, unknown> };
    assert.match(content.text ?? "", /mapbox-gl-js\/v3\.15\.0/);
    assert.match(content.text ?? "", /integrity="sha384-bdNholknIOkWEb1azEKvnPJRgM0yXw3\+r2L2Hjhl0twDnzUC7WxuBpKfJdp7Fzpg" crossorigin="anonymous"/);
    assert.match(content.text ?? "", /mapboxToken="pk\.browser-token"/);
    assert.match(content.text ?? "", /new gl\.Map/);
    assert.match(content.text ?? "", /NavigationControl/);
    const ui = content._meta?.["ui"] as { csp?: { connectDomains?: string[]; resourceDomains?: string[] } };
    assert.deepEqual(ui.csp?.connectDomains, ["https://api.mapbox.com", "https://events.mapbox.com"]);
    assert.ok(ui.csp?.resourceDomains?.includes("https://api.mapbox.com"));
    assert.ok(ui.csp?.resourceDomains?.includes("https://events.mapbox.com"));
    assert.equal((await fetch(base + "/maps/static?points=51.38%2C-2.36")).status, 404);
  } finally { await stop(); }
});

test("Mapbox environment selection exposes only public tokens and explains ignored legacy secrets", () => {
  assert.equal(mapboxTokenFromEnv({ MAPBOX_PUBLIC_TOKEN: " pk.public " }), "pk.public");
  assert.equal(mapboxTokenFromEnv({ MAPBOX_SECRET_TOKEN: "pk.legacy" }), "pk.legacy");
  const warnings: string[] = [];
  assert.equal(mapboxTokenFromEnv({ MAPBOX_SECRET_TOKEN: "sk.secret" }, (message) => warnings.push(message)), undefined);
  assert.deepEqual(warnings, ["MAPBOX_SECRET_TOKEN is an sk. secret and cannot be sent to the browser; set MAPBOX_PUBLIC_TOKEN to a URL-restricted pk. token to enable maps"]);
  assert.throws(() => mapboxTokenFromEnv({ MAPBOX_PUBLIC_TOKEN: "sk.secret" }), /must be a Mapbox pk\. browser token/);
});

test("search sends market signals as Atlas date filters in one request", async () => {
  const requests: URL[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input)); requests.push(url);
    return new Response(JSON.stringify({ displayLocation: "Bath", total: 40, pagination: { current_page: 1, last_page: 2 }, properties: [
      { listing_id: ID, reduced_date: "2026-09-18T10:00:00Z", added_date: "2026-07-04" },
      { listing_id: ID2, reduced_date: "2026-09-17", added_date: "2026-09-30" },
    ] }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const homedata = new HomedataClient({ apiKey: "test", baseUrl: "https://data.test", fetchImpl });
  const client = new HomeClient({ homeBaseUrl: "https://home.test", homedata, fetchImpl, now: () => new Date("2026-10-02T00:00:00Z") });
  const body = await client.search({ location: "Bath", listing_type: "sale", reduced_within_days: 14, on_market_at_least_days: 90, new_within_days: 3 });
  // Atlas's listing route currently ignores these query parameters. The client
  // must still reject every returned card that does not satisfy all three.
  assert.deepEqual((body["homes"] as Array<Record<string, unknown>>).map((home) => home["id"]), []);
  assert.equal(body["total"], null);
  assert.equal(body["source_total"], 40);
  assert.equal(body["matching_homes_returned"], 0);
  assert.equal(body["pages_checked"], 1);
  assert.equal(body["results_limited"], true);
  assert.equal(body["next_page"], 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.searchParams.get("reduced_since"), "2026-09-18");
  assert.equal(requests[0]!.searchParams.get("listed_before"), "2026-07-04");
  assert.equal(requests[0]!.searchParams.get("added_since"), "2026-09-29");
  const reduced = await client.search({ location: "Bath", listing_type: "sale", reduced_within_days: 14 });
  assert.deepEqual((reduced["homes"] as Array<Record<string, unknown>>).map((home) => home["id"]), [ID]);
  await assert.rejects(() => client.search({ location: "Bath", listing_type: "sale", new_within_days: 0 }), /starting at 1/);
});

test("only property-detail requests carry the trusted listing header and cannot redirect", async () => {
  const received: Array<{ url: URL; init?: RequestInit }> = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input)); received.push({ url, init });
    const body = url.pathname.startsWith("/api/property-details/") ? { property_uprn: "1" }
      : url.hostname === "data.test" ? { epc: { rating: "C" } }
      : { total: 0, properties: [] };
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const homedata = new HomedataClient({ apiKey: "test", baseUrl: "https://data.test", fetchImpl });
  const client = new HomeClient({ homeBaseUrl: "https://home.test", homedata, fetchImpl, listingViewSecret: "trusted-secret" });
  await client.search({ location: "Bath", listing_type: "sale" });
  await client.home(ID);
  const details = received.find((request) => request.url.pathname.startsWith("/api/property-details/"))!;
  assert.equal(new Headers(details.init?.headers).get("X-Home-Listing-Secret"), "trusted-secret");
  assert.equal(details.init?.redirect, "error");
  for (const request of received.filter((item) => item !== details)) {
    assert.equal(new Headers(request.init?.headers).has("X-Home-Listing-Secret"), false, request.url.toString());
  }
});

test("get_home uses the property-details UPRN before address matching", async () => {
  const { mcp, requests, stop } = await start({ detail: { property_uprn: "100012345678", uprn: "wrong-field" } });
  try {
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const body = answer.structuredContent as Record<string, unknown>;
    assert.equal(body["description"], "Full description");
    assert.deepEqual(body["photos"], ["https://cdn.home.co.uk/full.jpg"]);
    const enrichment = body["enrichment"] as Record<string, unknown>;
    assert.equal("uprn" in enrichment, false);
    assert.equal(enrichment["scope"], "home");
    assert.equal(enrichment["source"], "listing_uprn");
    assert.deepEqual(enrichment["property"], { epc: { rating: "C" }, council_tax: { band: "D" }, flood: { level: "low" } });
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
    assert.equal("uprn" in enrichment, false);
    assert.ok(requests.some((url) => url.pathname === "/address/find/"));
  } finally { await stop(); }
});

test("get_home allowlists buyer facts and cannot reveal the matched core address or identifiers", async () => {
  const core = {
    uprn: "100012345678", udprn: 23456789, toid: "osgb100000000001", usrn: 987654,
    title_no: "AV123456", full_address: "12 Heritage Close, Bath, BA2 8TJ", address: "12 Heritage Close",
    building_number: "12", latitude: 51.35712345, longitude: -2.37012345, easting: 374000, northing: 165000,
    epc: { current_energy_rating: "C", potential_energy_rating: "B", last_epc_date: "2025-04-03", epc_floor_area: 91, epc_id: "secret-epc-id" },
    council_tax: { council_tax_band: "D" }, property_type: { property_type: "Terraced", classification_code: "RD06" },
    rooms: { bedrooms: 3, bathrooms: 1, habitable_rooms: 5, heated_rooms: 5, predicted_bedrooms: 4 },
    dimensions: { predicted_floor_area: 93, geometry_area_m2: 100 },
    lr_title: { title_no: "AV123456", estate_interest: "Freehold", title_class: "Absolute" },
    flood: [{ risk_type: "flood_rivers_sea", label: "Very low", score: 1, properties: { coordinates: [51.3, -2.3] } }],
    broadband: { avg_download_speed: 72.9, max_download_speed: 1000, full_fibre_available_pct: 87, postcode: "BA2 8TJ" },
    schools: { query: { uprn: "100012345678", lat: 51.3, lng: -2.3 }, schools: [{ name: "Heritage Primary", phase: "Primary", distance_km: 0.4, urn: 123456, latitude: 51.3, longitude: -2.3, ofsted: { rating: "Good", last_inspection: "2024-06-01" } }] },
    crime: { total_crimes: 14, latest_month: "2026-08", categories: [{ category: "burglary", label: "Burglary", count: 2, sample_locations: [{ latitude: "51.3", longitude: "-2.3" }] }] },
    valuation_estimate: 425000, title_boundary: { coordinates: [[[1, 2]]] },
  };
  const { mcp, stop } = await start({ responseBody: { "/property/100012345678/core/": core } });
  try {
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const body = answer.structuredContent as Record<string, unknown>;
    const enrichment = body["enrichment"] as Record<string, unknown>;
    assert.deepEqual(enrichment, {
      available: true, scope: "home", source: "exact_address_match", property: {
        epc: { rating: "C", potential_rating: "B", assessment_date: "2025-04-03" },
        council_tax: { band: "D" }, flood: { level: "Very low", details: [{ type: "flood_rivers_sea", level: "Very low" }] },
        broadband: { avg_download_speed: 72.9, max_download_speed: 1000, full_fibre_available_pct: 87 },
        schools: [{ name: "Heritage Primary", phase: "Primary", distance_km: 0.4, ofsted_rating: "Good", ofsted_inspection_date: "2024-06-01" }],
        crime: { level: "14 recorded crimes (2026-08)", total: 14, period: "2026-08", categories: [{ name: "Burglary", count: 2 }] },
        property_type: "Terraced", rooms: { bedrooms: 3, bathrooms: 1, habitable: 5, heated: 5 },
        floor_area_sqm: 91, tenure: "Freehold",
      },
    });
    const serialised = JSON.stringify(enrichment);
    for (const secret of ["12 Heritage Close", "AV123456", "100012345678", "23456789", "osgb100000000001", "987654", "374000", "165000", "51.35712345", "-2.37012345", "secret-epc-id", "RD06"]) {
      assert.equal(serialised.includes(secret), false, `leaked ${secret}`);
    }
    for (const key of ["uprn", "udprn", "toid", "usrn", "title_no", "full_address", "latitude", "longitude", "easting", "northing"]) {
      assert.equal(new RegExp(`\\\"${key}\\\"`).test(serialised), false, `leaked key ${key}`);
    }
  } finally { await stop(); }
});

test("get_home returns clearly labelled, widget-ready postcode facts when no UPRN can be found", async () => {
  const { mcp, requests, stop } = await start({
    detail: { building_number: null, building_name: null },
    responseBody: {
      "/crime/": { total_crimes: 14, latest_month: "2026-08" },
      "/schools/nearby": { schools: [{ name: "Area Primary", distance_km: 0.5, ofsted: { rating: "Good" } }] },
      "/broadband/": { max_download_speed: 1000 },
    },
  });
  try {
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const enrichment = (answer.structuredContent as Record<string, unknown>)["enrichment"] as Record<string, unknown>;
    assert.equal(enrichment["available"], true);
    assert.equal(enrichment["scope"], "area");
    assert.match(String(enrichment["notice"]), /not facts about this home/i);
    const area = enrichment["area"] as Record<string, unknown>;
    assert.deepEqual(area, {
      broadband: { max_download_speed: 1000 },
      schools: [{ name: "Area Primary", distance_km: 0.5, ofsted_rating: "Good" }],
      crime: { level: "14 recorded crimes (2026-08)", total: 14, period: "2026-08" },
    });
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
  const { mcp, requests, stop } = await start({ detail: { property_uprn: null, postcode: null, building_number: null, building_name: null, street_name: null, town_name: null, latitude: null, longitude: null } });
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

test("typical_rents reads the area's JSON API and treats its 404 as an unknown area", async () => {
  const { mcp, requests, stop } = await start();
  try {
    const answer = await mcp.callTool({ name: "typical_rents", arguments: { location: "BA1 1LZ" } });
    const body = answer.structuredContent as Record<string, unknown>;
    assert.equal(body["median_asking_rent_pcm_pounds"], 1600);
    assert.equal(body["rent_period"], "per_calendar_month");
    assert.match(String(body["note"]), /whole BA1 postcode district/);
    assert.match(String(body["not_achieved_rents"]), /asking rents/);
    assert.equal(requests[0]!.pathname, "/api/v1/rental-prices/BA1%201LZ");
    const town = await mcp.callTool({ name: "typical_rents", arguments: { location: "Milton Keynes" } });
    assert.equal(town.isError, true);
    assert.equal(requests[1]!.pathname, "/api/v1/rental-prices/milton-keynes");
    await mcp.callTool({ name: "typical_rents", arguments: { location: "King's Lynn" } });
    assert.equal(requests[2]!.pathname, "/api/v1/rental-prices/kings-lynn");
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
    detail: { property_uprn: "100012345678" },
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
    const empty = { hits: 0, misses: 0, entries: 0 };
    assert.deepEqual(await (await fetch(base + "/healthz")).json(), { ok: true, service: "home", version: "1.0.0", enrichment_cache: { homes: empty, areas: empty } });
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

test("the enrichment cache is bounded, least recently read goes first, and a read never extends the day", () => {
  let clock = 0;
  const cache = new TtlCache<string>(2, 1_000, () => clock);
  cache.set("a", "A"); cache.set("b", "B");
  assert.equal(cache.get("a"), "A");
  cache.set("c", "C");
  assert.equal(cache.peek("b"), undefined, "b was least recently read");
  assert.equal(cache.size, 2);
  clock = 999;
  assert.equal(cache.get("a"), "A");
  clock = 1_000;
  assert.equal(cache.get("a"), undefined, "expiry counts from the upstream answer, not the last read");
  assert.deepEqual(cache.stats(), { hits: 2, misses: 1, entries: 1 });
  assert.throws(() => new TtlCache(0, 1, () => 0));
});

test("a repeat view of a home spends no Homedata lookup for a day, and health counts hits and misses", async () => {
  let clock = Date.parse("2026-10-02T09:00:00Z");
  const { base, mcp, requests, stop } = await start({ client: { now: () => new Date(clock) } });
  const lookups = (path: string) => requests.filter((url) => url.pathname === path).length;
  try {
    const first = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const second = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    assert.deepEqual((second.structuredContent as Record<string, unknown>)["enrichment"], (first.structuredContent as Record<string, unknown>)["enrichment"]);
    assert.equal(((second.structuredContent as Record<string, unknown>)["enrichment"] as Record<string, unknown>)["source"], "exact_address_match");
    assert.equal(lookups("/property/100012345678/core/"), 1);
    assert.equal(lookups("/address/find/"), 1, "the listing's resolved UPRN is remembered too");
    // Another listing of the same home shares the UPRN's facts.
    await mcp.callTool({ name: "get_home", arguments: { listing_id: ID2 } });
    assert.equal(lookups("/property/100012345678/core/"), 1);
    const health = await (await fetch(base + "/healthz")).json() as { enrichment_cache: { homes: unknown } };
    assert.deepEqual(health.enrichment_cache.homes, { hits: 2, misses: 1, entries: 1 });
    clock += 24 * 60 * 60 * 1000;
    await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    assert.equal(lookups("/property/100012345678/core/"), 2, "a day later the home is looked up again");
  } finally { await stop(); }
});

test("a failed Homedata lookup is never cached", async () => {
  const { mcp, requests, stop } = await start({ detail: { property_uprn: "100012345678" }, status: { "/property/100012345678/core/": 503, "/crime/": 503 }, logger: () => {} });
  try {
    for (let i = 0; i < 2; i++) {
      const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
      assert.deepEqual((answer.structuredContent as Record<string, unknown>)["enrichment"], { available: false, reason: "Not available right now." });
      await mcp.callTool({ name: "area_insights", arguments: { postcode: "BA1 1LZ" } });
    }
    assert.equal(requests.filter((url) => url.pathname === "/property/100012345678/core/").length, 2);
    assert.equal(requests.filter((url) => url.pathname === "/schools/nearby").length, 2, "a partly failed area answer is asked again");
  } finally { await stop(); }
});

test("area facts are cached per postcode, whichever tool asked first", async () => {
  const { base, mcp, requests, stop } = await start({ detail: { building_number: null, building_name: null } });
  try {
    await mcp.callTool({ name: "area_insights", arguments: { postcode: "ba28tj" } });
    const answer = await mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const enrichment = (answer.structuredContent as Record<string, unknown>)["enrichment"] as Record<string, unknown>;
    assert.equal(enrichment["scope"], "area");
    assert.match(String(enrichment["notice"]), /not facts about this home/i);
    assert.equal(requests.filter((url) => url.pathname === "/schools/nearby").length, 1);
    const health = await (await fetch(base + "/healthz")).json() as { enrichment_cache: { areas: unknown } };
    assert.deepEqual(health.enrichment_cache.areas, { hits: 1, misses: 1, entries: 1 });
  } finally { await stop(); }
});

test("cached homes do not count towards the per-caller enrichment cap", async () => {
  const { base, stop } = await start({}, { enrichmentsPerMinute: 1 });
  const rpc = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const post = (body: unknown) => fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(rpc(1, "get_home", { listing_id: ID }))).status, 200);
    assert.equal((await post(rpc(2, "get_home", { listing_id: ID }))).status, 200, "a cached home is free");
    assert.equal((await post(rpc(3, "get_home", { listing_id: ID2 }))).status, 429, "an uncached home still needs a unit");
    // A comparison is charged only for its uncached homes.
    assert.equal((await post(rpc(4, "compare_homes", { listing_ids: [ID, ID2] }))).status, 429);
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

test("a Homedata 5xx reaches ChatGPT as the neutral gap, with its body kept in the server log", async () => {
  const crash = { detail: "Traceback: KeyError 'lsoa' in /srv/loki/core/views.py", request_id: "req_internal_42" };
  const logs: Array<[string, unknown]> = [];
  const { mcp, stop } = await start({ status: { "/crime/": 500 }, responseBody: { "/crime/": crash }, logger: (message, detail) => logs.push([message, detail]) });
  try {
    const answer = await mcp.callTool({ name: "area_insights", arguments: { postcode: "BA1 1LZ" } });
    assert.deepEqual((answer.structuredContent as Record<string, unknown>)["crime"], { available: false, reason: "Not available right now." });
    assert.doesNotMatch(JSON.stringify(answer), /Traceback|KeyError|loki|req_internal_42|status_code|500/);
    assert.ok(logs.some(([, detail]) => JSON.stringify(detail).includes("req_internal_42")));
  } finally { await stop(); }
});

test("a failed connection or a non-JSON page from home.co.uk is an upstream outage, never an empty result", async () => {
  const homedata = new HomedataClient({ apiKey: "test", baseUrl: "https://data.test", fetchImpl: (async () => new Response("{}")) as typeof fetch });
  const quiet = () => {};
  const refused = new HomeClient({ homeBaseUrl: "https://home.test", homedata, logger: quiet, fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
  const html = new HomeClient({ homeBaseUrl: "https://home.test", homedata, logger: quiet, fetchImpl: (async () => new Response("<html>Just a moment...</html>", { status: 200 })) as typeof fetch });
  const timedOut = new HomeClient({ homeBaseUrl: "https://home.test", homedata, logger: quiet, timeoutMs: 5, fetchImpl: ((_: unknown, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch });
  for (const client of [refused, html, timedOut]) {
    await assert.rejects(() => client.search({ location: "Bath", listing_type: "sale" }), HomeUpstreamError);
    await assert.rejects(() => client.home(ID), HomeUpstreamError);
  }

  // Through the MCP server the outage is the neutral answer, flagged as an error.
  const server = buildHomeServer(html);
  const [clientSide, serverSide] = (await import("@modelcontextprotocol/sdk/inMemory.js")).InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await mcp.connect(clientSide);
  try {
    const answer = await mcp.callTool({ name: "search_homes", arguments: { location: "Bath", listing_type: "sale" } });
    assert.equal(answer.isError, true);
    assert.deepEqual(answer.structuredContent, { available: false, reason: "Not available right now." });
    assert.doesNotMatch(JSON.stringify(answer), /Just a moment|fetch failed/);
  } finally { await mcp.close(); await server.close(); }
});

test("the domain challenge is served as the bare token, and only when configured", async () => {
  const configured = await start({}, { appsChallenge: "home-challenge-token" });
  try {
    const response = await fetch(`${configured.base}/.well-known/openai-apps-challenge`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "home-challenge-token");
  } finally { await configured.stop(); }
  const unset = await start();
  try {
    assert.equal((await fetch(`${unset.base}/.well-known/openai-apps-challenge`)).status, 404);
  } finally { await unset.stop(); }
});

const PLUGIN = join(ROOT, "home-chatgpt-plugin");
const MCP_URL = "https://mcp.home.co.uk/mcp";
const HOME_ICON = { path: "./assets/logo.png", width: 310, height: 310 };
const buildHome = () => buildManifest(JSON.parse(readFileSync(join(PLUGIN, "listing.json"), "utf8")) as Manifest, golden as GoldenSet);
const toolNames = HOME_TOOLS.map((t) => t.name);

test("the Home plugin package is ready to submit: named Home, home.co.uk links, worldwide, no paid wording", () => {
  const manifest = buildHome();
  assert.deepEqual(validatePackage(manifest, toolNames, [HOME_ICON], HOME_RULES), []);
  const ui = manifest.extensions["com.openai"].interface;
  assert.equal(ui["displayName"], "Home");
  assert.deepEqual(
    [ui["websiteURL"], ui["supportURL"], ui["privacyPolicyURL"], ui["termsOfServiceURL"], manifest["homepage"]],
    ["https://home.co.uk/chatgpt/", "https://home.co.uk/contact/", "https://home.co.uk/privacy/", "https://home.co.uk/terms/", "https://home.co.uk/chatgpt/"],
  );
  assert.deepEqual(manifest.extensions["com.openai"].publication!["countries"], []);
  assert.doesNotMatch(JSON.stringify(manifest), /credit|homedata\.co\.uk/i);
  const mcp = JSON.parse(readFileSync(join(PLUGIN, "mcp.json"), "utf8")) as { mcpServers: Record<string, { url: string }> };
  assert.deepEqual(Object.values(mcp.mcpServers).map((s) => s.url), [MCP_URL]);
});

test("the Home icon is the site's own heart app icon, byte for byte", () => {
  // home.co.uk/ms-icon-310x310.png as served on 2026-10-02: the largest heart
  // icon the site publishes. Ship it unaltered; never a restyle.
  const icon = readFileSync(join(PLUGIN, "assets", "logo.png"));
  assert.equal(createHash("sha256").update(icon).digest("hex"), "bcb1bf39fc6c00fab410c8d0f4d7013bc4edc9b3218f2c1199498a2293316d67");
  assert.deepEqual({ width: icon.readUInt32BE(16), height: icon.readUInt32BE(20) }, { width: HOME_ICON.width, height: HOME_ICON.height });
});

test("Home review cases: five live-checked positives that cover all three skills, three negatives", () => {
  const cases = buildHome().extensions["com.openai"].review!.test_cases!;
  assert.deepEqual(cases.positive.map((c) => c.tools_triggered), [
    "search_homes, render_home_listings",
    "search_homes",
    "search_homes, get_home",
    "search_homes, compare_homes",
    "calculate_stamp_duty, calculate_mortgage",
  ]);
  assert.equal(cases.negative.length, 3);
  for (const c of cases.positive) assert.doesNotMatch(c.prompt, /^\(after /, "a review prompt must stand alone");
  for (const skill of readSkills(PLUGIN)) {
    assert.ok(cases.positive.some((c) => c.expected_behavior.includes(`the ${skill.dir} skill`)), `no review case exercises ${skill.dir}`);
  }
});

test("Home skills are bound to the tools the endpoint lists and held to the listing rules", () => {
  const skills = readSkills(PLUGIN);
  assert.deepEqual(skills.map((s) => s.dir), ["buying-costs", "prepare-for-a-viewing", "shortlist-and-compare"]);
  assert.deepEqual(validateSkills(skills, [...HOME_TOOLS], HOME_RULES, MCP_URL), []);

  const broken = (change: (skill: Skill) => Skill) => validateSkills([change(skills[0]!)], [...HOME_TOOLS], HOME_RULES, MCP_URL).join("\n");
  assert.match(broken((s) => ({ ...s, text: s.text.replaceAll("calculate_mortgage", "mortgage_calculator") })), /names `mortgage_calculator`, which is not a tool/);
  assert.match(broken((s) => ({ ...s, text: s.text.replace(/`[a-z_]+`/g, "the tools") })), /names no tool the endpoint lists/);
  assert.match(broken((s) => ({ ...s, text: s.text.replace("name: buying-costs", "name: costs") })), /name "costs" must match its folder/);
  assert.match(broken((s) => ({ ...s, text: s.text.replace(/^---\n[\s\S]*?\n---\n/, "") })), /must start with name and description front matter/);
  assert.match(broken((s) => ({ ...s, text: `${s.text}\nCheck the price on Rightmove too.\n` })), /mentions a competitor portal/);
  assert.match(broken((s) => ({ ...s, text: `${s.text}\nTell them what the home is worth.\n` })), /names a valuation other than as a limit/);
  assert.match(broken((s) => ({ ...s, text: `${s.text}\nMention our free trial.\n` })), /mentions pricing or an offer/);
  assert.match(broken((s) => ({ ...s, openaiYaml: s.openaiYaml!.replace(MCP_URL, "https://mcp.homedata.co.uk/mcp") })), /agents\/openai\.yaml must depend on/);
});

test("Home listing rules allow homes for sale but not valuations, offers or competitor names", () => {
  const listing = (extra: string) => {
    const manifest = buildHome();
    manifest.extensions["com.openai"].interface["longDescription"] = `${String(manifest.extensions["com.openai"].interface["longDescription"])}\n${extra}`;
    return validatePackage(manifest, toolNames, [HOME_ICON], HOME_RULES).join("\n");
  };
  assert.equal(listing("Browse thousands of listings for sale."), "");
  assert.match(listing("Get an instant valuation of your home."), /names a valuation other than as a limit/);
  assert.match(listing("More homes than Zoopla."), /competitor portal/);
  assert.match(listing("Searching is free."), /pricing or an offer/);
  assert.match(listing("Lookups consume paid credits from your Homedata account."), /pricing or an offer/);
  const commerce = buildHome();
  commerce.extensions["com.openai"].review!["commerce_description"] = "Credits are bought outside ChatGPT.";
  assert.match(validatePackage(commerce, toolNames, [HOME_ICON], HOME_RULES).join("\n"), /commerce_description/);
});

// ---- Account tools: saved searches and price alerts, forwarded to atlas ----

const TOKEN = "atlas-token-0123456789abcdef";
const RESOURCE = "https://mcp.home.test";
const ACCOUNT_URL = "https://atlas.test/api/mcp";

type AtlasAnswer = { status?: number; result?: unknown; throws?: boolean; headers?: Record<string, string> };

/** A fake atlas MCP endpoint: records what it was sent and answers per tool. */
function atlas(answers: Record<string, AtlasAnswer> = {}) {
  const calls: Array<{ url: string; authorization: string | null; body: Record<string, any> }> = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"), body });
    const answer = answers[body["params"].name] ?? {};
    if (answer.throws) throw new TypeError(`fetch failed for ${String(input)}`);
    const result = answer.result ?? { content: [{ type: "text", text: JSON.stringify({ ok: body["params"].name }) }], isError: false };
    return new Response(JSON.stringify(answer.status && answer.status >= 400 ? { error: "invalid_token" } : { jsonrpc: "2.0", id: body["id"], result }), { status: answer.status ?? 200, headers: { "Content-Type": "application/json", ...answer.headers } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function startAccount(answers: Record<string, AtlasAnswer> = {}, fixtureOptions: FixtureOptions = {}) {
  const fake = atlas(answers);
  const logged: string[] = [];
  const logger = (message: string, detail: unknown) => logged.push(`${message} ${detail instanceof Error ? `${detail.name}: ${detail.message}` : JSON.stringify(detail)}`);
  const app = await start({ ...fixtureOptions, logger }, { account: { resource: RESOURCE, issuer: "https://home.test", accountMcpUrl: ACCOUNT_URL, fetchImpl: fake.fetchImpl, logger } });
  const rpc = async (method: string, params: unknown, token?: string) => {
    const response = await fetch(`${app.base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
    });
    return { status: response.status, headers: response.headers, body: (await response.json()) as Record<string, any> };
  };
  const call = async (name: string, args: Record<string, unknown>, token?: string) => (await rpc("tools/call", { name, arguments: args }, token)).body["result"] as Record<string, any>;
  return { ...app, atlas: fake.calls, logged, rpc, call };
}

const challengeOf = (result: Record<string, any>) => (result["_meta"]?.["mcp/www_authenticate"] as string[] | undefined)?.[0];

test("with account settings the nine account tools are listed as oauth2 with their scope, search stays noauth, and the golden set holds", async () => {
  const app = await startAccount();
  try {
    const tools = (await app.rpc("tools/list", {})).body["result"].tools as Array<Record<string, any>>;
    assert.deepEqual(tools.map((t) => t.name), [...HOME_TOOLS, ...ACCOUNT_TOOLS].map((t) => t.name));
    assert.deepEqual(ACCOUNT_TOOLS.map((t) => t.name), [
      "list_saved_searches", "create_saved_search", "pause_saved_search", "delete_saved_search", "get_saved_search_new_results",
      "list_price_alerts", "create_price_alert", "pause_price_alert", "delete_price_alert",
    ]);
    const scopes: Record<string, string> = {};
    for (const tool of tools) {
      const account = ACCOUNT_TOOLS.find((t) => t.name === tool["name"]);
      if (!account) {
        assert.deepEqual(tool["securitySchemes"], [{ type: "noauth" }], tool["name"]);
        assert.deepEqual(tool["_meta"].securitySchemes, [{ type: "noauth" }], tool["name"]);
        continue;
      }
      assert.deepEqual(tool["securitySchemes"], [{ type: "oauth2", scopes: [account.scope] }], tool["name"]);
      assert.deepEqual(tool["_meta"].securitySchemes, [{ type: "oauth2", scopes: [account.scope] }], tool["name"]);
      assert.equal("scope" in tool, false);
      scopes[tool["name"]] = account.scope;
    }
    assert.deepEqual(new Set(Object.values(scopes)), new Set(["home.saved-searches", "home.price-alerts"]));
    assert.ok(Object.entries(scopes).every(([name, scope]) => scope === (name.includes("saved_search") ? "home.saved-searches" : "home.price-alerts")));

    // Write annotations: reads change nothing, deletes are destructive, none reach outside the user's account.
    const hints = Object.fromEntries(tools.filter((t) => t["name"] in scopes).map((t) => [t["name"], t["annotations"]]));
    for (const name of ["list_saved_searches", "get_saved_search_new_results", "list_price_alerts"]) assert.deepEqual(hints[name], { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, name);
    for (const name of ["create_saved_search", "create_price_alert"]) assert.deepEqual(hints[name], { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, name);
    for (const name of ["pause_saved_search", "pause_price_alert"]) assert.deepEqual(hints[name], { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, name);
    for (const name of ["delete_saved_search", "delete_price_alert"]) assert.deepEqual(hints[name], { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, name);

    assert.deepEqual(checkGoldenSet(golden as GoldenSet, tools as never), []);
    assert.deepEqual(app.atlas, [], "listing never calls atlas");
  } finally { await app.stop(); }
});

test("protected-resource metadata names this origin, home.co.uk and both scopes, and is never cached", async () => {
  const app = await startAccount();
  try {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const response = await fetch(app.base + path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("cache-control"), "no-store", path);
      assert.deepEqual(await response.json(), {
        resource: RESOURCE,
        authorization_servers: ["https://home.test"],
        scopes_supported: ["home.saved-searches", "home.price-alerts"],
        bearer_methods_supported: ["header"],
      });
    }
    const other = await fetch(app.base + "/.well-known/oauth-protected-resource/other");
    assert.equal(other.status, 404);
    assert.equal(other.headers.get("cache-control"), "no-store");
  } finally { await app.stop(); }
});

test("an unsigned account call returns the sign-in challenge for its scope and never reaches atlas", async () => {
  const app = await startAccount();
  try {
    for (const [name, scope] of [["list_saved_searches", "home.saved-searches"], ["delete_price_alert", "home.price-alerts"]] as const) {
      const result = await app.call(name, name.startsWith("delete") ? { id: "a1" } : {});
      assert.equal(result["isError"], true);
      const challenge = challengeOf(result)!;
      assert.match(challenge, new RegExp(`^${SCHEME} scope="${scope}", resource_metadata="https://mcp\\.home\\.test/\\.well-known/oauth-protected-resource", error="invalid_token", error_description="`));
    }
    assert.deepEqual(app.atlas, []);
    // A search tool still answers without signing in.
    assert.notEqual((await app.call("calculate_stamp_duty", { price: 300000, buyer_type: "standard" }))["isError"], true);
  } finally { await app.stop(); }
});

test("a signed-in account call is forwarded to atlas with the caller's bearer, and search calls never carry it", async () => {
  const list = [{ id: "s1", name: "Bath", is_active: true, new_results_count: 2 }];
  const app = await startAccount({ list_saved_searches: { result: { content: [{ type: "text", text: JSON.stringify(list) }], isError: false } } });
  try {
    const result = await app.call("list_saved_searches", {}, TOKEN);
    assert.notEqual(result["isError"], true);
    assert.deepEqual(result["structuredContent"], { data: list });
    await app.call("pause_price_alert", { id: "a1", paused: true }, TOKEN);
    assert.deepEqual(app.atlas.map((c) => [c.url, c.authorization, c.body["method"], c.body["params"]]), [
      [ACCOUNT_URL, `Bearer ${TOKEN}`, "tools/call", { name: "list_saved_searches", arguments: {} }],
      [ACCOUNT_URL, `Bearer ${TOKEN}`, "tools/call", { name: "pause_price_alert", arguments: { id: "a1", paused: true } }],
    ]);

    const before = app.requests.length;
    await app.call("search_homes", { location: "Bath", listing_type: "sale" }, TOKEN);
    assert.equal(app.requests.length, before + 1);
    assert.equal(app.atlas.length, 2, "a search tool is never forwarded to atlas");
  } finally { await app.stop(); }
});

test("atlas's own tool errors pass through as tool errors", async () => {
  const app = await startAccount({ delete_saved_search: { result: { content: [{ type: "text", text: JSON.stringify({ error: "Not found." }) }], isError: true } } });
  try {
    const result = await app.call("delete_saved_search", { id: "missing" }, TOKEN);
    assert.equal(result["isError"], true);
    assert.deepEqual(result["structuredContent"], { error: "Not found." });
    assert.equal(challengeOf(result), undefined);
  } finally { await app.stop(); }
});

// The auth scheme is kept apart from its parameters, as atlas does, so secret
// screens do not read these challenges as committed bearer credentials.
const SCHEME = "Bearer";
const atlasChallenge = (params: string) => ({ "WWW-Authenticate": `${SCHEME} ${params}` });
// What atlas's McpApiAuthentication sends for a token it will not accept.
const ATLAS_REFUSAL = { status: 401, headers: atlasChallenge('resource_metadata="https://atlas.test/.well-known/oauth-protected-resource/api/mcp", error="invalid_token"') };
const MISSING_SCOPE_RESULT = { result: { content: [{ type: "text", text: JSON.stringify({ error: "This connection has not been granted the required permission." }) }], isError: true } };

test("a token atlas refuses (forged, expired or revoked) is an HTTP 401 asking the user to sign in again", async () => {
  const app = await startAccount({ list_saved_searches: ATLAS_REFUSAL, delete_price_alert: { status: 401 } });
  try {
    for (const [name, args, scope] of [["list_saved_searches", {}, "home.saved-searches"], ["delete_price_alert", { id: "a1" }, "home.price-alerts"]] as const) {
      const answer = await app.rpc("tools/call", { name, arguments: args }, TOKEN);
      assert.equal(answer.status, 401, name);
      const header = answer.headers.get("www-authenticate")!;
      // Points at this endpoint's metadata, never at atlas's.
      assert.match(header, new RegExp(`^${SCHEME} scope="${scope}", resource_metadata="https://mcp\\.home\\.test/\\.well-known/oauth-protected-resource", error="invalid_token", error_description="`), name);
      assert.equal(answer.headers.get("cache-control"), "no-store", name);
      const result = answer.body["result"] as Record<string, any>;
      assert.equal(result["isError"], true, name);
      assert.equal(challengeOf(result), header, name);
      assert.match(result["content"][0].text, /expired\. Sign in again/, name);
    }
  } finally { await app.stop(); }
});

test("a token without the tool's scope is an HTTP 401 asking for that scope, however atlas says so", async () => {
  const app = await startAccount({
    list_price_alerts: MISSING_SCOPE_RESULT,
    list_saved_searches: { status: 403, headers: atlasChallenge('error="insufficient_scope", scope="home.saved-searches"') },
    delete_saved_search: { status: 401, headers: atlasChallenge('error="insufficient_scope"') },
  });
  try {
    for (const [name, args, scope] of [["list_price_alerts", {}, "home.price-alerts"], ["list_saved_searches", {}, "home.saved-searches"], ["delete_saved_search", { id: "s1" }, "home.saved-searches"]] as const) {
      const answer = await app.rpc("tools/call", { name, arguments: args }, TOKEN);
      assert.equal(answer.status, 401, name);
      const header = answer.headers.get("www-authenticate")!;
      assert.match(header, new RegExp(`^${SCHEME} scope="${scope}", resource_metadata="https://mcp\\.home\\.test/\\.well-known/oauth-protected-resource", error="insufficient_scope"`), name);
      assert.equal(challengeOf(answer.body["result"]), header, name);
    }
  } finally { await app.stop(); }
});

test("an unsigned account call keeps HTTP 200 with the challenge in the result", async () => {
  const app = await startAccount();
  try {
    const answer = await app.rpc("tools/call", { name: "list_saved_searches", arguments: {} });
    assert.equal(answer.status, 200);
    assert.equal(answer.headers.get("www-authenticate"), null);
    assert.match(challengeOf(answer.body["result"])!, /error="invalid_token"/);
  } finally { await app.stop(); }
});

test("an atlas outage or any other upstream error stays the neutral gap, with no challenge and no 401", async () => {
  const app = await startAccount({
    pause_saved_search: { status: 500 },
    // atlas's Socket surface switched off.
    delete_saved_search: { status: 404 },
    // A 403 with no OAuth challenge, such as a Cloudflare block.
    list_saved_searches: { status: 403 },
    list_price_alerts: { status: 429, headers: { "Retry-After": "60" } },
    get_saved_search_new_results: { throws: true },
    delete_price_alert: { result: "not a result" },
  });
  try {
    for (const [name, args] of [["pause_saved_search", { id: "s1", paused: true }], ["delete_saved_search", { id: "s1" }], ["list_saved_searches", {}], ["list_price_alerts", {}], ["get_saved_search_new_results", { id: "s1" }], ["delete_price_alert", { id: "a1" }]] as const) {
      const answer = await app.rpc("tools/call", { name, arguments: args }, TOKEN);
      assert.equal(answer.status, 200, name);
      assert.equal(answer.headers.get("www-authenticate"), null, name);
      const result = answer.body["result"] as Record<string, any>;
      assert.equal(result["isError"], true, name);
      assert.deepEqual(result["structuredContent"], { available: false, reason: "Not available right now." }, name);
      assert.equal(challengeOf(result), undefined, name);
    }
  } finally { await app.stop(); }
});

test("create_saved_search resolves the location to where atlas's runner looks, keeping only known criteria", async () => {
  const forSale = { displayLocation: "Bath and North East Somerset", hasBoundarySearch: true, isRadiusSearch: false, centerLat: 51.356, centerLng: -2.487, radiusMiles: 1, properties: [] };
  const postcode = { displayLocation: "BA1 1LZ", hasBoundarySearch: false, isRadiusSearch: true, centerLat: 51.393, centerLng: -2.36, radiusMiles: 3, properties: [] };
  const app = await startAccount({}, { responseBody: { "/api/for-sale/Bath/": forSale, "/api/to-rent/BA1%201LZ/": postcode } });
  try {
    const result = await app.call("create_saved_search", {
      name: "3-bed houses in Bath", search_type: "for_sale", notification_frequency: "weekly",
      search_criteria: { location: "Bath", min_beds: 3, max_price: 500000, property_type: ["semi_detached"], status: "sold" },
    }, TOKEN);
    assert.notEqual(result["isError"], true);
    assert.equal(result["structuredContent"]["area"], "Bath and North East Somerset");
    assert.deepEqual(app.atlas[0]!.body["params"].arguments, {
      name: "3-bed houses in Bath", search_type: "for_sale", notification_frequency: "weekly",
      search_criteria: { max_price: 500000, min_beds: 3, property_type: ["semi_detached"], location: "Bath", location_slug: "bath", lat: 51.356, lng: -2.487, radius: 3 },
    });
    assert.equal(app.requests.at(-1)!.searchParams.get("per_page"), "1");

    await app.call("create_saved_search", { name: "Rent near work", search_type: "to_rent", search_criteria: { location: "BA1 1LZ" } }, TOKEN);
    assert.deepEqual(app.atlas[1]!.body["params"].arguments["search_criteria"], { location: "BA1 1LZ", lat: 51.393, lng: -2.36, radius: 3 });

    // An unsigned create asks for sign-in before looking anything up.
    const requests = app.requests.length;
    assert.ok(challengeOf(await app.call("create_saved_search", { name: "x", search_criteria: { location: "Bath" } })));
    assert.equal(app.requests.length, requests);
  } finally { await app.stop(); }
});

test("the caller's token never reaches a log, a result or home.co.uk", async () => {
  const printed: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { printed.push(args.map((a) => a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a)).join(" ")); };
  const app = await startAccount({ list_saved_searches: { throws: true }, pause_saved_search: { status: 500 }, list_price_alerts: { status: 401 } });
  try {
    const results = [
      await app.call("list_saved_searches", {}, TOKEN),
      await app.call("pause_saved_search", { id: "s1", paused: true }, TOKEN),
      await app.call("list_price_alerts", {}, TOKEN),
      await app.call("search_homes", { location: "Bath", listing_type: "sale" }, TOKEN),
    ];
    assert.ok(app.logged.length >= 2, "failures are logged");
    for (const line of [...app.logged, ...printed, ...results.map((r) => JSON.stringify(r))]) assert.doesNotMatch(line, new RegExp(TOKEN));
    for (const url of app.requests) assert.doesNotMatch(url.toString(), new RegExp(TOKEN));
  } finally { console.error = original; await app.stop(); }
});

test("account settings come from the environment with home.co.uk defaults and can be switched off", () => {
  assert.deepEqual(accountFromEnv({}), { resource: "https://mcp.home.co.uk", issuer: "https://home.co.uk", accountMcpUrl: "https://home.co.uk/api/mcp" });
  assert.deepEqual(accountFromEnv({ HOME_MCP_RESOURCE: "https://mcp.home.test/", HOME_OAUTH_ISSUER: "https://home.test/", HOME_ACCOUNT_MCP_URL: "http://127.0.0.1:8000/api/mcp" }),
    { resource: "https://mcp.home.test", issuer: "https://home.test", accountMcpUrl: "http://127.0.0.1:8000/api/mcp" });
  assert.equal(accountFromEnv({ HOME_ACCOUNTS: "off" }), undefined);
  assert.throws(() => accountFromEnv({ HOME_ACCOUNTS: "maybe" }), /HOME_ACCOUNTS/);
  assert.throws(() => accountFromEnv({ HOME_MCP_RESOURCE: "https://mcp.home.co.uk/mcp" }), /origin/);
  assert.throws(() => accountFromEnv({ HOME_ACCOUNT_MCP_URL: "http://atlas.example/api/mcp" }), /https/);
});

test("only saved-search types atlas's runner executes are advertised, and a sold search is refused before atlas", async () => {
  // atlas SavedSearchRunner::run() and newResults() return null for TYPE_SOLD, so a stored
  // sold search would never email or show a new result. These are the types it runs.
  const create = ACCOUNT_TOOLS.find((t) => t.name === "create_saved_search")!;
  const advertised = ((create.inputSchema["properties"] as Record<string, any>)["search_type"].enum) as string[];
  assert.deepEqual(advertised, ["for_sale", "to_rent", "new_builds"]);
  assert.deepEqual(advertised, [...SAVED_SEARCH_TYPES]);

  const app = await startAccount({}, { responseBody: { "/api/for-sale/Bath/": { displayLocation: "Bath", hasBoundarySearch: true, centerLat: 51.38, centerLng: -2.36, radiusMiles: 1, properties: [] }, "/api/to-rent/Bath/": { displayLocation: "Bath", hasBoundarySearch: true, centerLat: 51.38, centerLng: -2.36, radiusMiles: 1, properties: [] } } });
  try {
    for (const search_type of advertised) {
      const result = await app.call("create_saved_search", { name: search_type, search_type, search_criteria: { location: "Bath" } }, TOKEN);
      assert.notEqual(result["isError"], true, search_type);
    }
    assert.deepEqual(app.atlas.map((c) => c.body["params"].arguments.search_type), advertised);
    const sold = await app.call("create_saved_search", { name: "sold", search_type: "sold", search_criteria: { location: "Bath" } }, TOKEN);
    assert.equal(sold["isError"], true);
    assert.match(sold["structuredContent"]["detail"], /sold-price searches cannot be saved/);
    assert.equal(app.atlas.length, advertised.length, "a sold search never reaches atlas");
  } finally { await app.stop(); }
});
