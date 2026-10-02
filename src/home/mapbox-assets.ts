import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const MAPBOX_GL_VERSION = "3.15.0";
export const MAPBOX_GL_ASSET_PREFIX = `/assets/mapbox-gl/v${MAPBOX_GL_VERSION}`;

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

export const MAPBOX_GL_ASSETS = new Map<string, MapboxAsset>([
  [`${MAPBOX_GL_ASSET_PREFIX}/mapbox-gl.js`, asset("mapbox-gl.js", "text/javascript; charset=utf-8")],
  [`${MAPBOX_GL_ASSET_PREFIX}/mapbox-gl.css`, asset("mapbox-gl.css", "text/css; charset=utf-8")],
]);

export function mapboxAssetTags(origin: string): string {
  const jsPath = `${MAPBOX_GL_ASSET_PREFIX}/mapbox-gl.js`;
  const cssPath = `${MAPBOX_GL_ASSET_PREFIX}/mapbox-gl.css`;
  const js = MAPBOX_GL_ASSETS.get(jsPath)!;
  const css = MAPBOX_GL_ASSETS.get(cssPath)!;
  return `<link href="${origin}${cssPath}" rel="stylesheet" integrity="${css.integrity}" crossorigin="anonymous"><script id="home-mapbox" src="${origin}${jsPath}" integrity="${js.integrity}" crossorigin="anonymous"></script>`;
}
