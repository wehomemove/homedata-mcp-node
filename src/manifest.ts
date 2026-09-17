/**
 * The vendored tool manifest.
 *
 * src/manifest/ is a copy of homedata_mcp/manifest/ from the Python package at
 * the commit recorded in SOURCE.json, fetched by scripts/vendor-manifest.mjs.
 * Do not edit these files here: change the Playground catalogue, regenerate the
 * manifest in the Python package, then re-vendor.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ToolParam {
  name: string;
  in: "path" | "query";
  type: "string" | "number";
  required: boolean;
  enum?: string[];
  pattern?: string;
  advanced?: boolean;
  alternative_to_previous?: boolean;
  paired_with?: string;
  playground_hint?: string;
}

export interface ToolTokens {
  default: number;
  plus_with_addons?: boolean;
  addons?: Record<string, number>;
  when?: Array<{ param: string; in: string[]; tokens: number }>;
}

export interface ToolSpec {
  name: string;
  playground_id: string;
  label: string;
  method: string;
  path: string;
  params: ToolParam[];
  tokens: ToolTokens;
  path_rules?: Array<{ param: string; prefix: string; path: string }>;
}

export interface StaticToolSpec {
  name: string;
  billable: boolean;
  http_requests: unknown[];
  params: Array<{ name: string; type: "string" | "number"; required: boolean }>;
  purpose: string;
}

export interface Manifest {
  schema_version: number;
  source: { repository: string; commit: string; catalogue: string };
  rules: Record<string, string>;
  tools: ToolSpec[];
  static_tools: StaticToolSpec[];
  excluded: Array<{ playground_id: string; reason: string; note?: string }>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): unknown => JSON.parse(readFileSync(join(HERE, "manifest", file), "utf8"));

export const MANIFEST = read("tools.json") as Manifest;
export const DESCRIPTIONS = read("descriptions.json") as Record<string, string>;
export const PARAM_DESCRIPTIONS = read("param_descriptions.json") as {
  defaults: Record<string, string>;
  tools: Record<string, string>;
};
export const SOURCE = read("SOURCE.json") as { repository: string; ref: string; files: Record<string, string> };

export const tools = (): ToolSpec[] => MANIFEST.tools;
export const staticTools = (): StaticToolSpec[] => MANIFEST.static_tools;
export const descriptionFor = (name: string): string => DESCRIPTIONS[name] ?? "";

/** Argument help for one tool: a per-tool entry wins over the shared default. */
export function paramTextFor(toolName: string): Record<string, string> {
  const spec = [...tools(), ...staticTools()].find((t) => t.name === toolName);
  const out: Record<string, string> = {};
  for (const param of (spec as ToolSpec | undefined)?.params ?? []) {
    const text = PARAM_DESCRIPTIONS.tools[`${toolName}.${param.name}`] ?? PARAM_DESCRIPTIONS.defaults[param.name];
    if (text) out[param.name] = text;
  }
  return out;
}
