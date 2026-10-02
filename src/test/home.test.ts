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
import { MAPBOX_GL_ASSET_PREFIX } from "../home/mapbox-assets.js";
import { HOME_WIDGET_ASSET_PREFIX, HOME_WIDGET_ASSETS, HOME_WIDGET_CSS_PATH, HOME_WIDGET_SCRIPT_PATH } from "../home/widget-assets.js";
import { buildHomeServer, HOME_ROUTE_TOOLS, HOME_TOOLS } from "../home/server.js";
import { extraWords, insideArea, MapboxRoutes, metresToEdge, namesPlace } from "../home/routes.js";
import { BATH_HOMES, BATH_ROUTE_SCENARIOS, routeFixtureKey } from "./home-routes-fixture.js";
import { buildManifest, readSkills, secretsIn, validatePackage, validateSkills, type Manifest, type Skill } from "../plugin-package.js";
import { matchWishes, WISHES, type Wish } from "../home/wishes.js";
import { HOME_ICONS } from "../home/icons.js";
import { HOME_WIDGET_CSS, HOME_WIDGET_HTML, HOME_WIDGET_SCRIPT, HOME_WIDGET_URI, HOME_WIDGET_VERSION, homeMapLayout, homeMapProject, homePinCollisions, homePinLabel, humaniseDaysListed } from "../home/widget.js";

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

