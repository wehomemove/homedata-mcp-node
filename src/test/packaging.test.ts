/** Things that go stale quietly: the version strings and the README's tool table. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { VERSION } from "../index.js";
import { tools } from "../manifest.js";

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

test("every documented CLI flag is one the CLI accepts", () => {
  // The stale-offer test above bans a fixed list of words, so it can only see a
  // string that should never appear. It cannot see a flag that USED to be real:
  // `--term-years` sat in this README through the catalogue catch-up, documenting
  // a command the CLI now refuses, and every test here stayed green. CodeRabbit
  // found it, on both packages, which is twice the same blind spot.
  //
  // Flags come from the manifest, so this compares the README with the manifest
  // rather than with a list someone has to remember to update.
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const byName = new Map(tools().map((t) => [t.name, new Set(t.params.map((p) => p.name))]));
  const documented = [...readme.matchAll(/^homedata (\w+)((?: --?[\w-]+(?: [^\n]*?)?)*)$/gm)];

  // A guard that finds nothing to check is not a passing guard: if the README is
  // reformatted so these lines stop matching, this must fail rather than go quiet.
  assert.ok(documented.length >= 3, `only ${documented.length} CLI examples matched — has the README changed shape?`);

  for (const [line, name, rest] of documented) {
    if (!byName.has(name)) {
      // Helpers like `homedata tools` are not manifest tools; a typo'd tool name
      // is caught by the tool-table check, so only flags are judged here.
      continue;
    }
    for (const [, flag] of rest.matchAll(/--([\w-]+)/g)) {
      if (["help", "compact", "field"].includes(flag)) continue;
      assert.ok(
        byName.get(name)!.has(flag.replace(/-/g, "_")),
        `README line "${line.trim()}" passes --${flag}, which ${name} does not take ` +
          `(it takes: ${[...byName.get(name)!].join(", ")})`,
      );
    }
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
