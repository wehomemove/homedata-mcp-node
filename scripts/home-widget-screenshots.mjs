import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { trimCard } from "../dist/home/client.js";
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

const search = await fetch("https://home.co.uk/api/for-sale/Bath/?page=1&per_page=8").then((response) => {
  if (!response.ok) throw new Error(`Home search returned ${response.status}`);
  return response.json();
});
const properties = Array.isArray(search.properties) ? search.properties.slice(0, 8) : [];
const homes = await Promise.all(properties.map(async (property) => {
  const home = trimCard(property);
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
    await page.addInitScript(({ theme, homes }) => {
      window.openai = {
        theme,
        widgetState: { shortlist: homes.slice(0, 2).map((home) => home.id) },
        toolOutput: { view: "listings", title: "Homes for sale in Bath", homes },
        setWidgetState: () => undefined,
      };
    }, { theme, homes });
    await page.goto(pathToFileURL(temporary).href);
    await page.waitForTimeout(9_000);
    await page.screenshot({ path: resolve(root, `docs/home-chatgpt-app/screenshots/listings-${theme}.jpg`), type: "jpeg", quality: 92 });
    await page.close();
  }
} finally {
  await browser.close();
  await rm(temporary, { force: true });
}
