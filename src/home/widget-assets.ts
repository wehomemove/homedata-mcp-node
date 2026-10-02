import { createHash } from "node:crypto";

import { HOME_WIDGET_ASSET_PREFIX, HOME_WIDGET_CSS, HOME_WIDGET_SCRIPT } from "./widget.js";

export type HomeWidgetAsset = {
  body: Buffer;
  contentType: string;
  integrity: string;
};

function asset(body: string, contentType: string): HomeWidgetAsset {
  const bytes = Buffer.from(body);
  return {
    body: bytes,
    contentType,
    integrity: `sha384-${createHash("sha384").update(bytes).digest("base64")}`,
  };
}

export const HOME_WIDGET_ASSETS = new Map<string, HomeWidgetAsset>([
  [`${HOME_WIDGET_ASSET_PREFIX}/widget.js`, asset(HOME_WIDGET_SCRIPT, "text/javascript; charset=utf-8")],
  [`${HOME_WIDGET_ASSET_PREFIX}/widget.css`, asset(HOME_WIDGET_CSS, "text/css; charset=utf-8")],
]);

export function homeWidgetAssetValues(): { scriptIntegrity: string; cssIntegrity: string } {
  return {
    scriptIntegrity: HOME_WIDGET_ASSETS.get(`${HOME_WIDGET_ASSET_PREFIX}/widget.js`)!.integrity,
    cssIntegrity: HOME_WIDGET_ASSETS.get(`${HOME_WIDGET_ASSET_PREFIX}/widget.css`)!.integrity,
  };
}