function assertNoInlineMarkup(markup: string): void {
  assert.doesNotMatch(markup, /<style\b/i, "inline style element");
  assert.doesNotMatch(markup, /<script\b(?![^>]*\bsrc=)[^>]*>/i, "inline script element");
  assert.doesNotMatch(markup, /<[^>]+\sstyle\s*=/i, "inline style attribute");
  assert.doesNotMatch(markup, /<[^>]+\son[a-z]+\s*=/i, "inline event handler");
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
    const compare = tools.find((tool) => tool.name === "compare_homes")!;
    assert.equal(compare._meta?.["openai/widgetAccessible"], true);
    assert.deepEqual(compare._meta?.["ui"], { visibility: ["model", "app"] });
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

test("rental map pins show exact prices and sale prices use millions above seven figures", () => {
  assert.equal(homePinLabel(1500, "pcm"), "£1,500");
  assert.equal(homePinLabel(450, "pw"), "£450");
  assert.equal(homePinLabel(325000, null), "£325k");
  assert.equal(homePinLabel(1000000, null), "£1m");
  assert.equal(homePinLabel(1250000, null), "£1.3m");
});

test("listing ages are rounded into human time without exposing raw source floats", () => {
  assert.equal(humaniseDaysListed(0.4), "Listed today");
  assert.equal(humaniseDaysListed(1.483834589386574), "1 day");
  assert.equal(humaniseDaysListed(3.2), "3 days");
  assert.equal(humaniseDaysListed(42.1), "6 weeks");
  assert.equal(humaniseDaysListed(undefined), null);
});

test("the generated dependency-free widget script is valid JavaScript", () => {
  const script = HOME_WIDGET_SCRIPT;
  assert.doesNotThrow(() => new Function(script));
  // These are the allowlisted home-enrichment keys. Keep the producer's
  // contract and the dependency-free widget consumer in lockstep.
  assert.match(script, /obj\(p\.epc\)\.rating/);
  assert.match(script, /risk\('Flood',p\.flood/);
  assert.match(script, /b\.max_speed\|\|b\.max_download_speed/);
  assert.match(script, /risk\('Crime',p\.crime/);
  assert.match(script, /setWidgetState/);
  assert.match(script, /callTool\('compare_homes'/);
  assert.match(script, /sendFollowUpMessage/);
  assert.match(script, /method:'ui\/message'/);
  for (const stage of ["script_start", "handshake_sent", "host_answered", "data_received_openai_globals", "data_received_window_openai", "data_received_mcp_tool_input", "data_received_mcp_tool_result", "cards_drawn", "script_error", "security_policy_"]) {
    assert.ok(HOME_WIDGET_SCRIPT.includes(stage), stage);
  }
  assert.match(HOME_WIDGET_HTML, /stage=page_parsed&amp;host=__HOME_CHECK_IN_HOST__&amp;view=__HOME_VIEW_ID__/);
  assert.doesNotMatch(script, /error\.message|error\.stack/);
  assert.match(script, /widget-check-in\?stage='\+encodeURIComponent\(stage\)\+'&host='\+encodeURIComponent\(location\.hostname\)\+'&view='\+encodeURIComponent\(viewId\)/);
});

test("the widget template and every generated view contain no inline script, handler or style attribute", () => {
  assertNoInlineMarkup(HOME_WIDGET_HTML);
  assert.doesNotMatch(HOME_WIDGET_SCRIPT, /["']\s(?:style|on[a-z]+)=/i);
  assert.doesNotMatch(HOME_WIDGET_SCRIPT, /<style\b|<script\b/i);
});

test("the widget uses home.co.uk's colours: no pastel pink tints, pink outlines or grey Mapbox styles", () => {
  const css = HOME_WIDGET_CSS;
  for (const banned of ["#fdf2f8", "#fce7f3", "#ffe4e6", "#fbcfe8", "#f9a8d4", "#321d2a", "#9d174d", "#be185d", "#db2777", "#ec489955"]) {
    assert.ok(!`${HOME_WIDGET_HTML}${HOME_WIDGET_CSS}${HOME_WIDGET_SCRIPT}`.toLowerCase().includes(banned), `banned tint ${banned}`);
  }
  assert.doesNotMatch(`${HOME_WIDGET_CSS}${HOME_WIDGET_SCRIPT}`, /light-v11|dark-v11/);
  // Pink appears only in gradients, the glass pill's shadow and the selected pin: never as a border or outline.
  assert.doesNotMatch(css, /(border|outline)[^;{}]*(#ec4899|#f43f5e|236,72,153)/);
  assert.match(css, /\.card\{[^}]*border:1px solid var\(--line\)/);
  assert.match(css, /linear-gradient\(to right,rgba\(236,72,153,\.5\),rgba\(244,63,94,\.5\),rgba\(249,115,22,\.5\)\)/);
  assert.match(css, /\.save\{[^}]*background:transparent/);
  assert.doesNotMatch(css, /\.save\{[^}]*(border-radius:50%|rgba\(0,0,0,\.45\))/);
  assert.match(css, /\.save\.saved\{color:#f43f5e\}/);
});

test("every widget icon is the exact Phosphor SVG from @phosphor-icons/core, credited, never a hand-drawn path", () => {
  const phosphor = fileURLToPath(new URL("../../node_modules/@phosphor-icons/core/", import.meta.url));
  assert.equal(HOME_ICONS.package, "@phosphor-icons/core");
  assert.equal(HOME_ICONS.license, "MIT");
  assert.equal(HOME_ICONS.version, JSON.parse(readFileSync(join(phosphor, "package.json"), "utf8")).version);
  for (const [key, asset] of Object.entries(HOME_ICONS.assets)) {
    assert.equal(HOME_ICONS.icons[key], readFileSync(join(phosphor, "assets", `${asset}.svg`), "utf8").trim(), key);
  }
  // The icons Louis named, by role: regular on cards and chips, duotone on the detail key facts.
  assert.deepEqual(Object.fromEntries(["prev", "next", "view", "bed", "bath", "type", "key", "flood", "crime", "school"].map((key) => [key, HOME_ICONS.assets[key]])), {
    prev: "regular/caret-left", next: "regular/caret-right", view: "regular/arrow-up-right", bed: "regular/bed", bath: "regular/bathtub",
    type: "regular/house", key: "regular/key", flood: "regular/drop", crime: "regular/shield", school: "regular/graduation-cap",
  });
  assert.equal(HOME_ICONS.assets.heart, "regular/heart");
  assert.equal(HOME_ICONS.assets["heart-saved"], "fill/heart-fill");
  for (const fact of ["bed", "bath", "type", "area", "key", "calendar", "energy"]) assert.match(HOME_ICONS.assets[`fact-${fact}`]!, /^duotone\//, fact);
  assert.equal(HOME_ICONS.assets["fact-area"], "duotone/ruler-duotone");
  assert.equal(HOME_ICONS.assets["fact-calendar"], "duotone/calendar-duotone");
  assert.equal(HOME_ICONS.assets["fact-energy"], "duotone/lightning-duotone");
  // Nothing in the widget source draws its own shape, and the licence is credited in the served HTML.
  const source = readFileSync(fileURLToPath(new URL("../../src/home/widget.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /<path|<circle|<rect|<polyline|<line /);
  assert.match(HOME_WIDGET_HTML, /Phosphor Icons, https:\/\/phosphoricons\.com, MIT licence/);
  const script = HOME_WIDGET_SCRIPT;
  for (const key of Object.keys(HOME_ICONS.icons)) assert.ok(script.includes(JSON.stringify(key) + ":"), `icon ${key} reaches the widget`);
  assert.doesNotMatch(script, /<\/script/i);
});

test("map price pills become hearts only when their labels collide", () => {
  assert.deepEqual(homePinCollisions([
    { x: 40, y: 40, width: 80, height: 34 },
    { x: 200, y: 40, width: 80, height: 34 },
    { x: 230, y: 42, width: 80, height: 34 },
  ]), [false, false, true]);
  assert.deepEqual(homePinCollisions([]), []);
});

test("listing descriptions become clean plain-text paragraphs", () => {
  assert.equal(
    cleanListingDescription('<p>A bright &amp; airy home.</p><p>Two bedrooms<br>Near the park&nbsp;&#163;.</p><script>ignore()</script>'),
    "A bright & airy home.\n\nTwo bedrooms\n\nNear the park £.",
  );
  assert.equal(cleanListingDescription(" <div> </div> "), null);
});

test("the widget follows ChatGPT events, MCP host context and the system fallback for cards and live maps", async () => {
  const widgetScript = HOME_WIDGET_SCRIPT;
  assert.match(HOME_WIDGET_CSS, /@media\(prefers-color-scheme:dark\)\{:root:not\(\.light\)/);

  function harness(systemDark = false, openai: Record<string, unknown> | undefined = undefined, mapboxToken = "pk.test") {
    const listeners = new Map<string, Array<(event: any) => void>>();
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    let contentHeight = 480;
    const classes = new Set<string>();
    const styles: string[] = [];
    let mapRemoved = false;
    const mapClasses = new Set<string>();
    const mapElement = { clientWidth: 600, dataset: {} as Record<string, string>, classList: { toggle: (name: string, on: boolean) => on ? mapClasses.add(name) : mapClasses.delete(name) }, querySelectorAll: () => [], querySelector: () => null, remove: () => { mapRemoved = true; } };
    const controls = new Map<string, { dataset: Record<string, string>; onclick?: (event: any) => void }>();
    const root = {
      innerHTML: '<div class="empty">Finding beautiful homes…</div>', scrollHeight: 480, querySelector: () => null,
      querySelectorAll(selector: string) {
        if (selector === "[data-map]" || selector === "[data-map]:not([data-drawn])" && !mapElement.dataset.drawn) return [mapElement];
        const attribute = ({ "[data-shortlist]": "data-shortlist", "[data-all]": "data-all", "[data-compare]": "data-compare", "[data-plan]": "data-plan" } as Record<string, string>)[selector];
        if (!attribute || !this.innerHTML.includes(attribute)) return [];
        if (controls.has(selector)) return [controls.get(selector)!];
        const control = { dataset: {} as Record<string, string>, onclick: undefined as ((event: any) => void) | undefined };
        controls.set(selector, control);
        return [control];
      },
    };
    const classList = { toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name) };
    const messages: any[] = [];
    const checkIns: string[] = [];
    const parent = { postMessage: (message: any) => messages.push(message) };
    const window = {
      parent, openai, mapboxgl: undefined as unknown,
      addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    };
    const button = () => { const pin = {
      dataset: {} as Record<string, string>, className: "", type: "", textContent: "", innerHTML: "",
      classList: { contains: () => false, toggle: () => undefined },
      matches: (selector: string) => selector === "[data-index]", setAttribute: () => undefined,
      addEventListener: () => undefined,
    }; pins.push(pin); return pin; };
    const mapboxListeners = new Map<string, () => void>();
    const mapboxScript = { addEventListener: (type: string, listener: () => void) => mapboxListeners.set(type, listener) };
    const config = { dataset: { checkInOrigin: "https://mcp.home.co.uk", viewId: "0123456789abcdef01234567", mapboxToken } };
    const document = { getElementById: (id: string) => id === "root" ? root : id === "home-mapbox" ? mapboxScript : id === "home-widget-config" ? config : null, documentElement: { classList, scrollHeight: 900 }, body: { getBoundingClientRect: () => ({ height: contentHeight }) }, createElement: button };
    const pins: Array<{ className: string; innerHTML: string }> = [];
    const layers: Array<{ id: string; type: string; paint: Record<string, unknown> }> = [];
    const mapEvents = new Map<string, () => void>();
    class FakeMap {
      constructor(options: { style: string }) { styles.push(options.style); }
      addControl() {} jumpTo() {} fitBounds() {} remove() {}
      setStyle(style: string) { styles.push(style); }
      on(type: string, listener: () => void) { mapEvents.set(type, listener); }
      getZoom() { return 12; }
      getSource(id: string) { return id === "composite" ? {} : layers.find((layer) => layer.id === id); }
      getLayer(id: string) { return layers.find((layer) => layer.id === id); }
      addSource(id: string) { layers.push({ id, type: "source", paint: {} }); }
      addLayer(layer: { id: string; type: string; paint: Record<string, unknown> }) { layers.push(layer); }
    }
    class Marker { setLngLat() { return this; } addTo() { return this; } }
    class Bounds { extend() { return this; } }
    const mapboxgl = { Map: FakeMap, Marker, LngLatBounds: Bounds, NavigationControl: class {}, accessToken: "" };
    window.mapboxgl = mapboxgl;
    class CheckInImage { set src(value: string) { checkIns.push(value); } }
    new Function("window", "document", "matchMedia", "mapboxgl", "setTimeout", "clearTimeout", "Image", "location", widgetScript)(window, document, () => ({ matches: systemDark }), mapboxgl, (fn: () => void) => { const timer = ++nextTimer; timers.set(timer, fn); return timer; }, (timer: number) => timers.delete(timer), CheckInImage, { hostname: "web-sandbox.example" });
    const dispatch = (type: string, event: any) => (listeners.get(type) ?? []).forEach((listener) => listener(event));
    const render = () => dispatch("message", { source: parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "listings", homes: [{ price: 325000, coordinates: { latitude: 51.38, longitude: -2.36 } }] } } } });
    const click = (selector: string) => {
      const control = root.querySelectorAll(selector)[0] as { onclick?: (event: any) => void } | undefined;
      assert.ok(control?.onclick, `${selector} is clickable`);
      control.onclick({ stopPropagation() {} });
    };
    return { pins, layers, mapEvents, mapClasses, classes, styles, messages, checkIns, parent, dispatch, render, root, window, mapboxgl, mapboxListeners, mapRemoved: () => mapRemoved, setContentHeight: (height: number) => { contentHeight = height; }, runTimers: () => { for (const fn of [...timers.values()]) fn(); timers.clear(); }, click };
  }

  const home = { id: "strict-home", price: 410000 };
  const toolInput = harness();
  assert.match(toolInput.checkIns[0] ?? "", /stage=script_start&host=web-sandbox\.example&view=0123456789abcdef01234567/);
  toolInput.dispatch("message", { source: toolInput.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { title: "From input", homes: [home] } } } });
  assert.match(toolInput.root.innerHTML, /From input/);

  const structuredResult = harness();
  structuredResult.dispatch("message", { source: structuredResult.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "detail", home } } } });
  assert.match(structuredResult.root.innerHTML, /£410,000/);

  const plainResult = harness();
  plainResult.dispatch("message", { source: plainResult.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [{ type: "text", text: JSON.stringify({ view: "listings", title: "From plain result", homes: [home] }) }] } } });
  assert.match(plainResult.root.innerHTML, /From plain result/);
  const directResult = harness();
  directResult.dispatch("message", { source: directResult.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { view: "listings", title: "From direct result", homes: [home] } } });
  assert.match(directResult.root.innerHTML, /From direct result/);

  const originalToolOutput = { view: "listings", title: "Initial global", homes: [home] };
  const initialGlobal = harness(false, { toolOutput: originalToolOutput });
  assert.match(initialGlobal.root.innerHTML, /Initial global/);
  initialGlobal.root.innerHTML = "User's interactive view";
  initialGlobal.dispatch("openai:set_globals", { detail: { globals: { theme: "dark", toolOutput: structuredClone(originalToolOutput) } } });
  assert.equal(initialGlobal.root.innerHTML, "User's interactive view");
  const laterGlobal = harness();
  laterGlobal.dispatch("openai:set_globals", { detail: { globals: { toolOutput: { view: "detail", home } } } });
  assert.match(laterGlobal.root.innerHTML, /£410,000/);

  const sizing = harness();
  sizing.dispatch("load", {});
  sizing.dispatch("resize", {});
  assert.deepEqual(sizing.messages.filter((message) => message.method === "ui/notifications/size-changed"), [
    { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 480 } },
    { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 480 } },
  ]);
  sizing.setContentHeight(300);
  sizing.dispatch("message", { source: sizing.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { view: "listings", homes: [home] } } });
  assert.deepEqual(sizing.messages.at(-1), { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 300 } });
  const timedOut = harness();
  assert.match(timedOut.root.innerHTML, /Finding beautiful homes/);
  timedOut.runTimers();
  assert.equal(timedOut.root.innerHTML, '<div class="empty">Home could not be opened.</div>');

  const chatgpt = harness(false, { theme: "dark" });
  assert.ok(chatgpt.classes.has("dark"));
  chatgpt.render();
  chatgpt.dispatch("openai:set_globals", { detail: { globals: { theme: "light" } } });
  assert.ok(chatgpt.classes.has("light"));
  assert.equal(chatgpt.styles.at(-1), "mapbox://styles/mapbox/streets-v12");

  // home.co.uk's map: price pills remain visible at town zoom and only colliding labels become hearts.
  assert.ok(!chatgpt.mapClasses.has("far"));
  assert.match(chatgpt.pins[0]!.innerHTML, /^<svg class="heart" aria-hidden="true"[^>]*viewBox="0 0 256 256"/);
  assert.match(chatgpt.pins[0]!.innerHTML, /<span class="bubble">£325k<\/span>/);
  chatgpt.mapEvents.get("style.load")?.();
  assert.deepEqual(chatgpt.layers.map((layer) => layer.id), ["home-buildings"]);
  assert.deepEqual(chatgpt.layers[0]!.paint["fill-extrusion-color"], "#d4d0c8");

  const statuses = harness();
  statuses.dispatch("message", { source: statuses.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "listings", homes: [
    { price: 1, coordinates: { latitude: 51.38, longitude: -2.36 } },
    { price: 2, status: "Sold STC", coordinates: { latitude: 51.38, longitude: -2.36 } },
    { price: 3, reduced_date: "2026-09-01", coordinates: { latitude: 51.38, longitude: -2.36 } },
    { price: 4, new_build: true, new_listing: true, coordinates: { latitude: 51.38, longitude: -2.36 } },
  ] } } } });
  assert.deepEqual(statuses.pins.map((pin) => pin.className), ["pin  active", "pin offer", "pin reduced", "pin newbuild"]);
  assert.match(statuses.root.innerHTML, /<span class="card-tag"><i class="card-tag-dot"><\/i>New<\/span>/);
  assert.match(statuses.root.innerHTML, /<span class="card-tag card-tag-dark">Under offer<\/span>/);
  assert.match(statuses.root.innerHTML, /<span class="glass">New build<\/span>/);

  const routes = harness();
  routes.dispatch("message", { source: routes.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "listings", homes: [
    { id: "outside", address: "Outside home", price: 500000, coordinates: { latitude: 51.39, longitude: -2.35 } },
    { id: "inside", address: "Inside home", price: 1000000, coordinates: { latitude: 51.38, longitude: -2.36 } },
  ], commute: { summary: "1 of 2 homes are within 20 minutes' drive of Bath Spa.", homes_inside: [{ listing_id: "inside" }], homes_outside: [{ listing_id: "outside" }], reachable_area: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-2.37, 51.37], [-2.35, 51.37], [-2.35, 51.39], [-2.37, 51.37]]] } } }, route: { start: { name: "Bath Spa" }, stops: [{ stop: 1, listing_id: "inside", address: "Inside home", drive_from_previous_minutes: 4 }, { stop: 2, listing_id: "outside", address: "Outside home", drive_from_previous_minutes: 8 }], total_driving_minutes: 12, route: { type: "LineString", coordinates: [[-2.36, 51.38], [-2.35, 51.39]] } } } } } });
  routes.mapEvents.get("style.load")?.();
  assert.deepEqual(routes.layers.map((layer) => layer.id), ["home-buildings", "home-commute", "home-commute-area", "home-route", "home-viewing-route"]);
  assert.equal(routes.layers[2]!.paint["fill-color"], "#ec4899");
  assert.equal(routes.layers[2]!.paint["fill-opacity"], .16);
  assert.equal(routes.layers[2]!.paint["fill-outline-color"], undefined);
  assert.deepEqual(routes.layers[4]!.paint["line-gradient"], ["interpolate", ["linear"], ["line-progress"], 0, "#ec4899", 1, "#f97316"]);
  assert.match(routes.pins[0]!.className, /route-stop/);
  assert.match(routes.pins[1]!.className, /faded.*route-stop/);
  assert.match(routes.root.innerHTML, /1 of 2 homes within 20 minutes&#39; drive of Bath Spa/);
  assert.ok(routes.root.innerHTML.indexOf("Inside home") < routes.root.innerHTML.indexOf("Outside home"), "cards follow stop order, not input order");
  assert.match(routes.root.innerHTML, /class="card[^>]*[\s\S]*Inside home[\s\S]*class="card faded"[^>]*[\s\S]*Outside home/);
  assert.match(routes.root.innerHTML, /class="card-stop" aria-label="Viewing stop 1">1<[\s\S]*class="card-stop" aria-label="Viewing stop 2">2</);
  assert.match(routes.root.innerHTML, /Start.*start-address">Bath Spa.*4 min.*Inside home.*8 min.*Outside home.*12 min driving/);
  assert.doesNotMatch(routes.root.innerHTML, /class="refine"/, "route views do not offer search refinements");

  const commute = harness();
  commute.dispatch("message", { source: commute.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "listings", homes: [
    { id: "far", address: "Far home", price: 250000, coordinates: { latitude: 51.45, longitude: -2.3 } },
    { id: "near", address: "Near home", price: 400000, coordinates: { latitude: 51.38, longitude: -2.36 } },
  ], commute: { summary: "1 of 2 homes are within 20 minutes' drive of Bath Spa.", homes_inside: [{ listing_id: "near" }], homes_outside: [{ listing_id: "far" }] } } } } });
  assert.ok(commute.root.innerHTML.indexOf("Near home") < commute.root.innerHTML.indexOf("Far home"), "commute cards put reachable homes first");
  assert.match(commute.root.innerHTML, /class="card faded"[^>]*[\s\S]*Far home/);
  assert.doesNotMatch(commute.pins[0]!.className, /faded/);
  assert.match(commute.pins[1]!.className, /faded/);

  const creative = harness(false, { widgetState: { shortlist: ["home-a", "home-b"] } });
  creative.dispatch("message", { source: creative.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "listings", title: "Bath homes", homes: [
    { id: "home-a", price: 300000, added_date: "2026-08-12", reduced_date: new Date().toISOString(), under_offer_date: "2026-10-01", wishes_matched: [{ wish: "garden", evidence: "A private walled garden opens from the kitchen" }] },
    { id: "home-b", price: 500000 },
  ] } } } });
  assert.match(creative.root.innerHTML, /Shortlist · 2/);
  assert.match(creative.root.innerHTML, /aria-label="Remove from shortlist" aria-pressed="true"/);
  assert.match(creative.root.innerHTML, /<b>Added<\/b><span>12 Aug<\/span>/);
  assert.match(creative.root.innerHTML, /<b>Reduced<\/b><span>/);
  assert.match(creative.root.innerHTML, /<b>Under offer<\/b><span>1 Oct<\/span>/);
  assert.match(creative.root.innerHTML, /✓ Garden<\/b><span>·<\/span><q[^>]*>A private walled garden opens from the kitchen<\/q>/);
  assert.match(creative.root.innerHTML, />Up to £300k<\/button>/);
  assert.match(creative.root.innerHTML, />Reduced recently<\/button>/);
  assert.match(creative.root.innerHTML, />With a garden<\/button>/);

  const wishes = harness();
  wishes.dispatch("message", { source: wishes.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "listings", homes: [
    { id: "wish-a", price: 1, wishes_matched: [{ wish: "off_road_parking", evidence: "A private driveway provides off road parking for several vehicles beside the house" }] },
  ] } } } });
  assert.match(wishes.root.innerHTML, /✓ Off-road parking<\/b>/);
  assert.match(wishes.root.innerHTML, /<q aria-hidden="true"[^>]*>A private driveway provides off road parking for several…<\/q>/);
  assert.match(wishes.root.innerHTML, /class="sr-only">“A private driveway provides off road parking for several vehicles beside the house”<\/span>/);
  assert.doesNotMatch(wishes.root.innerHTML, /class="refine"/, "a refinement that keeps every result is not offered");

  const detailFacts = harness();
  detailFacts.dispatch("message", { source: detailFacts.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "detail", home: {
    bedrooms: 4, bathrooms: 2, reception_rooms: 3, property_type: "detached", floor_area_sqm: 180, tenure: "freehold",
  } } } } });
  assert.equal((detailFacts.root.innerHTML.match(/class="fact"/g) ?? []).length, 4);
  assert.match(detailFacts.root.innerHTML, /Floor area/);
  assert.match(detailFacts.root.innerHTML, /Tenure/);
  assert.doesNotMatch(detailFacts.root.innerHTML, /Receptions/);

  const calls: Array<[string, Record<string, unknown>]> = [];
  const compare = harness(false, {
    widgetState: { shortlist: ["home-a", "home-b"] },
    callTool: async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      return { structuredContent: { homes: [{ id: "home-a", address: "Compared A", price: 300000 }, { id: "home-b", address: "Compared B", price: 500000 }] } };
    },
  });
  compare.dispatch("message", { source: compare.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "listings", title: "Original Bath results", homes: [
    { id: "home-a", address: "Original A", price: 300000, wishes_matched: [{ wish: "garden", evidence: "A private walled garden" }] },
    { id: "home-b", address: "Original B", price: 500000 },
    { id: "home-c", address: "Original C", price: 600000 },
  ] } } } });
  compare.click("[data-shortlist]");
  compare.click("[data-compare]");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [["compare_homes", { listing_ids: ["home-a", "home-b"] }]]);
  assert.match(compare.root.innerHTML, /Shortlist comparison/);
  assert.match(compare.root.innerHTML, /Compared A/);
  assert.match(compare.root.innerHTML, /A private walled garden/);
  compare.click("[data-all]");
  assert.match(compare.root.innerHTML, /Original Bath results/);
  assert.match(compare.root.innerHTML, /Original C/);

  const plannerCalls: Array<[string, Record<string, unknown>]> = [];
  const planner = harness(false, { widgetState: { shortlist: ["home-a", "home-b"] }, callTool: async (name: string, args: Record<string, unknown>) => {
    plannerCalls.push([name, args]); return { structuredContent: { stops: [{ stop: 1, listing_id: "home-b", address: "B" }, { stop: 2, listing_id: "home-a", address: "A", drive_from_previous_minutes: 6 }], total_driving_minutes: 6, route: { type: "LineString", coordinates: [] } } };
  } });
  planner.dispatch("message", { source: planner.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "listings", homes: [{ id: "home-a" }, { id: "home-b" }] } } } });
  planner.click("[data-shortlist]"); planner.click("[data-plan]");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(plannerCalls, [["plan_viewings", { listing_ids: ["home-a", "home-b"] }]]);
  assert.match(planner.root.innerHTML, /Your viewing day/);
  assert.match(planner.root.innerHTML, /6 min driving/);

  const noRouteTool = harness(false, { widgetState: { shortlist: ["home-a", "home-b"] } }, "");
  noRouteTool.dispatch("message", { source: noRouteTool.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "listings", homes: [{ id: "home-a" }, { id: "home-b" }] } } } });
  noRouteTool.click("[data-shortlist]");
  assert.doesNotMatch(noRouteTool.root.innerHTML, /Plan my viewings/);

  const mcp = harness();
  mcp.dispatch("message", { source: mcp.parent, data: { jsonrpc: "2.0", id: "home-ui-init", result: { hostContext: { theme: "dark" } } } });
  assert.ok(mcp.classes.has("dark"));

  const system = harness(true);
  system.render();
  assert.equal(system.styles[0], "mapbox://styles/mapbox/navigation-night-v1");

  const delayed = harness();
  delayed.window.mapboxgl = undefined;
  delayed.render();
  assert.match(delayed.root.innerHTML, /data-map/);
  assert.equal(delayed.styles.length, 0);
  delayed.window.mapboxgl = delayed.mapboxgl;
  delayed.mapboxListeners.get("load")?.();
  assert.equal(delayed.styles[0], "mapbox://styles/mapbox/streets-v12");

  const failed = harness();
  failed.window.mapboxgl = undefined;
  failed.render();
  failed.mapboxListeners.get("error")?.();
  assert.equal(failed.mapRemoved(), true);

  const detail = harness();
  detail.dispatch("message", { source: detail.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {
    view: "detail", home: { enrichment: { scope: "area", area: { broadband: { max_download_speed: 1000 }, crime: { level: "14 RECORDED CRIMES" }, schools: [{ name: "Area Primary", distance_km: 1.1, ofsted_rating: "Good" }] } } },
  } } } });
  assert.match(detail.root.innerHTML, /Know before you view/);
  assert.equal((detail.root.innerHTML.match(/for the area/g) ?? []).length, 3);
  assert.match(detail.root.innerHTML, /<span class="ofsted">Good<\/span><span class="distance">0\.7 mi<\/span>/);
  assert.match(detail.root.innerHTML, /Crime: 14 recorded crimes/);
  detail.dispatch("message", { source: detail.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {
    view: "detail", home: { enrichment: { available: false } },
  } } } });
  assert.doesNotMatch(detail.root.innerHTML, /Know before you view/);
  for (const rendered of [toolInput, structuredResult, statuses, routes, wishes, detail]) assertNoInlineMarkup(rendered.root.innerHTML);
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

