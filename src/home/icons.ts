import { readFileSync } from "node:fs";

/**
 * Phosphor Icons (https://phosphoricons.com), MIT licence, © 2023 Phosphor Icons.
 * scripts/home-icons.mjs copies the exact SVGs out of @phosphor-icons/core into
 * dist/home/phosphor-icons.json at build time; this module only reads that file.
 */
export type HomeIcons = { package: string; version: string; license: string; assets: Record<string, string>; icons: Record<string, string> };

function load(): HomeIcons {
  try {
    return JSON.parse(readFileSync(new URL("./phosphor-icons.json", import.meta.url), "utf8")) as HomeIcons;
  } catch (error) {
    throw new Error(`Home widget icons missing: run \`npm run build\` (scripts/home-icons.mjs). ${(error as Error).message}`);
  }
}

export const HOME_ICONS = load();

/** The icon map as a script literal, safe inside an inline <script>. */
export const HOME_ICONS_SCRIPT = JSON.stringify(HOME_ICONS.icons).replace(/</g, "\\u003c");
