import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { HomedataClient } from "../dist/client.js";
import { HomeClient } from "../dist/home/client.js";
import { MapboxRoutes } from "../dist/home/routes.js";
import { matchWishes } from "../dist/home/wishes.js";
import { HOME_WIDGET_HTML } from "../dist/home/widget.js";

const root = resolve(import.meta.dirname, "..");
const credentialsPath = process.env.HOME_MAPBOX_CREDENTIALS;
const credentials = credentialsPath ? JSON.parse(await readFile(credentialsPath, "utf8")) : {};
const token = process.env.HOME_MAPBOX_TOKEN ?? credentials.token;
if (typeof token !== "string" || !token.startsWith("pk.")) {
  throw new Error("Set HOME_MAPBOX_TOKEN to a public Mapbox token, or HOME_MAPBOX_CREDENTIALS to a JSON file containing {\"token\":\"pk.…\"}");
}
const chromePath = process.env.CHROME_PATH;
if (!chromePath) throw new Error("Set CHROME_PATH to a Chrome or Chromium executable");

const homeClient = new HomeClient({ homedata: new HomedataClient({ apiKey: "unused" }) });
const search = await homeClient.search({ location: "Bath", listing_type: "sale" });
const homes = await Promise.all(search.homes.slice(0, 8).map(async (home) => {
  const id = String(home.id ?? "");
  if (!id) return home;
  try {
    const detail = await fetch(`https://home.co.uk/api/property-details/${encodeURIComponent(id)}`).then((response) => response.ok ? response.json() : null);
    const matches = matchWishes(detail?.description, ["garden"]);
    return matches.length ? { ...home, wishes_matched: matches } : home;
  } catch {
    return home;
  }
}));
const routes = new MapboxRoutes({ token, referer: "https://mcp.home.co.uk/" });
const routeIds = homes.map((home) => home.id).filter(Boolean).slice(0, 4);
const [commute, route] = await Promise.all([
  routes.commute(homeClient, { place: "Bath Spa station", place_kind: "station", minutes: 15, mode: "walk", listing_ids: homes.map((home) => home.id).filter(Boolean) }),
  routes.viewings(homeClient, { listing_ids: routeIds, start: "BA1 1SU" }),
]);

const mapboxRoot = pathToFileURL(resolve(root, "node_modules/mapbox-gl/dist/")).href;
const assets = `<link rel="stylesheet" href="${mapboxRoot}mapbox-gl.css"><script id="home-mapbox" src="${mapboxRoot}mapbox-gl.js"></script>`;
const html = HOME_WIDGET_HTML
  .replace("__HOME_MAPBOX_ASSETS__", assets)
  .replace("__HOME_MAPBOX_TOKEN__", JSON.stringify(token));
const temporary = join(tmpdir(), `home-widget-${process.pid}.html`);
await writeFile(temporary, html);

const browser = await chromium.launch({
  executablePath: chromePath,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--allow-file-access-from-files"],
});
try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 982 }, deviceScaleFactor: 1 });
    await page.addInitScript(({ theme, homes, commute, route }) => {
      window.openai = {
        theme,
        widgetState: { shortlist: homes.slice(0, 2).map((home) => home.id) },
        toolOutput: { view: "listings", title: "Bath homes and viewing day", homes, commute, route },
        setWidgetState: () => undefined,
      };
    }, { theme, homes, commute, route });
    await page.goto(pathToFileURL(temporary).href);
    await page.waitForTimeout(9_000);
    await page.screenshot({ path: resolve(root, `docs/home-chatgpt-app/screenshots/listings-${theme}.jpg`), type: "jpeg", quality: 92 });
    await page.close();
  }
} finally {
  await browser.close();
  await rm(temporary, { force: true });
}
