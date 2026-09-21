#!/usr/bin/env node
/**
 * Vendor the tool manifest from the Python package.
 *
 *   node scripts/vendor-manifest.mjs --ref <commit sha>   fetch and write
 *   node scripts/vendor-manifest.mjs --check              verify what is vendored
 *
 * The manifest is generated from the Homedata Developer Playground catalogue
 * and lives in wehomemove/homedata-mcp. This package serves a vendored copy so
 * both servers describe one API. --check re-fetches the files at the recorded
 * commit and fails if a vendored byte differs, which is what ties the copy this
 * package ships to the one the parity check tests against.
 *
 * EXIT CODES — the distinction this command exists to draw:
 *
 *   0  the bytes were fetched and they match
 *   1  the bytes were fetched and they DIFFER          ("looked, and it is wrong")
 *   2  the bytes could not be fetched or read          ("could not look")
 *
 * Exit 1 is reserved for a comparison that actually happened. Everything else —
 * a refused connection, a reset, a timeout, any non-OK status, an unreadable
 * SOURCE.json, a malformed --ref — is exit 2, because none of them establish
 * anything about the manifest.
 *
 * WHY, and it is not tidiness. Until 2026-09-21 every failure under --check was
 * exit 1, and a `fetch` that threw was not caught at all. The parity job on
 * homedata-mcp-node#4 failed with ECONNRESET and reported a parity defect that
 * did not exist. A check that cries wolf does not merely waste a re-run: it
 * converts "red" from a signal into a suggestion, and the cost lands on a later
 * genuine failure that someone re-runs instead of reading. The same mechanism
 * let an EPC dataset sit three months stale behind a watchdog whose channel
 * everyone had learned to discount.
 *
 * AND THE MESSAGE MUST NOT NAME A CAUSE IT CANNOT KNOW. A refused connection, a
 * proxy, DNS, an outage and a laptop lid all arrive here as the same thrown
 * error. This prints what the runtime reported and stops there. The sibling
 * precedent is the Python release check, whose exit-2 headline once asserted
 * "loki's live schema could not be read" and had to be rewritten once a second
 * route to exit 2 existed.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/manifest');
const SOURCE = join(OUT, 'SOURCE.json');
const REPO = 'wehomemove/homedata-mcp';
const FILES = ['tools.json', 'descriptions.json', 'param_descriptions.json'];

// Overridable so the failure paths can be exercised against a dead port and a
// server serving known-different bytes. A branch that has never been executed
// is a branch, not a behaviour.
const RAW_BASE = process.env.HOMEDATA_MANIFEST_RAW_BASE || 'https://raw.githubusercontent.com';
const RAW = (ref, file) => `${RAW_BASE}/${REPO}/${ref}/homedata_mcp/manifest/${file}`;

const EXIT = { OK: 0, MISMATCH: 1, UNREACHABLE: 2 };

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const CHECK = argv.includes('--check');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Could not look. Never means the manifest is wrong. */
function unreachable(message) {
    console.error(`vendor-manifest: could not check the manifest: ${message}`);
    process.exit(EXIT.UNREACHABLE);
}

/** Looked, and it is wrong. Only reachable once every byte has been fetched. */
function mismatch(message) {
    console.error(`vendor-manifest: the vendored manifest does not match its source:\n${message}`);
    process.exit(EXIT.MISMATCH);
}

async function fetchFile(ref, file) {
    const url = RAW(ref, file);
    let response;
    try {
        response = await fetch(url);
    } catch (error) {
        // Reset, refused, DNS, timeout, proxy, offline — all arrive identically.
        // Report what the runtime said and do not infer which it was.
        const cause = error?.cause?.code || error?.cause?.message || error?.code || error?.message || String(error);
        unreachable(`${url} could not be fetched (${cause})`);
    }
    if (!response.ok) {
        // Deliberately NOT a mismatch, including 404. A 404 is consistent with a
        // ref that never existed, a file that moved, a private repo, and a bad
        // gateway dressed as one. None of those compare a byte.
        unreachable(`${url} returned ${response.status}`);
    }
    try {
        return await response.text();
    } catch (error) {
        unreachable(`${url} responded but the body could not be read (${error?.message || String(error)})`);
    }
}

function readJson(path, what) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        unreachable(`${what} could not be read (${error?.message || String(error)})`);
    }
}

const ref = arg('--ref') ?? (() => {
    try { return JSON.parse(readFileSync(SOURCE, 'utf8')).ref; } catch { return null; }
})();
if (!ref) unreachable('--ref <commit sha> is required the first time, and SOURCE.json did not supply one');
if (!/^[0-9a-f]{40}$/.test(ref)) unreachable(`--ref must be a full commit sha, not "${ref}" (a branch name can move)`);

const fetched = Object.fromEntries(await Promise.all(FILES.map(async (f) => [f, await fetchFile(ref, f)])));

if (CHECK) {
    const recorded = readJson(SOURCE, 'SOURCE.json');
    const problems = [];
    if (recorded.ref !== ref) problems.push(`SOURCE.json ref ${recorded.ref} is not the ref checked (${ref})`);
    for (const file of FILES) {
        let local;
        try {
            local = readFileSync(join(OUT, file), 'utf8');
        } catch (error) {
            // A vendored file we cannot read is not a difference we measured.
            unreachable(`src/manifest/${file} could not be read (${error?.message || String(error)})`);
        }
        if (local !== fetched[file]) problems.push(`${file} differs from ${REPO}@${ref}`);
        if (recorded.files?.[file] !== sha256(local)) problems.push(`${file} does not match its recorded sha256`);
    }
    if (problems.length) mismatch(problems.join('\n'));
    console.log(`vendored manifest matches ${REPO}@${ref}`);
    process.exit(EXIT.OK);
}

mkdirSync(OUT, { recursive: true });
for (const file of FILES) writeFileSync(join(OUT, file), fetched[file]);
writeFileSync(SOURCE, `${JSON.stringify({
    repository: REPO,
    ref,
    fetched_from: RAW(ref, '<file>'),
    files: Object.fromEntries(FILES.map((f) => [f, sha256(fetched[f])])),
}, null, 2)}\n`);
const tools = JSON.parse(fetched['tools.json']);
console.log(`vendored ${REPO}@${ref}: ${tools.tools.length} tools, ${tools.static_tools.length} helpers`);
