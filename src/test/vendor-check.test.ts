/**
 * `vendor-manifest --check` must distinguish "could not look" from "looked and
 * it is wrong".
 *
 * Every case here drives the REAL script as a child process and asserts its
 * exit code, because the exit code is the whole contract — CI reads it and a
 * human under time pressure reads the line next to it. Asserting on an internal
 * function would test a shape the caller never sees.
 *
 * The failure paths are the point. Before 2026-09-21 a thrown `fetch` was not
 * caught at all and every --check failure was exit 1, so a reset connection
 * reported a parity defect that did not exist. A branch that has never been
 * executed is a branch, not a behaviour, so each one is executed here against a
 * real socket: a dead port, a 500, a 404, and a server handing back bytes that
 * genuinely differ.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { AddressInfo, createServer as createSocketServer } from "node:net";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SCRIPT = join(ROOT, "scripts/vendor-manifest.mjs");
const FILES = ["tools.json", "descriptions.json", "param_descriptions.json"];
const SOURCE = JSON.parse(readFileSync(join(ROOT, "src/manifest/SOURCE.json"), "utf8")) as { ref: string };

type Run = { code: number; stdout: string; stderr: string };

/**
 * ASYNC on purpose. `execFileSync` blocks this process's event loop, so the
 * stub server below — which lives in the same process — can never answer the
 * child's request, and the whole file deadlocks. The first version of this test
 * did exactly that and hung forever instead of failing, which reports nothing
 * at all. A synchronous child call and an in-process server cannot coexist.
 */
function runCheck(base: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, "--check"], {
      cwd: ROOT,
      env: { ...process.env, HOMEDATA_MANIFEST_RAW_BASE: base },
    }, (error: any, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? -1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * A port nothing listens on, obtained by binding one and letting it go, so the
 * connection is REFUSED.
 *
 * Not a hardcoded low port: port 1 is on fetch's blocked-ports list, so it
 * fails with "bad port" before a socket is ever opened. That is a different
 * branch from the ECONNRESET this guard exists for, and asserting on it would
 * prove the wrong thing while looking right.
 */
async function deadPort(): Promise<string> {
  const probe = createSocketServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

const servers: Server[] = [];
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });

/**
 * A server that answers the manifest paths however `handler` says.
 *
 * `closeAllConnections` and `unref` are both needed: the child's fetch leaves a
 * keep-alive socket behind, `server.close()` waits for it, and node:test then
 * waits for the handle. The first version of this file hung forever rather than
 * failing — a test that cannot finish reports nothing at all, which is worse
 * than one that fails.
 */
async function serve(handler: (file: string) => { status: number; body: string }): Promise<string> {
  const server = createServer((req, res) => {
    const file = FILES.find((f) => (req.url ?? "").endsWith(`/${f}`));
    if (!file) { res.writeHead(404); res.end("no"); return; }
    const { status, body } = handler(file);
    res.writeHead(status, { "content-type": "application/json", connection: "close" });
    res.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const vendored = (file: string) => readFileSync(join(ROOT, "src/manifest", file), "utf8");

test("0 — the bytes were fetched and they match", async () => {
  const base = await serve((file) => ({ status: 200, body: vendored(file) }));
  const run = await runCheck(base);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /vendored manifest matches/);
});

test("1 — the bytes were fetched and they DIFFER", async () => {
  // The one case that may claim the manifest is wrong: every byte arrived and
  // one of them is not what is vendored.
  const base = await serve((file) => ({
    status: 200,
    body: file === "tools.json" ? vendored(file).replace("tools", "toolz") : vendored(file),
  }));
  const run = await runCheck(base);
  assert.equal(run.code, 1, run.stderr);
  assert.match(run.stderr, /does not match its source/);
  assert.match(run.stderr, /tools\.json differs/);
});

test("2 — a refused connection is NOT a parity defect", async () => {
  // A real loopback port that nothing listens on, so the connection is refused
  // and `fetch` throws. This is the shape of the ECONNRESET that failed the
  // parity job on #4 — the branch that used to be uncaught entirely.
  const run = await runCheck(await deadPort());
  assert.equal(run.code, 2, `expected "could not look", got ${run.code}: ${run.stderr}`);
  assert.match(run.stderr, /could not check the manifest/);
  assert.match(run.stderr, /could not be fetched/);
});

test("2 — a 500 is not a parity defect either", async () => {
  const base = await serve(() => ({ status: 500, body: "upstream is unwell" }));
  const run = await runCheck(base);
  assert.equal(run.code, 2, run.stderr);
  assert.match(run.stderr, /returned 500/);
});

test("2 — a 404 is not a parity defect, which is the judgement call", async () => {
  // Deliberate: a 404 is consistent with a ref that never existed, a moved
  // file, a private repo and a bad gateway dressed as one. None of those
  // compared a byte, so none of them may claim the manifest is wrong.
  const base = await serve(() => ({ status: 404, body: "not found" }));
  const run = await runCheck(base);
  assert.equal(run.code, 2, run.stderr);
  assert.match(run.stderr, /returned 404/);
});

test("the unreachable message never names a cause it cannot know", async () => {
  // A reset, a proxy, DNS, an outage and a closed laptop all arrive as one
  // thrown error. The sibling Python release check had to have exactly this
  // kind of headline rewritten once a second route to exit 2 existed.
  const run = await runCheck(await deadPort());
  assert.equal(run.code, 2);
  for (const asserted of [/network is (down|unavailable)/i, /github is (down|unreachable)/i,
    /you are offline/i, /the manifest is (wrong|stale|out of date)/i, /parity/i]) {
    assert.equal(asserted.test(run.stderr), false, `stderr asserts a cause it cannot know: ${run.stderr}`);
  }
  // It must still say WHICH url and hand over what the runtime reported, or the
  // operator is left with "something went wrong".
  assert.match(run.stderr, /127\.0\.0\.1:\d+/);
});

test("a mismatch and an unreachable do not share an exit code", async () => {
  // The regression in one line: if these ever collapse, the check has stopped
  // distinguishing the two things it exists to distinguish.
  const differing = await serve((file) => ({ status: 200, body: `${vendored(file)} ` }));
  assert.notEqual((await runCheck(differing)).code, (await runCheck(await deadPort())).code);
});

test("the CI annotation for exit 2 names no cause either", () => {
  /**
   * The workflow is the one surface here that no other test reads, and it is
   * where this exact mistake was made: the first version of that annotation
   * said "(infrastructure)" and "re-running is the right response", in the same
   * PR that removed the identical claim from the script it wraps. CodeRabbit
   * caught it, not this suite.
   *
   * Seven things reach exit 2 and they do not share a cause. Three are
   * infrastructure (refused connection, non-OK status, unreadable body) and
   * four are the change (missing --ref, malformed --ref, unreadable
   * SOURCE.json, unreadable local manifest file). Any annotation that picks one
   * family sends someone to the wrong place for the other.
   */
  const workflow = readFileSync(join(ROOT, ".github/workflows/test.yml"), "utf8");
  const line = workflow.split("\n").find((l) => l.includes("::error title=") && l.includes("did not complete"));
  assert.ok(line, "the exit-2 annotation is gone or renamed — re-read this guard before deleting it");

  for (const cause of [/infrastructure/i, /\bnetwork\b/i, /offline/i, /github is (down|unreachable)/i,
    /re-?running is the right/i, /just re-?run/i]) {
    assert.equal(cause.test(line!), false, `the exit-2 annotation asserts a cause it cannot know: ${line}`);
  }
  // It must still carry the one thing that IS true of all seven routes.
  assert.match(line!, /NOTHING WAS COMPARED/);
});
