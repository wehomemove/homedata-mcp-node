/**
 * The ChatGPT plugin package: chatgpt-plugin/listing.json (hand-written listing
 * text) plus review cases taken from the golden prompt set, so the submitted
 * cases and the cases we test against can never disagree.
 *
 * validatePackage() holds the manifest to OpenAI's submission limits
 * (https://developers.openai.com/plugins/deploy/submission#manifest-fields) and
 * to Homedata's own listing rules. It runs in npm test and before every ZIP.
 */
import type { GoldenSet } from "./golden.js";

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
  [/\brightmove\b|\bzoopla\b|\bonthemarket\b|\bOTM\b/i, "a competitor portal"],
  [/\bscrap(e|ed|ing)\b|\bVOA\b|\bloki\b|\bthor\b/i, "an internal detail"],
];

/** The one paid-credit disclosure approved for the public listing. */
export const APPROVED_PAID_CREDIT_DISCLOSURE = "Lookups consume paid credits from your Homedata account.";

/** Remove only the exact approved sentence before applying the pricing rules. */
function withoutApprovedPaidCreditDisclosure(text: string): string {
  return text.split(APPROVED_PAID_CREDIT_DISCLOSURE).join("");
}

/**
 * Homedata does not value homes or search homes for sale, so text the model or
 * a user reads may name either only to rule it out. Each sentence that does
 * must carry a negation. Sentences end at ". " or a line break.
 */
const OUT_OF_SCOPE = /\bvalu(e|es|ed|ing|ation|ations)\b|\bworth\b|\bfor sale\b|\blistings?\b/i;
const NEGATED = /\b(not|never|no)\b|n't\b/i;

/** Sentences that offer a valuation or homes for sale instead of stating the limit. */
export function outOfScopeClaims(text: string): string[] {
  return text
    .split(/(?<=\.)\s+|\n+/)
    .filter((sentence) => OUT_OF_SCOPE.test(sentence) && !NEGATED.test(sentence));
}

const MAX = { displayName: 30, shortDescription: 30, longDescription: 4000, developerName: 80, prompt: 128 };

export interface Asset {
  path: string;
  width: number;
  height: number;
}

/** Problems that would fail submission or break Homedata's rules; empty means ready. */
export function validatePackage(manifest: Manifest, toolNames: string[], assets: Asset[]): string[] {
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
  if (text(manifest["description"]).split(APPROVED_PAID_CREDIT_DISCLOSURE).length !== 2) {
    problems.push("description must contain the approved paid-credit disclosure exactly once");
  }
  const guardedListingText = withoutApprovedPaidCreditDisclosure(listingText);
  for (const [pattern, why] of BANNED_LISTING_TEXT) {
    const hit = pattern.exec(guardedListingText);
    if (hit) problems.push(`listing text mentions ${why}: "${hit[0]}"`);
  }
  for (const sentence of outOfScopeClaims(listingText)) {
    problems.push(`listing text names a valuation or homes for sale other than as a limit: "${sentence}"`);
  }

  const openai = manifest.extensions["com.openai"];
  if (openai.review?.["commerce"] !== false) problems.push("review.commerce must be false");
  if (
    openai.review?.["commerce_description"] !==
    "Lookups consume paid credits from the connected account. Credits are bought outside ChatGPT, and the plugin takes no payments."
  ) {
    problems.push("review.commerce_description must carry the approved paid-credit and no-payments disclosure");
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
