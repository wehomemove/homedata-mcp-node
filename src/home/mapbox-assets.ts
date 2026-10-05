import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const MAPBOX_GL_VERSION = "3.15.0";
// r2 since 2026-10-05: a new address so a client that cached the first one
// fetches again. The first address is still served for pages already open.
export const MAPBOX_GL_ASSET_PREFIX = `/assets/mapbox-gl/v${MAPBOX_GL_VERSION}/r2`;
const LEGACY_MAPBOX_GL_ASSET_PREFIX = `/assets/mapbox-gl/v${MAPBOX_GL_VERSION}`;

export type MapboxAsset = {
  body: Buffer;
  contentType: string;
  integrity: string;
};

function asset(file: string, contentType: string): MapboxAsset {
  // This module is src/home in development and dist/home after compilation.
  // In both layouts the installed dependency is two directories above it.
  const body = readFileSync(new URL(`../../node_modules/mapbox-gl/dist/${file}`, import.meta.url));
  const integrity = `sha384-${createHash("sha384").update(body).digest("base64")}`;
  return { body, contentType, integrity };
}

const MAPBOX_GL_JS = asset("mapbox-gl.js", "text/javascript; charset=utf-8");
const MAPBOX_GL_CSS = asset("mapbox-gl.css", "text/css; charset=utf-8");

export const MAPBOX_GL_ASSETS = new Map<string, MapboxAsset>(
  [MAPBOX_GL_ASSET_PREFIX, LEGACY_MAPBOX_GL_ASSET_PREFIX].flatMap((prefix): [string, MapboxAsset][] => [
    [`${prefix}/mapbox-gl.js`, MAPBOX_GL_JS],
    [`${prefix}/mapbox-gl.css`, MAPBOX_GL_CSS],
  ]),
);

/**
 * ChatGPT's sandbox shows the widget only once its document reaches
 * DOMContentLoaded, so the map library is loaded async: a slow or stuck
 * 1.6 MB download must never hold the panel blank. The widget draws maps
 * whenever the library arrives.
 */
export function mapboxAssetTags(origin: string): string {
  const jsPath = `${MAPBOX_GL_ASSET_PREFIX}/mapbox-gl.js`;
  const cssPath = `${MAPBOX_GL_ASSET_PREFIX}/mapbox-gl.css`;
  const js = MAPBOX_GL_ASSETS.get(jsPath)!;
  const css = MAPBOX_GL_ASSETS.get(cssPath)!;
  return `<link href="${origin}${cssPath}" rel="stylesheet" integrity="${css.integrity}" crossorigin="anonymous"><script id="home-mapbox" async src="${origin}${jsPath}" integrity="${js.integrity}" crossorigin="anonymous"></script>`;
}
