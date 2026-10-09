import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { GoldenSet } from "../golden.js";
import {
  APPROVED_PAID_CREDIT_DISCLOSURE,
  buildManifest,
  contrast,
  outOfScopeClaims,
  secretsIn,
  validatePackage,
  type Asset,
  type Manifest,
} from "../plugin-package.js";
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
  assert.ok(String(manifest["description"]).endsWith(APPROVED_PAID_CREDIT_DISCLOSURE));
  assert.deepEqual(manifest.extensions["com.openai"].publication!["countries"], []);
  assert.equal(manifest.extensions["com.openai"].review!["commerce"], false);
});

test("the package check permits only the approved paid-credit disclosure", () => {
  const approved = build();
  assert.deepEqual(validatePackage(approved, TOOLS, ASSETS), []);

  const forbidden = [
    "Lookups cost £2.",
    "Lookups cost 20p.",
    "Lookups cost 20 credits.",
    "Get 3 lookups free.",
    "Start a trial.",
    "Claim a discount.",
    "Choose a subscription.",
    "Upgrade your account.",
    "Lookups consume paid credits from an account.",
  ];
  for (const sentence of forbidden) {
    const manifest = build();
    manifest["description"] = `${manifest["description"]} ${sentence}`;
    assert.match(validatePackage(manifest, TOOLS, ASSETS).join("\n"), /mentions pricing or an offer/, sentence);
  }

  const missingFromDescription = build();
  missingFromDescription["description"] = String(missingFromDescription["description"]).replace(APPROVED_PAID_CREDIT_DISCLOSURE, "");
  assert.match(
    validatePackage(missingFromDescription, TOOLS, ASSETS).join("\n"),
    /^description must contain the approved paid-credit disclosure exactly once$/m,
  );

  const onlyInDescription = build();
  onlyInDescription.extensions["com.openai"].interface["longDescription"] = String(
    onlyInDescription.extensions["com.openai"].interface["longDescription"],
  ).replace(APPROVED_PAID_CREDIT_DISCLOSURE, "Lookups use your existing account.");
  assert.match(
    validatePackage(onlyInDescription, TOOLS, ASSETS).join("\n"),
    /interface\.longDescription must contain the approved paid-credit disclosure exactly once/,
  );
  assert.ok(String(onlyInDescription["description"]).includes(APPROVED_PAID_CREDIT_DISCLOSURE));

  const repeated = build();
  repeated.extensions["com.openai"].interface["longDescription"] = `${String(
    repeated.extensions["com.openai"].interface["longDescription"],
  )} ${APPROVED_PAID_CREDIT_DISCLOSURE}`;
  assert.match(
    validatePackage(repeated, TOOLS, ASSETS).join("\n"),
    /interface\.longDescription must contain the approved paid-credit disclosure exactly once/,
  );
});

test("the package check enforces the approved non-commerce declaration", () => {
  for (const mutate of [
    (manifest: Manifest) => { manifest.extensions["com.openai"].review!["commerce"] = true; },
    (manifest: Manifest) => { manifest.extensions["com.openai"].review!["commerce_description"] = "The plugin takes no payments."; },
  ]) {
    const manifest = build();
    mutate(manifest);
    assert.match(validatePackage(manifest, TOOLS, ASSETS).join("\n"), /review\.commerce/);
  }
});

test("review cases come from the golden set: five positive, three negative, real tools", () => {
  const cases = build().extensions["com.openai"].review!.test_cases!;
  assert.equal(cases.positive.length, 5);
  assert.equal(cases.negative.length, 3);
  assert.equal(cases.positive[0]!.tools_triggered, "address_match, risks");
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

test("keywords are required and held to the listing rules, and valuations or homes for sale appear only as limits", () => {
  const empty = build();
  empty["keywords"] = [];
  assert.match(validatePackage(empty, TOOLS, ASSETS).join("\n"), /keywords: list the terms/);

  const broken = build();
  broken["keywords"] = ["house", "free valuation"];
  (broken.extensions["com.openai"].interface["capabilities"] as string[]).push("Search homes for sale near you");
  const problems = validatePackage(broken, TOOLS, ASSETS).join("\n");
  assert.match(problems, /mentions pricing or an offer: "free"/);
  assert.match(problems, /other than as a limit: "free valuation"/);
  assert.match(problems, /other than as a limit: "Search homes for sale near you"/);

  // The listing's own limits sentence names both and passes.
  assert.deepEqual(outOfScopeClaims("It does not value properties, search homes for sale, or give details about owners."), []);
  assert.deepEqual(outOfScopeClaims("Area averages, not the value of any one home."), []);
});

test("contrast matches the WCAG formula", () => {
  assert.equal(contrast("#FFFFFF", "#000000").toFixed(1), "21.0");
  assert.ok(contrast("#0A1628", "#FFFFFF") > 15);
});

test("the secrets scan refuses keys, tokens and secrets files, and passes the real packages", () => {
  const file = (path: string, text: string) => ({ path, bytes: Buffer.from(text) });
  assert.deepEqual(secretsIn([file("plugin.json", '{"name":"home","keywords":["mortgage calculator"]}'), file("skills/a/SKILL.md", "Use `search_homes`. Never put a token in the answer.")]), []);
  const caught = (text: string) => secretsIn([file("mcp.json", text)]).join("\n");
  // Every fixture is assembled at runtime so no key-shaped literal sits in the source.
  const fake = "x".repeat(32);
  const mapboxShaped = ["pk", "eyJ" + fake].join(".");
  assert.match(caught(`"token": "${mapboxShaped}.abc"`), /a Mapbox token/);
  assert.match(caught(["sk", fake].join("-")), /an API secret key/);
  assert.match(caught(["gh" + "p", fake].join("_")), /a GitHub token/);
  assert.match(caught(`Authorization: ${"Bear" + "er"} ${fake}`), /a bearer token/);
  assert.match(caught(["SERVICE_API_KEY", "synthetic"].join("=")), /an environment secret/);
  assert.match(caught(["-----BEGIN RSA PRIVATE", "KEY-----"].join(" ")), /a private key/);
  assert.match(secretsIn([file("skills/a/.env", "")]).join("\n"), /a secrets file must never be packaged/);
  assert.deepEqual(secretsIn([{ path: "assets/logo.png", bytes: Buffer.from(mapboxShaped) }]), []);

  for (const dir of ["chatgpt-plugin", "home-chatgpt-plugin"]) {
    const walk = (at: string, prefix = ""): Array<{ path: string; bytes: Buffer }> => readdirSync(at, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(at, e.name), `${prefix}${e.name}/`) : [{ path: `${prefix}${e.name}`, bytes: readFileSync(join(at, e.name)) }]);
    assert.deepEqual(secretsIn(walk(join(ROOT, dir))), [], dir);
  }
});
