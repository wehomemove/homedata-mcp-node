/**
 * The check that asks whether the vendored manifest is still the current one.
 *
 * vendor-manifest --check asks whether the vendored files match the commit they
 * RECORD; this asks whether that commit is still the upstream head. Both can be
 * green while the package ships a year-old tool list, which is the defect.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// @ts-expect-error - plain ESM script, no types
import { compare, resolveUpstreamHead } from "../../scripts/check-manifest-current.mjs";

const ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const HEAD = "1c3a344fec8085651cb5eb9f41aa0b9c4e0bf2c8";
const OLDER = "8fd967baa79dc063ce983a2d062ad05875c592a2";

test("current when the recorded commit is the upstream head", () => {
  const verdict = compare(HEAD, HEAD);
  assert.equal(verdict.current, true);
  assert.match(verdict.reason, /upstream head/);
});

test("stale when the recorded commit is behind, naming both commits", () => {
  // The real case: SOURCE.json pinned the T2 branch head while main had moved on,
  // and every existing check stayed green because the content happened to match.
  const verdict = compare(OLDER, HEAD);
  assert.equal(verdict.current, false);
  assert.match(verdict.reason, new RegExp(OLDER));
  assert.match(verdict.reason, new RegExp(HEAD));
});

test("a SOURCE.json without a commit sha is not current", () => {
  for (const bad of ["main", "", null, undefined, "1c3a344"]) {
    assert.equal(compare(bad as string, HEAD).current, false, String(bad));
  }
});

test("an unresolvable ref raises rather than returning a sha", () => {
  const empty = () => "";
  assert.throws(() => resolveUpstreamHead("https://example.invalid/x.git", "refs/heads/main", empty), /could not resolve/);
  const junk = () => "not-a-sha\trefs/heads/main\n";
  assert.throws(() => resolveUpstreamHead("https://example.invalid/x.git", "refs/heads/main", junk), /could not resolve/);
});

test("the ref is read from the ls-remote line that matches it", () => {
  const out = () => `${HEAD}\trefs/heads/main\ndeadbeef${"0".repeat(32)}\trefs/heads/other\n`;
  assert.equal(resolveUpstreamHead("https://example.invalid/x.git", "refs/heads/main", out), HEAD);
});

test("the committed SOURCE.json records a full commit sha", () => {
  const source = JSON.parse(readFileSync(join(ROOT, "src/manifest/SOURCE.json"), "utf8")) as { ref: string; repository: string };
  assert.match(source.ref, /^[0-9a-f]{40}$/);
  assert.equal(source.repository, "wehomemove/homedata-mcp");
});
