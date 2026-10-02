/**
 * The ChatGPT plugin package: chatgpt-plugin/listing.json (hand-written listing
 * text) plus review cases taken from the golden prompt set, so the submitted
 * cases and the cases we test against can never disagree.
 *
 * validatePackage() holds the manifest to OpenAI's submission limits
 * (https://developers.openai.com/plugins/deploy/submission#manifest-fields) and
 * to the listing rules of the plugin being built (HOMEDATA_RULES by default; the
 * Home app passes its own). validateSkills() holds bundled skills to the tools
 * the endpoint really lists. Both run in npm test and before every ZIP.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { GoldenSet, ListedTool } from "./golden.js";

export interface Manifest {
  name: string;
  extensions: { "com.openai": OpenAISettings };
  [key: string]: unknown;
}

interface OpenAISettings {
  interface: Record<string, unknown>;
  review?: Record<string, unknown> & { test_cases?: { positive: PositiveCase[]; negative: NegativeCase[] } };
  publication?: Record<string, unknown>;
  [key: string]: unknown;
}

interface PositiveCase {
  description: string;
  prompt: string;
  tools_triggered: string;
  expected_behavior: string;
}

interface NegativeCase {
  description: string;
  prompt: string;
}

/** listing.json plus the golden set's review cases. */
export function buildManifest(listing: Manifest, golden: GoldenSet): Manifest {
  const review = golden.cases.filter((c) => c.review);
  const positive = review
    .filter((c) => c.kind !== "negative")
    .map((c) => ({
      description: c.id.replace(/-/g, " "),
      prompt: c.prompt,
      tools_triggered: c.expect.calls.map((call) => call.tool).join(", "),
      expected_behavior: c.expect.outcome,
    }));
  const negative = review
    .filter((c) => c.kind === "negative")
    .map((c) => ({ description: c.why ?? c.expect.outcome, prompt: c.prompt }));

  const manifest = structuredClone(listing);
  const openai = manifest.extensions["com.openai"];
  openai.review = { ...(openai.review ?? {}), test_cases: { positive, negative } };
  return manifest;
}

/** WCAG relative-luminance contrast ratio between two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * Words a listing must not carry: pricing and offers (OpenAI's guidelines and
 * Homedata's never-advertise-an-unevidenced-offer rule), competitor portals
 * (Homedata's positioning rule), internals, and "MCP"/"plugin" in the name.
 */
const BANNED_LISTING_TEXT: Array<[RegExp, string]> = [
  [/£|\$|\b\d+(?:\.\d+)?\s*(?:p|pence|pounds?|dollars?|tokens?|credits?)\b|\bprice[sd]? (from|at)\b|\btokens?\b|\bcredits?\b|\bfree\b|\btrial\b|\bdiscount|\bsubscri|\bupgrade\b|\bcheap/i, "pricing or an offer"],
  [/\brightmove\b|\bzoopla\b|\bonthemarket\b|\bOTM\b|\bprimelocation\b|\bpurplebricks\b|\bopenrent\b|\bspareroom\b/i, "a competitor portal"],
  [/\bscrap(e|ed|ing)\b|\bVOA\b|\bloki\b|\bthor\b|\batlas\b/i, "an internal detail"],
];

/** The one paid-credit disclosure approved for the public listing. */
export const APPROVED_PAID_CREDIT_DISCLOSURE = "Lookups consume paid credits from your Homedata account.";

/** What one plugin's listing may and must say, beyond OpenAI's own limits. */
export interface PackageRules {
  /** The one sentence about paid use the listing must carry once, or null when it may say nothing about paying. */
  paidDisclosure: string | null;
  /** review.commerce_description, word for word. */
  commerceDescription: string;
  /** Claims the plugin cannot make; a sentence may name them only to rule them out. */
  outOfScope: RegExp;
  outOfScopeLabel: string;
}

/**
 * Homedata does not value homes or search homes for sale, so text the model or
 * a user reads may name either only to rule it out.
 */
export const HOMEDATA_RULES: PackageRules = {
  paidDisclosure: APPROVED_PAID_CREDIT_DISCLOSURE,
  commerceDescription:
    "Lookups consume paid credits from the connected account. Credits are bought outside ChatGPT, and the plugin takes no payments.",
  outOfScope: /\bvalu(e|es|ed|ing|ation|ations)\b|\bworth\b|\bfor sale\b|\blistings?\b/i,
  outOfScopeLabel: "a valuation or homes for sale",
};

/** Remove only the exact approved sentence before applying the pricing rules. */
function withoutDisclosure(text: string, disclosure: string | null): string {
  return disclosure ? text.split(disclosure).join("") : text;
}

/** Each sentence naming an out-of-scope claim must carry a negation. Sentences end at ". " or a line break. */
const NEGATED = /\b(not|never|no)\b|n't\b/i;

