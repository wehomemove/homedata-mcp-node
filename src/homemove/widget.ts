import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The Homemove quote widget. Its CSS, script and Homie art (copied from the
 * iOS app's Resources/Homies with the loop rig) are served by this endpoint
 * under a content-hashed prefix, so a new build never meets a stale cache.
 */
export const HOMEMOVE_WIDGET_VERSION = 1;
export const HOMEMOVE_WIDGET_URI = `ui://homemove/quote-v${HOMEMOVE_WIDGET_VERSION}.html`;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "widget");
const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".webp": "image/webp", ".png": "image/png", ".ttf": "font/ttf",
};

export interface WidgetAsset { body: Buffer; contentType: string }

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function load(): { prefix: string; assets: Map<string, WidgetAsset> } {
  const files = walk(ROOT).filter((path) => TYPES[extname(path)]).sort();
  const hash = createHash("sha256");
  for (const file of files) hash.update(relative(ROOT, file)).update("\0").update(readFileSync(file));
  const prefix = `/assets/homemove/v${HOMEMOVE_WIDGET_VERSION}/${hash.digest("hex").slice(0, 16)}`;
  const assets = new Map<string, WidgetAsset>();
  for (const file of files) assets.set(`${prefix}/${relative(ROOT, file).split("\\").join("/")}`, { body: readFileSync(file), contentType: TYPES[extname(file)]! });
  return { prefix, assets };
}

const loaded = load();
export const HOMEMOVE_ASSET_PREFIX = loaded.prefix;
export const HOMEMOVE_WIDGET_ASSETS: ReadonlyMap<string, WidgetAsset> = loaded.assets;

const attr = (value: string) => value.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);

/** Async script: ChatGPT's desktop sandbox never reaches DOMContentLoaded behind a parser-blocking one. */
export function homemoveWidgetHtml(origin: string): string {
  const base = `${origin}${HOMEMOVE_ASSET_PREFIX}/`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<link rel="stylesheet" href="${attr(base)}quote.css"></head><body><div id="app" data-base="${attr(base)}"></div>` +
    `<script async src="${attr(base)}quote.js"></script></body></html>`;
}
