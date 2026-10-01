import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/*
 * Every entry point must run when launched through a symlink: npm installs
 * `bin` commands as symlinks in node_modules/.bin, and the production endpoint
 * runs from a `current` release link. Comparing argv[1] with import.meta.url as
 * given made all three exit silently that way.
 */
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..");

function linked(file: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "homedata-entry-"));
  const path = join(dir, file);
  symlinkSync(join(DIST, file), path);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const INITIALIZE =
  JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n";

test("the stdio server answers when launched through a symlink", async () => {
  const { path, cleanup } = linked("server.js");
  const child = spawn(process.execPath, [path], { env: { ...process.env, HOMEDATA_API_KEY: "" }, stdio: ["pipe", "pipe", "ignore"] });
  const reply = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no reply within 10s")), 10_000);
    child.stdout.once("data", (chunk) => { clearTimeout(timer); resolve(String(chunk)); });
    child.stdin.write(INITIALIZE);
  });
  child.kill();
  cleanup();
  assert.match(reply, /"serverInfo":\{"name":"homedata"/);
});

test("the CLI runs when launched through a symlink", () => {
  const { path, cleanup } = linked("cli.js");
  const run = spawnSync(process.execPath, [path, "--help"], { encoding: "utf8", timeout: 10_000 });
  cleanup();
  assert.equal(run.status, 0);
  assert.notEqual(`${run.stdout}${run.stderr}`.trim(), "");
});

test("the HTTP endpoint starts when launched through a symlink", async () => {
  const { path, cleanup } = linked("http.js");
  // An invalid config makes main() refuse loudly: proof main() ran at all.
  const run = spawnSync(process.execPath, [path], { env: { ...process.env, MCP_AUTH: "nonsense" }, encoding: "utf8", timeout: 10_000 });
  cleanup();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /MCP_AUTH must be oauth or server-key/);
});
