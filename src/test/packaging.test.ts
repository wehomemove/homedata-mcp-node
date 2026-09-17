/** Things that go stale quietly: the version strings and the README's tool table. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { VERSION } from "../index.js";

const ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

test("version strings match", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  assert.equal(VERSION, pkg.version);
});

test("the README tool table is current", () => {
  execFileSync(process.execPath, [join(ROOT, "scripts/readme-tools.mjs"), "--check"], { cwd: ROOT });
});

test("the README makes no stale offer", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  for (const banned of [/@homedata\/mcp-server/, /free\s+(tier|plan|allowance|calls?|credits?)/i,
    /\b(?:starter|growth|pro|scale|paid|enterprise)\s+(?:tiers?|plans?)\b/i, /\bscrap(?:e|ed|es|ing|er)\b/i]) {
    assert.equal(banned.test(readme), false, `README matches ${banned}`);
  }
});

test("the vendored manifest records where it came from", () => {
  const source = JSON.parse(readFileSync(join(ROOT, "src/manifest/SOURCE.json"), "utf8")) as {
    repository: string; ref: string; files: Record<string, string>;
  };
  assert.equal(source.repository, "wehomemove/homedata-mcp");
  assert.match(source.ref, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(source.files).sort(), ["descriptions.json", "param_descriptions.json", "tools.json"]);
});
