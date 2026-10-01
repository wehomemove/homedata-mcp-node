import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { GoldenSet } from "../golden.js";
import { buildManifest, contrast, validatePackage, type Asset, type Manifest } from "../plugin-package.js";
import { PROFILES } from "../profile.js";
import { profileTools } from "../server.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as T;
const pngSize = (p: string) => {
  const b = readFileSync(join(ROOT, "chatgpt-plugin", p));
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};
const TOOLS = profileTools(PROFILES.chatgpt).map((t) => t.name);
const ASSETS: Asset[] = ["logo.png", "logo-dark.png"].map((f) => ({ path: `./assets/${f}`, ...pngSize(`assets/${f}`) }));
const build = () => buildManifest(readJson<Manifest>("chatgpt-plugin/listing.json"), readJson<GoldenSet>("docs/chatgpt-app/golden-prompts.json"));

test("the plugin package is ready to submit", () => {
  const manifest = build();
  assert.deepEqual(validatePackage(manifest, TOOLS, ASSETS), []);
  assert.equal(manifest.extensions["com.openai"].interface["websiteURL"], "https://homedata.co.uk/chatgpt");
});

test("review cases come from the golden set: five positive, three negative, real tools", () => {
  const cases = build().extensions["com.openai"].review!.test_cases!;
  assert.equal(cases.positive.length, 5);
  assert.equal(cases.negative.length, 3);
  assert.equal(cases.positive[0]!.tools_triggered, "address_find, risks");
  assert.match(cases.negative.map((c) => c.prompt).join("\n"), /worth/);
});

test("the validator refuses each way a listing goes wrong", () => {
  const broken = build();
  const ui = broken.extensions["com.openai"].interface as Record<string, unknown>;
  ui["displayName"] = "Homedata MCP";
  ui["shortDescription"] = "UK property data with a free 14-day trial";
  ui["longDescription"] = "Better than Rightmove. Costs 2 tokens per lookup.";
  ui["supportURL"] = "http://homedata.co.uk/contact";
  ui["brandColorDark"] = "#222222";
  ui["logo"] = "./assets/missing.png";
  broken.extensions["com.openai"].review!.test_cases!.positive.pop();
  broken.extensions["com.openai"].review!.test_cases!.positive[0]!.tools_triggered = "valuation";
  (broken as Record<string, unknown>)["test_credentials"] = { password: "x" };

  const problems = validatePackage(broken, TOOLS, ASSETS).join("\n");
  for (const expected of [
    /displayName must not append "MCP"/,
    /shortDescription is \d+ characters; the limit is 30/,
    /mentions pricing or an offer/,
    /mentions a competitor portal/,
    /supportURL must be an https URL/,
    /brandColorDark needs 2:1 contrast/,
    /logo: \.\/assets\/missing\.png is not in the package/,
    /4 positive cases; initial review needs exactly 5/,
    /names valuation, which the endpoint does not list/,
    /credentials and reviewer instructions belong in the dashboard/,
  ]) {
    assert.match(problems, expected);
  }
});

test("contrast matches the WCAG formula", () => {
  assert.equal(contrast("#FFFFFF", "#000000").toFixed(1), "21.0");
  assert.ok(contrast("#0A1628", "#FFFFFF") > 15);
});
