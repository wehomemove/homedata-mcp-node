import { createHash } from "node:crypto";

import { HOME_WIDGET_CSS, HOME_WIDGET_SCRIPT, HOME_WIDGET_VERSION } from "./widget.js";

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

const contentHash = createHash("sha256")
  .update(HOME_WIDGET_SCRIPT)
  .update("\0")
  .update(HOME_WIDGET_CSS)
  .digest("hex")
  .slice(0, 20);
export const HOME_WIDGET_ASSET_PREFIX = `/assets/home-widget/v${HOME_WIDGET_VERSION}/${contentHash}`;
export const HOME_WIDGET_SCRIPT_PATH = `${HOME_WIDGET_ASSET_PREFIX}/widget.js`;
export const HOME_WIDGET_CSS_PATH = `${HOME_WIDGET_ASSET_PREFIX}/widget.css`;

export const HOME_WIDGET_ASSETS = new Map<string, HomeWidgetAsset>([
  [HOME_WIDGET_SCRIPT_PATH, asset(HOME_WIDGET_SCRIPT, "text/javascript; charset=utf-8")],
  [HOME_WIDGET_CSS_PATH, asset(HOME_WIDGET_CSS, "text/css; charset=utf-8")],
]);

export function homeWidgetAssetValues(): { scriptPath: string; cssPath: string; scriptIntegrity: string; cssIntegrity: string } {
  return {
    scriptPath: HOME_WIDGET_SCRIPT_PATH,
    cssPath: HOME_WIDGET_CSS_PATH,
    scriptIntegrity: HOME_WIDGET_ASSETS.get(HOME_WIDGET_SCRIPT_PATH)!.integrity,
    cssIntegrity: HOME_WIDGET_ASSETS.get(HOME_WIDGET_CSS_PATH)!.integrity,
  };
}
