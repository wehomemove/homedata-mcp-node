/**
 * Submission screenshots of the Home widget from live data, light and dark:
 *
 *   npm run build
 *   HOME_MAPBOX_CREDENTIALS=… CHROME_PATH=… node scripts/home-widget-screenshots.mjs [Home MCP endpoint URL]
 *
 * The data comes from the Home endpoint itself (https://mcp.home.co.uk/mcp by
 * default): search_homes for three-bedroom homes for sale in Bath with a
 * garden, render_home_listings and render_home_detail for the widget's own
 * tool output, get_home for the first result, and plan_viewings for the
 * map's viewing route. Nothing is sample data.
 * Writes listings, map, detail and shortlist shots, each -light and -dark, to
 * docs/home-chatgpt-app/screenshots/.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { HOME_WIDGET_CSS, HOME_WIDGET_HTML, HOME_WIDGET_SCRIPT } from "../dist/home/widget.js";
import { HOME_WIDGET_CSS_PATH, HOME_WIDGET_SCRIPT_PATH } from "../dist/home/widget-assets.js";

const root = resolve(import.meta.dirname, "..");
const out = (name) => resolve(root, "docs/home-chatgpt-app/screenshots", name);
const endpoint = process.argv[2] ?? "https://mcp.home.co.uk/mcp";
const credentialsPath = process.env.HOME_MAPBOX_CREDENTIALS;
const credentials = credentialsPath ? JSON.parse(await readFile(credentialsPath, "utf8")) : {};
const token = process.env.HOME_MAPBOX_TOKEN ?? credentials.token;
if (typeof token !== "string" || !token.startsWith("pk.")) {
  throw new Error("Set HOME_MAPBOX_TOKEN to a public Mapbox token, or HOME_MAPBOX_CREDENTIALS to a JSON file containing {\"token\":\"pk.…\"}");
}
const chromePath = process.env.CHROME_PATH;
if (!chromePath) throw new Error("Set CHROME_PATH to a Chrome or Chromium executable");

let rpcId = 0;
async function call(name, args) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.result || body.result.isError) throw new Error(`${name}: HTTP ${response.status} ${JSON.stringify(body?.result?.structuredContent ?? body).slice(0, 200)}`);
  return body.result.structuredContent;
}

const search = await call("search_homes", { location: "Bath", listing_type: "sale", min_beds: 3, max_price: 600000, wishes: ["garden"] });
// Homes whose listing states the wish come first; show those with photos.
const homes = search.homes.filter((h) => h.image && h.coordinates).slice(0, 8);
if (homes.length < 4) throw new Error(`only ${homes.length} homes with photos came back`);
const listings = await call("render_home_listings", { title: "Three-bedroom homes for sale in Bath with a garden", homes });
const detail = await call("render_home_detail", { home: await call("get_home", { listing_id: homes[0].id }) });
const shortlist = homes.slice(0, 3).map((h) => h.id);
const [commute, route] = await Promise.all([
  call("commute_filter", { listing_ids: homes.map((h) => h.id), place: "Bath Spa station", place_kind: "station", minutes: 20, mode: "drive" }),
  call("plan_viewings", { listing_ids: homes.slice(0, 4).map((h) => h.id), start: "Bath Spa station", start_kind: "station" }),
]);
const commuting = { ...listings, commute };
const routed = { ...listings, route };
console.log(`live data: ${search.total} homes, ${search.homes_matching_every_wish} stating a garden on page 1; detail ${detail.home.address}`);

const mapboxRoot = `${pathToFileURL(resolve(root, "node_modules/mapbox-gl/dist")).href}/`;
const assets = `<link rel="stylesheet" href="${mapboxRoot}mapbox-gl.css"><script id="home-mapbox" src="${mapboxRoot}mapbox-gl.js"></script>`;
const temporaryDir = await mkdtemp(join(tmpdir(), "home-widget-"));
const scriptUrl = pathToFileURL(join(temporaryDir, "widget.js")).href;
const cssUrl = pathToFileURL(join(temporaryDir, "widget.css")).href;
const html = HOME_WIDGET_HTML
  .replace("__HOME_MAPBOX_ASSETS__", assets)
  .replace("__HOME_ASSET_ORIGIN____HOME_CSS_PATH__", cssUrl)
  .replace("__HOME_ASSET_ORIGIN____HOME_SCRIPT_PATH__", scriptUrl)
  .replace(/ integrity="__HOME_(?:CSS|SCRIPT)_INTEGRITY__"/g, "")
  .replaceAll("__HOME_CHECK_IN_ORIGIN__", "")
  .replaceAll("__HOME_CHECK_IN_HOST__", "")
  .replaceAll("__HOME_VIEW_ID__", "")
  .replace("__HOME_MAPBOX_TOKEN__", token);
const temporary = join(temporaryDir, "index.html");
await Promise.all([writeFile(temporary, html), writeFile(join(temporaryDir, "widget.js"), HOME_WIDGET_SCRIPT), writeFile(join(temporaryDir, "widget.css"), HOME_WIDGET_CSS)]);

const browser = await chromium.launch({
  executablePath: chromePath,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--allow-file-access-from-files"],
});

/** Open the widget as a host would, with this tool output and saved shortlist. */
async function open(theme, toolOutput, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  page.on("console", (message) => { if (message.type() === "error") console.error(`widget (${theme}): ${message.text().slice(0, 300)}`); });
  await page.addInitScript(({ theme, toolOutput, shortlist }) => {
    window.openai = { theme, toolOutput, widgetState: { shortlist }, setWidgetState: () => undefined, callTool: () => new Promise(() => undefined) };
  }, { theme, toolOutput, shortlist });
  await page.goto(pathToFileURL(temporary).href);
  // Mapbox tiles and listing photos need real time to load; virtual time never fetches tiles.
  await page.waitForTimeout(9_000);
  return page;
}

const shot = async (target, name) => {
  await target.screenshot({ path: out(name), type: "jpeg", quality: 90 });
  console.log(`wrote docs/home-chatgpt-app/screenshots/${name}`);
};

try {
  for (const theme of ["light", "dark"]) {
    const plain = await open(theme, listings, { width: 1200, height: 900 });
    await shot(plain, `listings-${theme}.jpg`);
    await plain.close();

    const commutePage = await open(theme, commuting, { width: 1200, height: 982 });
    await shot(commutePage, `commute-${theme}.jpg`);
    await commutePage.close();

    const page = await open(theme, routed, { width: 1200, height: 982 });
    await shot(page, `route-${theme}.jpg`);

    // The whole route at its fitted zoom: stops are numbered pins, other homes hearts.
    const map = page.locator("[data-map]").first();
    await map.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2_000);
    await shot(map, `map-${theme}.jpg`);
    await page.close();

    const saved = await open(theme, listings, { width: 1200, height: 900 });
    await saved.click("[data-shortlist]");
    await saved.waitForTimeout(5_000);
    await shot(saved, `shortlist-${theme}.jpg`);
    await saved.close();

    const one = await open(theme, detail, { width: 430, height: 1300 });
    await shot(one, `detail-${theme}.jpg`);
    await one.close();
  }
} finally {
  await browser.close();
  await rm(temporaryDir, { force: true, recursive: true });
}
