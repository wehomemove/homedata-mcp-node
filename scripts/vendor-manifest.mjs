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
const RAW = (ref, file) => `https://raw.githubusercontent.com/${REPO}/${ref}/homedata_mcp/manifest/${file}`;

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const CHECK = argv.includes('--check');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function die(message) { console.error(`vendor-manifest: ${message}`); process.exit(CHECK ? 1 : 2); }

async function fetchFile(ref, file) {
    const response = await fetch(RAW(ref, file));
    if (!response.ok) die(`${RAW(ref, file)} returned ${response.status}`);
    return response.text();
}

const ref = arg('--ref') ?? (() => {
    try { return JSON.parse(readFileSync(SOURCE, 'utf8')).ref; } catch { return null; }
})();
if (!ref) die('--ref <commit sha> is required the first time');
if (!/^[0-9a-f]{40}$/.test(ref)) die(`--ref must be a full commit sha, not "${ref}" (a branch name can move)`);

const fetched = Object.fromEntries(await Promise.all(FILES.map(async (f) => [f, await fetchFile(ref, f)])));

if (CHECK) {
    const recorded = JSON.parse(readFileSync(SOURCE, 'utf8'));
    const problems = [];
    if (recorded.ref !== ref) problems.push(`SOURCE.json ref ${recorded.ref} is not the ref checked (${ref})`);
    for (const file of FILES) {
        const local = readFileSync(join(OUT, file), 'utf8');
        if (local !== fetched[file]) problems.push(`${file} differs from ${REPO}@${ref}`);
        if (recorded.files[file] !== sha256(local)) problems.push(`${file} does not match its recorded sha256`);
    }
    if (problems.length) die(problems.join('\n'));
    console.log(`vendored manifest matches ${REPO}@${ref}`);
    process.exit(0);
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