test("Home publishes a v13 MCP Apps resource with only external script and stylesheet assets", async () => {
  const { mcp, stop } = await start();
  try {
    const resources = await mcp.listResources();
    assert.deepEqual(resources.resources.map((resource) => resource.uri), ["ui://home/listings-and-detail-v13.html"]);
    const resource = await mcp.readResource({ uri: resources.resources[0]!.uri });
    const content = resource.contents[0] as { mimeType?: string; text?: string; _meta?: Record<string, unknown> };
    assert.equal(content.mimeType, "text/html;profile=mcp-app");
    assert.match(HOME_WIDGET_SCRIPT, /ui\/notifications\/tool-result/);
    assert.match(HOME_WIDGET_SCRIPT, /ui\/initialize/);
    assert.match(HOME_WIDGET_SCRIPT, /ui\/notifications\/initialized/);
    assert.match(HOME_WIDGET_CSS, /@media\(max-width:700px\)/);
    const ui = content._meta?.["ui"] as { csp?: { connectDomains?: string[]; resourceDomains?: string[] } };
    assert.deepEqual(ui.csp?.connectDomains, []);
    assert.deepEqual(ui.csp?.resourceDomains, ["https://home.co.uk", "https://cdn.home.co.uk", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://mcp.home.co.uk"]);
    const pageCheckIn = content.text?.match(/widget-check-in\?stage=page_parsed&amp;host=mcp\.home\.co\.uk&amp;view=([a-f0-9]{24})/);
    assert.ok(pageCheckIn, "plain HTML check-in has an anonymous random view id");
    assert.ok((content.text?.match(new RegExp(pageCheckIn[1], "g")) ?? []).length >= 2, "script and HTML share the view id");
    assert.doesNotMatch(content.text ?? "", /openstreetmap|tile\.openstreetmap/i);
    assert.doesNotMatch(content.text ?? "", /mapbox-gl-js/);
    assert.match(content.text ?? "", /data-mapbox-token=""/);
    assert.match(content.text ?? "", new RegExp(`href="https://mcp\\.home\\.co\\.uk${HOME_WIDGET_CSS_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(content.text ?? "", new RegExp(`src="https://mcp\\.home\\.co\\.uk${HOME_WIDGET_SCRIPT_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  } finally { await stop(); }
});

test("Home serves the integrity-pinned versioned widget JavaScript and CSS as immutable CORS assets", async () => {
  const { base, mcp, stop } = await start();
  try {
    const resource = await mcp.readResource({ uri: HOME_WIDGET_URI });
    const html = (resource.contents[0] as { text?: string }).text ?? "";
    const contentHash = createHash("sha256").update(HOME_WIDGET_SCRIPT).update("\0").update(HOME_WIDGET_CSS).digest("hex").slice(0, 20);
    assert.equal(HOME_WIDGET_ASSET_PREFIX, `/assets/home-widget/v${HOME_WIDGET_VERSION}/${contentHash}`);
    for (const [file, path] of [["widget.js", HOME_WIDGET_SCRIPT_PATH], ["widget.css", HOME_WIDGET_CSS_PATH]]) {
      const expected = HOME_WIDGET_ASSETS.get(path)!;
      const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tag = html.match(new RegExp(`(?:src|href)="https://mcp\\.home\\.co\\.uk${escapedPath}"[^>]*integrity="(sha384-[^"]+)"`));
      assert.equal(tag?.[1], expected.integrity, `${file} integrity`);
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), expected.contentType);
      assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected.body);
      const head = await fetch(base + path, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      assert.equal(head.headers.get("content-length"), String(expected.body.length));
      const refused = await fetch(base + path, { method: "POST" });
      assert.equal(refused.status, 405);
      assert.equal(refused.headers.get("allow"), "GET, HEAD");
    }
  } finally { await stop(); }
});

test("a directly embedded Home server still points widget assets and check-ins at mcp.home.co.uk", async () => {
  const { client } = fixtures();
  const server = buildHomeServer(client);
  const [clientSide, serverSide] = (await import("@modelcontextprotocol/sdk/inMemory.js")).InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await mcp.connect(clientSide);
  try {
    const resource = await mcp.readResource({ uri: HOME_WIDGET_URI });
    const content = resource.contents[0] as { text?: string; _meta?: Record<string, unknown> };
    assert.match(content.text ?? "", new RegExp(`https://mcp\\.home\\.co\\.uk${HOME_WIDGET_SCRIPT_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(content.text ?? "", /https:\/\/mcp\.home\.co\.uk\/widget-check-in/);
    const ui = content._meta?.["ui"] as { csp?: { resourceDomains?: string[] } };
    assert.ok(ui.csp?.resourceDomains?.includes("https://mcp.home.co.uk"));
  } finally { await mcp.close(); await server.close(); }
});

test("Home keeps every earlier listings-and-detail template address serving the current widget", async () => {
  const { mcp, stop } = await start();
  try {
    const current = await mcp.readResource({ uri: HOME_WIDGET_URI });
    const expected = current.contents[0] as { mimeType?: string; text?: string; _meta?: Record<string, unknown> };
    const withoutViewId = (text: string | undefined) => text?.replaceAll(/view=[a-f0-9]{24}/g, "view=<random>").replaceAll(/data-view-id="[a-f0-9]{24}"/g, 'data-view-id="<random>"');

    for (let version = 1; version <= HOME_WIDGET_VERSION; version += 1) {
      const uri = `ui://home/listings-and-detail-v${version}.html`;
      const resource = await mcp.readResource({ uri });
      const content = resource.contents[0] as { uri?: string; mimeType?: string; text?: string; _meta?: Record<string, unknown> };
      assert.equal(content.uri, uri);
      assert.equal(content.mimeType, expected.mimeType);
      assert.equal(withoutViewId(content.text), withoutViewId(expected.text));
      assert.deepEqual(content._meta, expected._meta);
    }
  } finally { await stop(); }
});

test("Home serves the exact integrity-pinned Mapbox client bytes referenced by the widget", async () => {
  const { base, mcp, stop } = await start({}, { mapboxToken: "pk.browser-token" });
  try {
    const resource = await mcp.readResource({ uri: HOME_WIDGET_URI });
    const content = resource.contents[0] as { text?: string; _meta?: Record<string, unknown> };
    const html = content.text ?? "";
    for (const file of ["mapbox-gl.js", "mapbox-gl.css"]) {
      const path = `${MAPBOX_GL_ASSET_PREFIX}/${file}`;
      const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tag = html.match(new RegExp(`(?:src|href)="https://mcp\\.home\\.co\\.uk${escapedPath}"[^>]*integrity="(sha384-[^"]+)"`));
      assert.ok(tag, `${file} tag and integrity`);
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(`sha384-${createHash("sha384").update(bytes).digest("base64")}`, tag[1]);

      const head = await fetch(base + path, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      assert.equal(head.headers.get("content-length"), String(bytes.length));

      const refused = await fetch(base + path, { method: "POST" });
      assert.equal(refused.status, 405);
      assert.equal(refused.headers.get("allow"), "GET, HEAD");
    }
    assert.match(content.text ?? "", /data-mapbox-token="pk\.browser-token"/);
    assert.match(HOME_WIDGET_SCRIPT, /new gl\.Map/);
    assert.match(HOME_WIDGET_SCRIPT, /NavigationControl/);
    const ui = content._meta?.["ui"] as { csp?: { connectDomains?: string[]; resourceDomains?: string[] } };
    assert.deepEqual(ui.csp?.connectDomains, ["https://api.mapbox.com", "https://events.mapbox.com"]);
    assert.ok(ui.csp?.resourceDomains?.includes("https://mcp.home.co.uk"));
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

// Phrases from live home.co.uk listings, 2 October 2026.
test("a wish matches only when the listing states it, and its evidence is the listing's own phrase", () => {
  const stated: Array<[Wish, string, string]> = [
    ["garden", "At the rear there is a mature private garden with a private feel.", "At the rear there is a mature private garden with a private feel"],
    ["garden", "Benefitting from on street permit parking, communal gardens and offered To The Market With No Onward Chain.", "Benefitting from on street permit parking, communal gardens and offered To The Market With No Onward Chain"],
    ["off_road_parking", "The property also benefits from a Driveway providing off-road parking for up to three cars.", "The property also benefits from a Driveway providing off-road parking for up to three cars"],
    ["off_road_parking", "AVAILABLE 23RD NOVEMBER | FULLY FURNISHED | SECURE ALLOCATED PARKING | BALCONY", "SECURE ALLOCATED PARKING"],
    ["quiet_street", "Heritage Close is a quiet cul-de-sac within the village of Peasedown St John.", "Heritage Close is a quiet cul-de-sac within the village of Peasedown St John"],
    ["quiet_street", "Quietly tucked away on a no through road, lies this three bedroom terraced home.", "Quietly tucked away on a no through road, lies this three bedroom terraced home"],
    ["period_features", "Retaining charming period features such as picture rails, original doors, and Bakelite handles.", "Retaining charming period features such as picture rails, original doors, and Bakelite handles"],
    ["period_features", "An immaculately-presented, terraced Victorian home occupying a popular position in Windmill Hill.", "An immaculately-presented, terraced Victorian home occupying a popular position in Windmill Hill"],
    ["open_plan", "The heart of the home is the wonderful open-plan Kitchen/Dining/Living Room.", "The heart of the home is the wonderful open-plan Kitchen/Dining/Living Room"],
    ["home_office", "The property boasts three generous bedrooms, a separate study and two reception rooms.", "The property boasts three generous bedrooms, a separate study and two reception rooms"],
    ["no_chain", "This two-bed flat is chain free and ready for its next chapter.", "This two-bed flat is chain free and ready for its next chapter"],
    ["no_chain", "Sold with vacant possession", "Sold with vacant possession"],
  ];
  for (const [wish, text, evidence] of stated) {
    const found = matchWishes(text, [wish]);
    assert.deepEqual(found, [{ wish, evidence }], text);
    assert.ok(text.includes(found[0]!.evidence), "evidence is quoted, never rewritten");
  }

  // Each of these mentions the word without stating the feature for this home.
  const notStated: Array<[Wish, string]> = [
    ["garden", "There is no garden, but the park is opposite."],
    ["garden", "A short walk to Sydney Gardens and the city centre."],
    ["garden", "Close to the garden centre and local shops."],
    ["garden", "Garden details: Terrace"],
    ["garden", "A lovely ground floor garden flat."],
    ["off_road_parking", "Immediately outside, offering potential for further off-road parking, subject to any necessary permissions."],
    ["off_road_parking", "The former garage has been converted into a snug."],
    ["off_road_parking", "Unrestricted on street parking."],
    ["quiet_street", "Internal French doors lead into the sun room, currently enjoyed by the owner as a peaceful reading spot."],
    ["quiet_street", "A handy storage cupboard keeps coats and shoes neatly tucked away."],
    ["period_features", "Close to Royal Victoria Park, the surrounding grounds are Grade II listed."],
    ["period_features", "A Victorian-style terrace built in 2019."],
    ["home_office", "A third bedroom offers flexibility for guests or a home office."],
    ["home_office", "This versatile space could be used as a home office, hobby room or occasional guest accommodation."],
    ["open_plan", "The kitchen is not open plan."],
    ["no_chain", "We can take your property in as part exchange, giving you a guaranteed buyer and a quicker, chain-free move."],
    // Opposite claims: the chain phrases are negated before or after, never evidence.
    ["no_chain", "This sale is not chain-free."],
    ["no_chain", "Please note the property is not chain free as the vendors are buying."],
    ["no_chain", "Vacant possession is not available."],
    ["no_chain", "Vacant possession will not be given on completion."],
    ["no_chain", "Sold without vacant possession, with the tenant in situ."],
    ["off_road_parking", "Off-road parking is not available."],
  ];
  for (const [wish, text] of notStated) assert.deepEqual(matchWishes(text, [wish]), [], `${wish}: ${text}`);
  // A denial of something else in the clause leaves the wish stated.
  assert.equal(matchWishes("A rear garden which is not overlooked.", ["garden"])[0]?.evidence, "A rear garden which is not overlooked");
  assert.equal(matchWishes("Offered with no onward chain, which is not often the case here.", ["no_chain"])[0]?.evidence, "Offered with no onward chain, which is not often the case here");
  assert.equal(matchWishes("Vacant possession and chain free.", ["no_chain"])[0]?.evidence, "Vacant possession and chain free");
  assert.deepEqual(matchWishes(null, [...WISHES]), []);
});

test("a long sentence is cut to a short phrase around the match, at word boundaries", () => {
  const text = "Allen Residential are pleased to offer for sale with no onward chain this extended family home in a pleasant cul de sac requiring modernising offering fantastic potential, with views across the valley towards the hills beyond the village and the river.";
  const [match] = matchWishes(text, ["quiet_street"]);
  assert.ok(match && match.evidence.length <= 130 && match.evidence.includes("cul de sac"), match?.evidence);
  const at = text.indexOf(match.evidence);
  assert.ok(at > 0, "an exact part of the listing");
  assert.match(text[at - 1]!, /\s/, "starts on a whole word");
  assert.match(text[at + match.evidence.length] ?? " ", /[\s,.]/, "ends on a whole word");
});

test("search_homes with wishes reads each full listing, ranks the homes stating most wishes first and quotes them", async () => {
  const { mcp, requests, stop } = await start({ responseBody: {
    [`/api/property-details/${ID}`]: { description: "<p>Heritage Close is a quiet cul-de-sac within the village of Peasedown St John.</p><p>There is no garden.</p>" },
    [`/api/property-details/${ID2}`]: { description: "<div>Externally there is a lawned garden to the front and driveway parking.</div><div>Set in a quiet cul-de-sac.</div>" },
  } });
  try {
    const plain = await mcp.callTool({ name: "search_homes", arguments: { location: "Bath", listing_type: "sale" } });
    assert.equal((plain.structuredContent as Record<string, unknown>)["wishes"], undefined);
    assert.equal(requests.filter((url) => url.pathname.startsWith("/api/property-details/")).length, 0, "a plain search reads no listing");

    const answer = await mcp.callTool({ name: "search_homes", arguments: { location: "Bath", listing_type: "sale", wishes: ["garden", "quiet_street", "garden"] } });
    const body = answer.structuredContent as { wishes: string[]; homes_matching_every_wish: number; wishes_next_page?: number; homes: Array<{ id: string; wishes_matched: Array<{ wish: string; evidence: string }>; wishes_not_stated: string[]; wishes_checked_in: string }> };
    assert.deepEqual(body.wishes, ["garden", "quiet_street"]);
    assert.deepEqual(body.homes.map((home) => home.id), [ID2, ID], "the home stating both wishes comes first");
    assert.deepEqual(body.homes[0]!.wishes_matched, [
      { wish: "garden", evidence: "Externally there is a lawned garden to the front and driveway parking" },
      { wish: "quiet_street", evidence: "Set in a quiet cul-de-sac" },
    ]);
    assert.deepEqual(body.homes[1]!.wishes_matched, [{ wish: "quiet_street", evidence: "Heritage Close is a quiet cul-de-sac within the village of Peasedown St John" }]);
    assert.deepEqual(body.homes[1]!.wishes_not_stated, ["garden"], "\"no garden\" is never a garden");
    assert.equal(body.homes[0]!.wishes_checked_in, "full_description");
    assert.equal(body.homes_matching_every_wish, 1);
    assert.equal(body.wishes_next_page, undefined, "a single source page has nothing more to check");
    assert.doesNotMatch(JSON.stringify(body), /MUST NOT LEAK/);
    assert.equal(requests.filter((url) => url.pathname.startsWith("/api/property-details/")).length, 2);

    await mcp.callTool({ name: "search_homes", arguments: { location: "Bath", listing_type: "sale", wishes: ["no_chain"] } });
    assert.equal(requests.filter((url) => url.pathname.startsWith("/api/property-details/")).length, 2, "listing text is kept, so a refined wish search reads nothing again");

    const bad = await mcp.callTool({ name: "search_homes", arguments: { location: "Bath", listing_type: "sale", wishes: ["swimming_pool"] } });
    assert.equal(bad.isError, true);
    assert.match(JSON.stringify(bad.structuredContent), /wishes must list one or more of garden, off_road_parking/);
  } finally { await stop(); }
});

test("a wish search checks the card summary when a listing cannot be read, says so, and offers the next page", async () => {
  const summary = "THE PROPERTYAllen Residential are pleased to offer for sale with no onward chain this extended famil...";
  const { client, requests } = fixtures({
    status: { [`/api/property-details/${ID}`]: 500 },
    responseBody: { "/api/for-sale/Bath/": { displayLocation: "Bath", total: 40, pagination: { current_page: 1, last_page: 2 }, properties: [{ listing_id: ID, description: summary }] } },
    logger: () => {},
  });
  const body = await client.search({ location: "Bath", listing_type: "sale", wishes: ["no_chain"] });
  const [home] = body["homes"] as Array<Record<string, unknown>>;
  assert.equal(home!["wishes_checked_in"], "summary_only");
  assert.deepEqual(home!["wishes_matched"], [{ wish: "no_chain", evidence: "THE PROPERTYAllen Residential are pleased to offer for sale with no onward chain this extended famil" }]);
  assert.equal(body["wishes_next_page"], 2);
  assert.match(String(body["wishes_note"]), /page 2 and the same arguments/);
  // A failed read is not kept: the next search reads the listing again.
  await client.search({ location: "Bath", listing_type: "sale", wishes: ["no_chain"] });
  assert.equal(requests.filter((url) => url.pathname === `/api/property-details/${ID}`).length, 2);

  for (const wishes of [[], "garden", ["pool"], 7]) {
    await assert.rejects(() => client.search({ location: "Bath", listing_type: "sale", wishes: wishes as never }), /wishes must list one or more of/);
  }
});

test("search_homes offers every wish as an enum the golden set is checked against", () => {
  const search = HOME_TOOLS.find((tool) => tool.name === "search_homes")!;
  const wishes = (search.inputSchema["properties"] as Record<string, { items: { enum: string[] } }>)["wishes"]!;
  assert.deepEqual(wishes.items.enum, [...WISHES]);
  const set = structuredClone(golden) as GoldenSet;
  set.cases.find((c) => c.id === "wish-period-no-chain")!.expect.calls[0]!.args["wishes"] = ["period_features", "sea_view"];
  assert.match(checkGoldenSet(set, HOME_TOOLS as never).join("\n"), /search_homes\.wishes item sea_view is not allowed/);
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
      "/deprivation/": { area: "Bath 001", overall_decile: 8 },
      "/price-growth/BA2/": { annual_growth_percent: 3.2 },
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
      deprivation: { area: "Bath 001", overall_decile: 8 },
      price_growth: { annual_growth_percent: 3.2 },
    });
    assert.equal("unavailable" in enrichment, false);
    assert.equal(requests.some((url) => url.pathname === "/address/find/" || url.pathname.includes("/core/")), false);
    assert.ok(requests.some((url) => url.pathname === "/schools/nearby"));
    assert.ok(requests.some((url) => url.pathname === "/price-growth/BA2/"));
  } finally { await stop(); }
});

test("get_home reports complete and partial area enrichment failures", async () => {
  const areaPaths = ["/crime/", "/schools/nearby", "/broadband/", "/deprivation/", "/price-growth/BA2/"];
  const allFailed = await start({ detail: { building_number: null, building_name: null }, status: Object.fromEntries(areaPaths.map((path) => [path, 402])), logger: () => {} });
  try {
    const answer = await allFailed.mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    assert.deepEqual((answer.structuredContent as Record<string, unknown>)["enrichment"], {
      available: false,
      reason: "Not available right now.",
      unavailable: ["crime", "schools", "broadband", "deprivation", "price_growth"],
    });
  } finally { await allFailed.stop(); }

  const partial = await start({
    detail: { building_number: null, building_name: null },
    status: { "/crime/": 402 },
    responseBody: { "/broadband/": { max_download_speed: 1000 }, "/deprivation/": {}, "/price-growth/BA2/": {} },
    logger: () => {},
  });
  try {
    const answer = await partial.mcp.callTool({ name: "get_home", arguments: { listing_id: ID } });
    const enrichment = (answer.structuredContent as Record<string, unknown>)["enrichment"] as Record<string, unknown>;
    assert.equal(enrichment["available"], true);
    assert.deepEqual(enrichment["unavailable"], ["crime"]);
    assert.deepEqual(enrichment["area"], { broadband: { max_download_speed: 1000 } });
  } finally { await partial.stop(); }
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

test("widget stage check-ins return an empty no-store response", async () => {
  const { base, stop } = await start();
  try {
    const response = await fetch(base + "/widget-check-in?stage=script_start&host=web-sandbox.example&view=0123456789abcdef01234567");
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal((await response.arrayBuffer()).byteLength, 0);
    const refused = await fetch(base + "/widget-check-in", { method: "POST" });
    assert.equal(refused.status, 405);
    assert.equal(refused.headers.get("cache-control"), "no-store");
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
    assert.equal(paths.some((path) => path.startsWith("dist/home/") || path.startsWith("dist/test/home")), false, paths.filter((p) => p.includes("home")).join("\n"));
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
const toolNames = [...HOME_TOOLS, ...HOME_ROUTE_TOOLS, ...ACCOUNT_TOOLS].map((t) => t.name);

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

test("Home review cases: five live-checked positives that cover every skill, wishes, commute and a viewing day, three negatives", () => {
  const cases = buildHome().extensions["com.openai"].review!.test_cases!;
  assert.deepEqual(cases.positive.map((c) => c.tools_triggered), [
    "calculate_mortgage, calculate_stamp_duty, search_homes, render_home_listings",
    "search_homes, get_home",
    "search_homes, compare_homes, commute_filter",
    "search_homes, plan_viewings",
    "calculate_stamp_duty, calculate_mortgage",
  ]);
  const reviewSearches = (golden as GoldenSet).cases.filter((c) => c.review).flatMap((c) => c.expect.calls).filter((call) => call.tool === "search_homes");
  assert.ok(reviewSearches.some((call) => Array.isArray(call.args["wishes"]) && (call.args["wishes"] as unknown[]).length > 0), "no review case searches by wishes");
  assert.equal(cases.negative.length, 3);
  for (const c of cases.positive) assert.doesNotMatch(c.prompt, /^\(after /, "a review prompt must stand alone");
  for (const skill of readSkills(PLUGIN)) {
    assert.ok(cases.positive.some((c) => c.expected_behavior.includes(`the ${skill.dir} skill`)), `no review case exercises ${skill.dir}`);
  }
});

test("Home skills are bound to the tools the endpoint lists and held to the listing rules", () => {
  const skills = readSkills(PLUGIN);
  assert.deepEqual(skills.map((s) => s.dir), ["buying-costs", "plan-a-viewing-day", "prepare-for-a-viewing", "shortlist-and-compare", "what-can-i-afford"]);
  assert.deepEqual(validateSkills(skills, [...HOME_TOOLS, ...HOME_ROUTE_TOOLS], HOME_RULES, MCP_URL), []);
  // The route tools are listed only with a Mapbox token, so without them the skills that call them go red.
  assert.match(validateSkills(skills, [...HOME_TOOLS], HOME_RULES, MCP_URL).join("\n"), /plan-a-viewing-day: names `plan_viewings`/);

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

test("the committed submission ZIP holds exactly what the packager builds from these sources, and no secret", () => {
  // docs/home-chatgpt-app/home-chatgpt-plugin.zip is the file uploaded to the portal.
  // Rebuild it with `node scripts/package-chatgpt-plugin.mjs home` after any listing, skill or review-case change.
  const zip = join(ROOT, "docs/home-chatgpt-app/home-chatgpt-plugin.zip");
  const names = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter((n) => n && !n.endsWith("/")).sort();
  const skillFiles = readSkills(PLUGIN).flatMap((s) => [`skills/${s.dir}/SKILL.md`, `skills/${s.dir}/agents/openai.yaml`]);
  assert.deepEqual(names, ["assets/logo.png", "mcp.json", "plugin.json", ...skillFiles].sort());
  const entry = (name: string) => execFileSync("unzip", ["-p", zip, name], { maxBuffer: 1 << 24 });
  assert.equal(entry("plugin.json").toString("utf8"), JSON.stringify(buildHome(), null, 2) + "\n", "plugin.json is stale: rebuild the ZIP");
  for (const name of names.filter((n) => n !== "plugin.json")) assert.ok(entry(name).equals(readFileSync(join(PLUGIN, name))), `${name} is stale: rebuild the ZIP`);
  assert.deepEqual(secretsIn(names.map((name) => ({ path: name, bytes: entry(name) }))), []);
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

async function startAccount(answers: Record<string, AtlasAnswer> = {}, fixtureOptions: FixtureOptions = {}, mapboxToken?: string) {
  const fake = atlas(answers);
  const logged: string[] = [];
  const logger = (message: string, detail: unknown) => logged.push(`${message} ${detail instanceof Error ? `${detail.name}: ${detail.message}` : JSON.stringify(detail)}`);
  const app = await start({ ...fixtureOptions, logger }, { account: { resource: RESOURCE, issuer: "https://home.test", accountMcpUrl: ACCOUNT_URL, fetchImpl: fake.fetchImpl, logger }, mapboxToken });
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
  // As in production: a Mapbox token and account settings, so every tool is listed.
  const app = await startAccount({}, {}, "pk.production-shape");
  try {
    const tools = (await app.rpc("tools/list", {})).body["result"].tools as Array<Record<string, any>>;
    assert.deepEqual(tools.map((t) => t.name), [...HOME_TOOLS, ...HOME_ROUTE_TOOLS, ...ACCOUNT_TOOLS].map((t) => t.name));
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

// ---- Commute and viewing-day tools, replayed from Mapbox and home.co.uk answers recorded in Bath ----

const ROUTE_FIXTURE = JSON.parse(readFileSync(join(ROOT, "src/test/fixtures/home-routes.json"), "utf8")) as { responses: Record<string, { status: number; body: unknown }> };
const MAPBOX_TOKEN = "pk.test-route-token";
type RouteOverride = [(url: URL) => boolean, { status: number; body: unknown } | "network"];

async function routeApp(overrides: RouteOverride[] = [], searchFirst = true) {
  const requests: Array<{ url: URL; headers: Record<string, string> }> = []; const logged: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input)); requests.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.pathname === "/api/for-sale/Bath/") {
      const publicAddresses: Record<string, string> = {
        [BATH_HOMES.paragon]: "The Paragon, Walcot, Bath",
        [BATH_HOMES.hallFloor]: "Bathwick, Bath",
        [BATH_HOMES.oldfieldPark]: "Lower Oldfield Park, Bath",
        [BATH_HOMES.twerton]: "Cameley Green, Twerton, Bath",
        [BATH_HOMES.upperWeston]: "Manor Road, Upper Weston, Bath",
        [BATH_HOMES.peasedown]: "Heritage Close, Peasedown St John, Bath",
        [BATH_HOMES.kensingtonPlace]: "Kensington Place, Bath",
        [BATH_HOMES.avondaleRoad]: "Avondale Road, Bath",
      };
      const properties = Object.entries(publicAddresses).map(([listing_id, display_address]) => ({
        listing_id, display_address, postcode: null,
      }));
      return new Response(JSON.stringify({ displayLocation: "Bath", total: properties.length, pagination: { current_page: 1, last_page: 1 }, properties }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const override = overrides.find(([match]) => match(url))?.[1];
    if (override === "network") throw new TypeError("fetch failed");
    // Proximity follows the homes found, so a test that hides a home still replays its place search.
    const loose = (key: string) => key.replace(/[?&]proximity=[^&]*/, "");
    const answer = override ?? ROUTE_FIXTURE.responses[routeFixtureKey(url)]
      ?? Object.entries(ROUTE_FIXTURE.responses).find(([key]) => loose(key) === loose(routeFixtureKey(url)))?.[1];
    if (!answer) throw new Error(`no recorded answer for ${routeFixtureKey(url)}; re-run scripts/home-record-routes.mjs`);
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const logger = (message: string, detail: unknown) => logged.push(`${message} ${JSON.stringify(detail)}`);
  const client = new HomeClient({ homedata: new HomedataClient({ apiKey: "test", baseUrl: "https://data.test", fetchImpl }), fetchImpl, logger });
  const searched = searchFirst ? await client.search({ location: "Bath", listing_type: "sale" }) : null;
  const routes = new MapboxRoutes({ token: MAPBOX_TOKEN, fetchImpl, logger, referer: "https://mcp.home.co.uk/" });
  const server = buildHomeServer(client, undefined, { routes });
  const [clientSide, serverSide] = (await import("@modelcontextprotocol/sdk/inMemory.js")).InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await server.connect(serverSide); await mcp.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>) => {
    const answer = await mcp.callTool({ name, arguments: args });
    return { isError: answer.isError === true, body: answer.structuredContent as Record<string, any>, text: JSON.stringify(answer) };
  };
  const mapbox = (path: string) => requests.filter((r) => r.url.host === "api.mapbox.com" && r.url.pathname.startsWith(path));
  return { mcp, call, requests, mapbox, logged, searched, stop: async () => { await mcp.close(); await server.close(); } };
}
const scenario = (id: string) => BATH_ROUTE_SCENARIOS.find((s) => s.id === id)!.args as unknown as Record<string, unknown>;

test("commute and viewing tools are listed read-only only when a Mapbox token is configured", async () => {
  const without = await start();
  const withToken = await start({}, { mapboxToken: "pk.listed" });
  try {
    assert.equal((await without.mcp.listTools()).tools.some((t) => ["commute_filter", "plan_viewings"].includes(t.name)), false);
    assert.doesNotMatch(without.mcp.getInstructions() ?? "", /commute_filter/);
    const tools = (await withToken.mcp.listTools()).tools;
    assert.deepEqual(tools.map((t) => t.name), [...HOME_TOOLS, ...HOME_ROUTE_TOOLS].map((t) => t.name));
    for (const name of ["commute_filter", "plan_viewings"]) {
      const tool = tools.find((t) => t.name === name)!;
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, name);
      if (name === "plan_viewings") {
        assert.equal(tool._meta?.["openai/widgetAccessible"], true);
        assert.deepEqual(tool._meta?.["ui"], { visibility: ["model", "app"] });
      } else assert.equal(tool._meta?.["ui"], undefined, `${name} is not called by the widget`);
    }
    const commute = tools.find((t) => t.name === "commute_filter")!.inputSchema.properties as Record<string, any>;
    assert.deepEqual(commute["mode"].enum, ["walk", "cycle", "drive"]);
    assert.equal(commute["minutes"].maximum, 60);
    assert.equal((tools.find((t) => t.name === "plan_viewings")!.inputSchema.properties as Record<string, any>)["listing_ids"].maxItems, 6);
    assert.match(withToken.mcp.getInstructions() ?? "", /commute_filter.*plan_viewings/);
  } finally { await without.stop(); await withToken.stop(); }
});

test("commute_filter walks 15 minutes from Bath Spa station and splits the homes by the Mapbox outline", async () => {
  const app = await routeApp();
  try {
    const { isError, body, text } = await app.call("commute_filter", scenario("walk-bath-spa"));
    assert.equal(isError, false, text);
    assert.equal(body["place"].name, "Bath Spa");
    assert.match(body["place"].address, /BA1 1SU/);
    assert.equal(body["summary"], "1 of 6 homes within 15 minutes' walk of Bath Spa.");
    assert.deepEqual(body["homes_inside"].map((h: any) => h.listing_id), [BATH_HOMES.hallFloor]);
    assert.deepEqual(body["homes_outside"].map((h: any) => h.listing_id), [BATH_HOMES.paragon, BATH_HOMES.oldfieldPark, BATH_HOMES.twerton, BATH_HOMES.upperWeston, BATH_HOMES.peasedown]);
    assert.equal(body["homes_outside"].find((h: any) => h.listing_id === BATH_HOMES.oldfieldPark).near_edge, true, "a home within the simplification margin is borderline");
    assert.equal(body["homes_outside"].find((h: any) => h.listing_id === BATH_HOMES.paragon).address, "The Paragon, Walcot, Bath");
    assert.equal(body["reachable_area"].geometry.type, "Polygon");
    assert.ok(body["reachable_area"].geometry.coordinates[0].length < 500);
    assert.match(body["note"], /not a timetable/);
    // The station category is tried as said, then without the word "station".
    const searches = app.mapbox("/search/searchbox/");
    assert.deepEqual(searches.map((r) => r.url.searchParams.get("q")), ["Bath Spa station", "Bath Spa"]);
    assert.ok(searches.every((r) => r.url.searchParams.get("poi_category")?.includes("railway_station") && r.url.searchParams.get("proximity")));
    const [isochrone] = app.mapbox("/isochrone/");
    assert.equal(isochrone!.url.pathname, "/isochrone/v1/mapbox/walking/-2.35698,51.37776");
    assert.equal(isochrone!.url.searchParams.get("contours_minutes"), "15");
    assert.equal(isochrone!.headers["Referer"], "https://mcp.home.co.uk/");
    assert.doesNotMatch(text, /pk\.|access_token/);
    assert.ok(app.requests.filter((r) => r.url.host !== "api.mapbox.com").every((r) => !r.url.searchParams.has("access_token")), "the token only goes to Mapbox");
  } finally { await app.stop(); }
});

test("commute_filter drives from a school and gives the area alone for a postcode by bike", async () => {
  const app = await routeApp();
  try {
    const drive = await app.call("commute_filter", scenario("drive-school"));
    assert.equal(drive.isError, false, drive.text);
    assert.equal(drive.body["place"].name, "King Edward's School");
    assert.deepEqual(drive.body["homes_inside"].map((h: any) => h.listing_id), [BATH_HOMES.paragon]);
    assert.match(drive.body["note"], /without traffic/);
    assert.equal(app.mapbox("/isochrone/")[0]!.url.pathname.split("/")[4], "driving");

    const cycle = await app.call("commute_filter", scenario("cycle-postcode-area-only"));
    assert.equal(cycle.isError, false, cycle.text);
    assert.equal(cycle.body["place"].type, "postcode");
    assert.equal("homes_inside" in cycle.body, false);
    assert.equal(cycle.body["reachable_area"].properties.mode, "cycle");
    assert.equal(app.mapbox("/search/searchbox/").at(-1)!.url.searchParams.get("types"), "postcode");
  } finally { await app.stop(); }
});

test("plan_viewings from a start point tries each home last and returns the quickest order, legs, total and route", async () => {
  const app = await routeApp();
  try {
    const { isError, body, text } = await app.call("plan_viewings", scenario("viewings-from-postcode"));
    assert.equal(isError, false, text);
    assert.equal(body["start"].name, "BA1 1SU");
    assert.deepEqual(body["stops"].map((s: any) => s.listing_id), [BATH_HOMES.oldfieldPark, BATH_HOMES.avondaleRoad, BATH_HOMES.paragon, BATH_HOMES.kensingtonPlace]);
    assert.deepEqual(body["stops"].map((s: any) => s.drive_from_previous_minutes), [4, 10, 10, 4]);
    assert.deepEqual(body["stops"].map((s: any) => s.driving_minutes_so_far), [4, 14, 24, 28]);
    assert.equal(body["total_driving_minutes"], 28);
    assert.equal(body["total_km"], 8.4);
    assert.equal(body["route"].type, "LineString");
    const trips = app.mapbox("/optimized-trips/");
    assert.equal(trips.length, 4, "one optimisation per candidate last stop");
    assert.ok(trips.every((r) => r.url.searchParams.get("roundtrip") === "false" && r.url.searchParams.get("source") === "first" && r.url.searchParams.get("destination") === "last"));
    assert.match(body["note"], /without live traffic/);
  } finally { await app.stop(); }
});

test("plan_viewings without a start opens the quickest loop at its longest leg", async () => {
  const app = await routeApp();
  try {
    const { isError, body, text } = await app.call("plan_viewings", scenario("viewings-no-start"));
    assert.equal(isError, false, text);
    assert.equal(body["start"], null);
    assert.deepEqual(body["stops"].map((s: any) => s.listing_id), [BATH_HOMES.kensingtonPlace, BATH_HOMES.paragon, BATH_HOMES.oldfieldPark, BATH_HOMES.avondaleRoad, BATH_HOMES.upperWeston]);
    assert.equal(body["stops"][0].drive_from_previous_minutes, undefined);
    assert.equal(body["stops"][0].driving_minutes_so_far, 0);
    assert.equal(body["total_driving_minutes"], body["stops"].at(-1).driving_minutes_so_far);
    const trips = app.mapbox("/optimized-trips/");
    assert.deepEqual(trips.map((r) => r.url.searchParams.get("roundtrip")), ["true", "false"]);
    assert.equal(app.mapbox("/search/").length, 0, "no start, no place search");
  } finally { await app.stop(); }
});

test("commute_filter and plan_viewings return exactly search_homes' public address and postcode for every home", async () => {
  const app = await routeApp();
  try {
    const searched = new Map((app.searched!["homes"] as Array<Record<string, unknown>>).map((home) => [home["id"], home]));
    const commute = await app.call("commute_filter", scenario("walk-bath-spa"));
    const viewings = await app.call("plan_viewings", scenario("viewings-from-postcode"));
    assert.equal(commute.isError, false, commute.text);
    assert.equal(viewings.isError, false, viewings.text);
    const returned = [...commute.body["homes_inside"], ...commute.body["homes_outside"], ...viewings.body["stops"]];
    for (const home of returned) {
      const publicHome = searched.get(home.listing_id)!;
      assert.ok(home.address, `${home.listing_id} has a non-empty public address`);
      assert.equal(home.address, publicHome["address"], `${home.listing_id} address`);
      assert.equal(home.postcode, publicHome["postcode"], `${home.listing_id} postcode`);
    }
  } finally { await app.stop(); }
});

test("route tools tell the agent to search again when a valid listing has no remembered public address", async () => {
  const app = await routeApp([], false);
  try {
    const commute = await app.call("commute_filter", {
      place: "Bath Spa station", place_kind: "station", minutes: 15, mode: "walk", listing_ids: [BATH_HOMES.paragon],
    });
    const viewings = await app.call("plan_viewings", { listing_ids: [BATH_HOMES.paragon, BATH_HOMES.peasedown] });
    assert.equal(commute.isError, false, commute.text);
    assert.equal(viewings.isError, true, viewings.text);
    for (const answer of [commute, viewings]) {
      assert.match(answer.text, /Run search_homes again before using route tools/);
      assert.doesNotMatch(answer.text, /not found|26 The Paragon|12 Heritage Close/i);
    }
    assert.deepEqual(commute.body["homes_not_checked"], [{
      listing_id: BATH_HOMES.paragon,
      reason: `Home ${BATH_HOMES.paragon} has no remembered public display address. Run search_homes again before using route tools.`,
    }]);
  } finally { await app.stop(); }
});

test("commute and viewing arguments are checked before any request, with errors that say what to send", async () => {
  const app = await routeApp();
  const ids = Object.values(BATH_HOMES);
  try {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ["commute_filter", { minutes: 15, mode: "walk" }, /place is required/],
      ["commute_filter", { place: "Bath Spa station", minutes: 15, mode: "run" }, /mode must be walk, cycle or drive/],
      ["commute_filter", { place: "Bath Spa station", minutes: 61, mode: "walk" }, /minutes must be a whole number from 1 to 60/],
      ["commute_filter", { place: "Bath Spa station", minutes: 7.5, mode: "walk" }, /whole number/],
      ["commute_filter", { place: "Bath Spa station", place_kind: "pub", minutes: 15, mode: "walk" }, /place_kind must be one of station, school, office, postcode, address/],
      ["commute_filter", { place: "BA1", place_kind: "postcode", minutes: 15, mode: "walk" }, /BA1 is not a full UK postcode/],
      ["commute_filter", { place: "Bath Spa station", minutes: 15, mode: "walk", listing_ids: ["12"] }, /12 is not a listing UUID/],
      ["commute_filter", { place: "Bath Spa station", minutes: 15, mode: "walk", listing_ids: [...ids, ...ids, ...ids] }, /up to|1 to 20/],
      ["plan_viewings", { listing_ids: [ids[0]] }, /two|2 to 6/],
      ["plan_viewings", { listing_ids: ids.slice(0, 7) }, /2 to 6/],
      ["plan_viewings", { listing_ids: [ids[0], ids[0].toUpperCase()] }, /the same home twice/],
      ["plan_viewings", { listing_ids: ids.slice(0, 2), start: "  " }, /start must be a place/],
      ["commute_filter", { place: "the station", place_kind: "station", minutes: 15, mode: "walk" }, /"the station" does not say which place; name it with its town/],
    ];
    for (const [tool, args, message] of cases) {
      const { isError, body } = await app.call(tool, args);
      assert.equal(isError, true, JSON.stringify(args));
      assert.equal(body["error"], "invalid_request");
      assert.match(body["detail"], message, JSON.stringify(args));
    }
    assert.equal(app.mapbox("/").length, 0, "nothing reached Mapbox");
  } finally { await app.stop(); }
});

test("Mapbox's no-place, no-road and no-route answers are plain errors; refusals and outages are the neutral gap, logged without the token", async () => {
  const empty = { status: 200, body: { type: "FeatureCollection", features: [] } };
  const nowhere = await routeApp([[(u) => u.pathname.includes("/searchbox/"), empty]]);
  const noRoad = await routeApp([[(u) => u.pathname.includes("/isochrone/"), { status: 200, body: { code: "NoSegment", message: "Could not find a matching segment for input coordinates" } }]]);
  const noTrip = await routeApp([[(u) => u.pathname.includes("/optimized-trips/"), { status: 200, body: { code: "NoTrips", message: "Could not find a trip using all coordinates", trips: [] } }]]);
  const refused = await routeApp([[(u) => u.host === "api.mapbox.com", { status: 401, body: { message: "Not Authorized - Invalid Token" } }]]);
  const limited = await routeApp([[(u) => u.pathname.includes("/optimized-trips/"), { status: 429, body: { message: "Too Many Requests" } }]]);
  const down = await routeApp([[(u) => u.pathname.includes("/isochrone/"), "network"]]);
  const garbled = await routeApp([[(u) => u.pathname.includes("/optimized-trips/"), { status: 200, body: { code: "Ok", trips: [{}], waypoints: [] } }]]);
  try {
    let answer = await nowhere.call("commute_filter", scenario("walk-bath-spa"));
    assert.equal(answer.body["error"], "invalid_request");
    assert.match(answer.body["detail"], /Mapbox found no place in the UK matching "Bath Spa station"; add the town/);
    assert.equal(nowhere.mapbox("/search/").length, 3, "category, bare category, then open search");
    answer = await noRoad.call("commute_filter", scenario("walk-bath-spa"));
    assert.match(answer.body["detail"], /no road or path near Bath Spa/);
    answer = await noTrip.call("plan_viewings", scenario("viewings-no-start"));
    assert.match(answer.body["detail"], /no driving route that reaches every home/);
    for (const [app, tool, id] of [[refused, "commute_filter", "walk-bath-spa"], [limited, "plan_viewings", "viewings-from-postcode"], [down, "commute_filter", "cycle-postcode-area-only"], [garbled, "plan_viewings", "viewings-no-start"]] as const) {
      answer = await app.call(tool, scenario(id));
      assert.equal(answer.isError, true, id);
      assert.deepEqual(answer.body, { available: false, reason: "Not available right now." }, id);
      assert.ok(app.logged.some((line) => /Home Mapbox/.test(line)), `${id} is logged`);
      for (const line of app.logged) assert.doesNotMatch(line, /pk\.|access_token|-?2\.3\d{3}/, "logs carry no token or coordinates");
    }
  } finally { for (const app of [nowhere, noRoad, noTrip, refused, limited, down, garbled]) await app.stop(); }
});

test("a home with no map position is skipped by commute_filter and refused by plan_viewings", async () => {
  const missing = (id: string): RouteOverride => [(u) => u.pathname === `/api/property-details/${id}`, { status: 200, body: { id, latitude: null, longitude: null } }];
  const gone = (id: string): RouteOverride => [(u) => u.pathname === `/api/property-details/${id}`, { status: 200, body: [] }];
  const app = await routeApp([missing(BATH_HOMES.twerton), gone(BATH_HOMES.peasedown), missing(BATH_HOMES.avondaleRoad)]);
  try {
    const commute = await app.call("commute_filter", scenario("walk-bath-spa"));
    assert.equal(commute.isError, false, commute.text);
    assert.equal(commute.body["summary"], "1 of 4 homes within 15 minutes' walk of Bath Spa.");
    assert.deepEqual(commute.body["homes_not_checked"], [
      { listing_id: BATH_HOMES.twerton, reason: "The listing publishes no map position." },
      { listing_id: BATH_HOMES.peasedown, reason: "This home was not found on home.co.uk." },
    ]);
    const plan = await app.call("plan_viewings", scenario("viewings-from-postcode"));
    assert.equal(plan.body["error"], "invalid_request");
    assert.match(plan.body["detail"], new RegExp(`Home ${BATH_HOMES.avondaleRoad} publishes no map position`));
    assert.equal(app.mapbox("/optimized-trips/").length, 0);
  } finally { await app.stop(); }
});

test("the area test honours holes and multipolygons, and the edge distance is in metres", () => {
  const square = (x: number, y: number, size: number) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
  const withHole = { type: "Polygon", coordinates: [square(-2.4, 51.3, 0.1), square(-2.37, 51.33, 0.02)] };
  assert.equal(insideArea([-2.39, 51.31], withHole), true);
  assert.equal(insideArea([-2.36, 51.34], withHole), false, "inside the hole");
  assert.equal(insideArea([-2.2, 51.31], withHole), false);
  const two = { type: "MultiPolygon", coordinates: [[square(-2.4, 51.3, 0.01)], [square(-2.3, 51.3, 0.01)]] };
  assert.equal(insideArea([-2.295, 51.305], two), true);
  assert.equal(insideArea([-2.35, 51.305], two), false);
  assert.equal(insideArea([0, 0], { type: "Point", coordinates: [0, 0] }), false);
  // 0.001 degrees of latitude is about 111 metres.
  const metres = metresToEdge([-2.395, 51.301], { type: "Polygon", coordinates: [square(-2.4, 51.3, 0.1)] });
  assert.ok(metres > 105 && metres < 115, String(metres));
});

test("the Bath route recording holds no token and no listing text", () => {
  const raw = readFileSync(join(ROOT, "src/test/fixtures/home-routes.json"), "utf8");
  assert.doesNotMatch(raw, /pk\.|sk\.|access_token/);
  for (const [key, answer] of Object.entries(ROUTE_FIXTURE.responses)) {
    if (key.includes("/property-details/")) assert.deepEqual(Object.keys(answer.body as object).sort(), ["building_name", "building_number", "id", "latitude", "locality", "longitude", "postcode", "street_name", "town_name"]);
  }
});

test("a place answer counts only when it names the place asked for, and a postcode only when it is that postcode", async () => {
  const feature = (name: string, full_address: string, feature_type = "poi") => ({ type: "Feature", geometry: { type: "Point", coordinates: [1.2917, 52.62835] }, properties: { name, full_address, feature_type } });
  // Search Box's real answers on 2026-10-02: gibberish became a Norwich council office, an unknown postcode its neighbours.
  const app = await routeApp([
    [(u) => u.searchParams.get("q") === "zzqxv nowhere", { status: 200, body: { type: "FeatureCollection", features: [feature("Norwich City Council", "St Peters St, Norwich, NR2 1NH, United Kingdom")] } }],
    [(u) => u.searchParams.get("q") === "BA1 9ZZ", { status: 200, body: { type: "FeatureCollection", features: [feature("BA1", "", "postcode"), feature("GU2 9ZZ", "", "postcode")] } }],
  ]);
  try {
    let answer = await app.call("commute_filter", { place: "zzqxv nowhere", minutes: 10, mode: "walk" });
    assert.match(answer.body["detail"], /Mapbox found no place in the UK matching "zzqxv nowhere"/);
    answer = await app.call("plan_viewings", { listing_ids: [BATH_HOMES.paragon, BATH_HOMES.hallFloor], start: "BA1 9ZZ" });
    assert.match(answer.body["detail"], /Mapbox does not know the postcode BA1 9ZZ/);
    assert.equal(app.mapbox("/optimized-trips/").length, 0);
  } finally { await app.stop(); }
  assert.equal(namesPlace("Dyson, Malmesbury", { name: "Dyson Office", where: "Tetbury Hill Malmesbury, SN16 0RP" }), true);
  assert.equal(namesPlace("King Edward's School, Bath", { name: "King Edward’s School", where: "North Rd Bath, BA2 6HX" }), true);
  assert.equal(namesPlace("Bath Spa station", { name: "Green Park Station", where: "Bristol" }), false, "a shared kind word is not a match");
});

test("a place in the right town and category but with another name is never taken for the one asked", async () => {
  const at = (name: string, place: string, categories: string[], lng: number, street?: string) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [lng, 51.38] },
    properties: { name, feature_type: "poi", place_formatted: `${place}, United Kingdom`, full_address: `${street ?? ""} ${place}`.trim(), poi_category_ids: categories,
      context: { place: { name: place }, country: { name: "United Kingdom" }, ...(street ? { street: { name: street } } : {}) } },
  });
  const answers = (features: unknown[]) => ({ status: 200, body: { type: "FeatureCollection", features } });
  const theatre = at("Bath Theatre School", "Bath", ["education", "school"], -2.351);
  const guitar = at("Bath Guitar School", "Bath", ["education", "school"], -2.352);
  const kingEdwards = at("King Edward's School", "Bath", ["education", "school"], -2.34238, "North Rd");
  // Only the place chosen matters here, so any recorded outline will do.
  const outline = Object.entries(ROUTE_FIXTURE.responses).find(([key]) => key.includes("/isochrone/"))![1];
  const app = await routeApp([
    [(u) => u.pathname.includes("/isochrone/"), outline],
    // Same category and town listed first, the school asked for third.
    [(u) => u.searchParams.get("q") === "King Edward's School, Bath", answers([theatre, guitar, kingEdwards])],
    [(u) => u.searchParams.get("q") === "Prior Park School, Bath", answers([theatre, guitar])],
    [(u) => u.searchParams.get("q") === "Prior Park, Bath", answers([theatre])],
    [(u) => u.searchParams.get("q") === "Dyson, Malmesbury", answers([at("Malmesbury Abbey Office", "Malmesbury", ["office"], -2.098), at("Dyson Office", "Malmesbury", ["office"], -2.10565, "Tetbury Hill")])],
    // Search Box's own order on 2026-10-02: the luggage shop beside Bath Spa station before the station.
    [(u) => u.searchParams.get("q") === "Bath Spa station" && u.searchParams.get("limit") === "5", answers([at("Bounce Luggage Storage - Bath Spa Station", "Bath", ["services"], -2.35724, "Manvers St"), at("Bath Spa", "Bath", ["public_transportation_station"], -2.35698)])],
    // Bus stops named after a road carry the transport-station category.
    [(u) => u.searchParams.get("q") === "Station Road, Bath", answers([at("Bath Road", "Bridgwater", ["public_transportation_station"], -3.0), at("Station Road", "Bath", [], -2.388, "Station Road")])],
  ]);
  try {
    const school = await app.call("commute_filter", { place: "King Edward's School, Bath", place_kind: "school", minutes: 10, mode: "drive" });
    assert.equal(school.body["place"].name, "King Edward's School");
    assert.equal(school.body["place"].coordinates.longitude, -2.34238);
    const unknown = await app.call("commute_filter", { place: "Prior Park School, Bath", place_kind: "school", minutes: 10, mode: "drive" });
    assert.match(unknown.body["detail"], /no place in the UK matching "Prior Park School, Bath"/, "two Bath schools are not Prior Park");
    const office = await app.call("commute_filter", { place: "Dyson, Malmesbury", place_kind: "office", minutes: 30, mode: "drive" });
    assert.equal(office.body["place"].name, "Dyson Office");
    const station = await app.call("commute_filter", { place: "Bath Spa station", minutes: 15, mode: "walk" });
    assert.equal(station.body["place"].name, "Bath Spa", "the closest name wins over Mapbox's first answer");
    const road = await app.call("commute_filter", { place: "Station Road, Bath", minutes: 15, mode: "walk" });
    assert.equal(road.body["place"].name, "Station Road");
    assert.equal(app.mapbox("/search/").filter((r) => r.url.searchParams.get("q") === "Station Road, Bath").every((r) => !r.url.searchParams.has("poi_category")), true, "a road named Station is not searched as a station");
  } finally { await app.stop(); }
  // Town words qualify; they never name the place.
  assert.equal(namesPlace("King Edward's School, Bath", { name: "Bath Theatre School", where: "Alexandra Park Bath, BA2 4LL" }), false);
  assert.equal(namesPlace("Bath", { name: "Bath", where: "Bath and North East Somerset England" }), true);
  assert.equal(namesPlace("26 The Paragon, Bath", { name: "26 The Paragon", where: "26 The Paragon The Paragon Bath BA1 5LY Walcot" }), true);
  assert.equal(namesPlace("26 The Paragon, Bath", { name: "26 The Paragon", where: "26 The Paragon The Paragon Bristol BS8 4LA Hotwells" }), false, "the same address in another town");
  assert.equal(namesPlace("Bath Spa station", { name: "Bath Spa", where: "Bath BA1 1SU", categories: ["public_transportation_station"] }, "station"), true);
  assert.equal(namesPlace("Station Road, Bath", { name: "Bath Road", where: "Bridgwater TA6 4PP", categories: ["public_transportation_station"] }), false, "a category backs a kind word only in a search for that kind");
  assert.equal(namesPlace("Bath Spa station", { name: "Thermae Bath Spa", where: "Bath BA1 1SJ", categories: ["spa"] }), false, "a station must be a station");
  assert.equal(extraWords("Bath Spa station", "Bounce Luggage Storage - Bath Spa Station"), 3);
});

test("plan_viewings gives the same quickest order whatever order the homes are listed in", async () => {
  const app = await routeApp();
  try {
    for (const [first, second] of [["viewings-from-postcode", "viewings-from-postcode-reordered"], ["viewings-no-start", "viewings-no-start-reordered"]]) {
      const a = await app.call("plan_viewings", scenario(first)); const b = await app.call("plan_viewings", scenario(second));
      assert.equal(b.isError, false, b.text);
      assert.deepEqual(b.body["stops"].map((s: any) => s.listing_id), a.body["stops"].map((s: any) => s.listing_id), second);
      assert.equal(b.body["total_driving_minutes"], a.body["total_driving_minutes"], second);
    }
  } finally { await app.stop(); }
});