/** Sentences that offer an out-of-scope claim instead of stating the limit. */
export function outOfScopeClaims(text: string, pattern: RegExp = HOMEDATA_RULES.outOfScope): string[] {
  return text
    .split(/(?<=\.)\s+|\n+/)
    .filter((sentence) => pattern.test(sentence) && !NEGATED.test(sentence));
}

const MAX = { displayName: 30, shortDescription: 30, longDescription: 4000, developerName: 80, prompt: 128 };

export interface Asset {
  path: string;
  width: number;
  height: number;
}

/** Problems that would fail submission or break Homedata's rules; empty means ready. */
export function validatePackage(manifest: Manifest, toolNames: string[], assets: Asset[], rules: PackageRules = HOMEDATA_RULES): string[] {
  const problems: string[] = [];
  const ui = manifest.extensions["com.openai"].interface as Record<string, any>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.name) || manifest.name.length > 64) problems.push("name: lowercase letters, numbers and single hyphens, at most 64");
  for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category"] as const) {
    if (!text(ui[field]).trim()) problems.push(`interface.${field} is required`);
  }
  for (const field of ["displayName", "shortDescription", "longDescription", "developerName"] as const) {
    if (text(ui[field]).length > MAX[field]) problems.push(`interface.${field} is ${text(ui[field]).length} characters; the limit is ${MAX[field]}`);
  }
  if (/\n/.test(text(ui["shortDescription"]))) problems.push("interface.shortDescription must be one line");
  if (/\b(mcp|plugin|mcp server)\b/i.test(text(ui["displayName"]))) problems.push('interface.displayName must not append "MCP" or "Plugin"');

  for (const field of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
    const url = text(ui[field]);
    if (!/^https:\/\/[^\s@]+$/.test(url) || url.length > 1024) problems.push(`interface.${field} must be an https URL without credentials`);
  }

  const prompts = Array.isArray(ui["defaultPrompt"]) ? (ui["defaultPrompt"] as string[]) : [];
  if (prompts.length > 3) problems.push("interface.defaultPrompt: at most three");
  if (new Set(prompts).size !== prompts.length) problems.push("interface.defaultPrompt: prompts must be unique");
  for (const p of prompts) {
    if (p.length > MAX.prompt) problems.push(`starter prompt over ${MAX.prompt} characters: ${p}`);
    if (p.includes("@")) problems.push(`starter prompt must not @mention: ${p}`);
  }

  if (ui["brandColor"] && contrast(text(ui["brandColor"]), "#FFFFFF") < 2) problems.push("interface.brandColor needs 2:1 contrast against white");
  if (ui["brandColorDark"] && contrast(text(ui["brandColorDark"]), "#212121") < 2) problems.push("interface.brandColorDark needs 2:1 contrast against #212121");

  for (const field of ["logo", "logoDark", "composerIcon", "composerIconDark"]) {
    const path = ui[field];
    if (path === undefined) {
      if (field === "logo" || field === "composerIcon") problems.push(`interface.${field} is required`);
      continue;
    }
    const asset = assets.find((a) => a.path === path);
    if (!asset) problems.push(`interface.${field}: ${String(path)} is not in the package`);
    else if (asset.width !== asset.height || asset.width < 48 || asset.width > 4096) problems.push(`interface.${field}: must be square, 48 to 4096 pixels`);
  }

  const keywords = Array.isArray(manifest["keywords"]) ? (manifest["keywords"] as unknown[]) : [];
  if (keywords.length === 0) problems.push("keywords: list the terms people search for");
  const listingText = [
    manifest["description"],
    ui["displayName"],
    ui["shortDescription"],
    ui["longDescription"],
    ...prompts,
    ...(ui["capabilities"] ?? []),
    ...keywords,
  ]
    .map(text)
    .join("\n");
  if (rules.paidDisclosure) {
    if (text(manifest["description"]).split(rules.paidDisclosure).length !== 2) {
      problems.push("description must contain the approved paid-credit disclosure exactly once");
    }
    if (text(ui["longDescription"]).split(rules.paidDisclosure).length !== 2) {
      problems.push("interface.longDescription must contain the approved paid-credit disclosure exactly once");
    }
  }
  problems.push(...listingTextProblems(withoutDisclosure(listingText, rules.paidDisclosure), rules, "listing text"));

  const openai = manifest.extensions["com.openai"];
  if (openai.review?.["commerce"] !== false) problems.push("review.commerce must be false");
  if (openai.review?.["commerce_description"] !== rules.commerceDescription) {
    problems.push("review.commerce_description must carry the approved no-payments disclosure word for word");
  }
  const cases = openai.review?.test_cases;
  if (cases?.positive.length !== 5) problems.push(`review: ${cases?.positive.length ?? 0} positive cases; initial review needs exactly 5`);
  if (cases?.negative.length !== 3) problems.push(`review: ${cases?.negative.length ?? 0} negative cases; initial review needs exactly 3`);
  for (const c of cases?.positive ?? []) {
    if (!c.tools_triggered || !c.expected_behavior) problems.push(`positive case "${c.description}" needs tools_triggered and expected_behavior`);
    for (const tool of c.tools_triggered.split(", ")) {
      if (tool && !toolNames.includes(tool)) problems.push(`positive case "${c.description}" names ${tool}, which the endpoint does not list`);
    }
  }
  const raw = JSON.stringify(manifest);
  if (/test_credentials|reviewer_instructions|password/i.test(raw)) problems.push("credentials and reviewer instructions belong in the dashboard, never in the package");

  const countries = openai.publication?.["countries"];
  if (!Array.isArray(countries) || countries.some((c) => !/^[A-Z]{2}$/.test(String(c)))) problems.push("publication.countries must list uppercase country codes");

  return problems;
}

/** Pricing, competitor, internal and out-of-scope wording in text a user or the model reads. */
function listingTextProblems(text: string, rules: PackageRules, where: string): string[] {
  const problems: string[] = [];
  for (const [pattern, why] of BANNED_LISTING_TEXT) {
    const hit = pattern.exec(text);
    if (hit) problems.push(`${where} mentions ${why}: "${hit[0]}"`);
  }
  for (const sentence of outOfScopeClaims(text, rules.outOfScope)) {
    problems.push(`${where} names ${rules.outOfScopeLabel} other than as a limit: "${sentence}"`);
  }
  return problems;
}

/** One bundled skill: skills/<dir>/SKILL.md and, when present, agents/openai.yaml. */
export interface Skill {
  dir: string;
  text: string;
  openaiYaml?: string;
}

/** Every skills/<dir>/ under a plugin source folder; none when it has no skills folder. */
export function readSkills(pluginDir: string): Skill[] {
  const root = join(pluginDir, "skills");
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
  return dirs.map((dir) => {
    const read = (path: string) => {
      try { return readFileSync(join(root, dir, path), "utf8"); } catch { return undefined; }
    };
    return { dir, text: read("SKILL.md") ?? "", openaiYaml: read("agents/openai.yaml") };
  });
}

/**
 * Skills teach the model a workflow over the endpoint's tools, so each must
 * name real tools: every `snake_case` word in backticks has to be a listed
 * tool, one of its arguments or one of its allowed values, and at least one has
 * to be a tool. A renamed tool turns a skill red here instead of leaving the
 * model to call a name that does not exist. Skill text is held to the same
 * listing rules as the directory text, and a declared MCP dependency must point
 * at the server the package ships.
 */
export function validateSkills(skills: Skill[], tools: ListedTool[], rules: PackageRules, mcpUrl: string): string[] {
  const problems: string[] = [];
  const toolNames = new Set(tools.map((t) => t.name));
  const known = new Set<string>(toolNames);
  for (const tool of tools) {
    for (const [arg, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
      known.add(arg);
      for (const value of schema.enum ?? []) known.add(String(value));
    }
  }

  for (const skill of skills) {
    const at = `skill ${skill.dir}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skill.dir) || skill.dir.length > 64) problems.push(`${at}: folder name must be lowercase words joined by single hyphens, at most 64`);
    const front = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(skill.text);
    if (!front) {
      problems.push(`${at}: SKILL.md must start with name and description front matter`);
      continue;
    }
    const field = (name: string) => new RegExp(`^${name}:[ \\t]*(.+)$`, "m").exec(front[1]!)?.[1]?.trim() ?? "";
    const name = field("name");
    const description = field("description");
    const body = front[2]!;
    if (name !== skill.dir) problems.push(`${at}: name "${name}" must match its folder`);
    if (!description) problems.push(`${at}: description is required; it decides when the model uses the skill`);
    if (description.length > 1024) problems.push(`${at}: description is ${description.length} characters; the limit is 1024`);
    if (!body.trim()) problems.push(`${at}: the body must hold the workflow`);

    const named = [...body.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]!);
    for (const word of new Set(named)) {
      if (!known.has(word)) problems.push(`${at}: names \`${word}\`, which is not a tool, argument or value the endpoint lists`);
    }
    if (!named.some((word) => toolNames.has(word))) problems.push(`${at}: names no tool the endpoint lists`);
    problems.push(...listingTextProblems(`${description}\n${body}`, rules, at));

    if (skill.openaiYaml !== undefined) {
      const url = /^\s*url:\s*"?([^"\s]+)"?\s*$/m.exec(skill.openaiYaml)?.[1];
      if (url !== mcpUrl) problems.push(`${at}: agents/openai.yaml must depend on ${mcpUrl}, not ${url ?? "nothing"}`);
    }
  }
  return problems;
}
