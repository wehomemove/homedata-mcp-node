#!/usr/bin/env node
/**
 * Is the vendored manifest still the current one?
 *
 * `scripts/vendor-manifest.mjs --check` verifies that the vendored files match
 * THE COMMIT THEY RECORD. Nothing verified that the recorded commit is still
 * the current one, so this package could vendor a year-old manifest and stay
 * green forever: both checks would pass, and the tools would quietly diverge
 * from the catalogue. That is the defect this closes.
 *
 *   node scripts/check-manifest-current.mjs
 *   node scripts/check-manifest-current.mjs --remote <url> --ref <branch>
 *
 * Exit 0: the recorded commit is the head of the upstream branch.
 * Exit 1: it is not — re-vendor (the message says how).
 * Exit 2: the upstream head could not be resolved. Never a pass: a check that
 *         goes green when it cannot reach its comparison source reports a
 *         comparison it never made.
 *
 * WHAT THIS CHECK DOES NOT COVER:
 *   - Whether the vendored FILES match the commit they record. That is
 *     vendor-manifest --check, which stays as it is; this one asks a different
 *     question and neither replaces the other.
 *   - Whether the upstream manifest is itself correct. Upstream has its own
 *     guards (the parity guard, the catalogue drift check, the schema check).
 *   - Content. It compares the recorded commit with the upstream head, so a
 *     manifest whose CONTENT is unchanged across commits still reports stale.
 *     That is deliberate: provenance that has drifted is how content drift
 *     becomes invisible later, and re-vendoring is one command.
 *   - Any branch other than the one asked for, and any repository other than
 *     the one SOURCE.json records.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src/manifest/SOURCE.json');

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
};

export function resolveUpstreamHead(remote, ref, run = execFileSync) {
    const out = String(run('git', ['ls-remote', remote, ref], { encoding: 'utf8', timeout: 60_000 }));
    const line = out.split('\n').find((l) => l.trim().endsWith(ref));
    const sha = line ? line.split(/\s+/)[0] : null;
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
        throw new Error(`could not resolve ${ref} on ${remote}: ls-remote returned ${JSON.stringify(out.slice(0, 200))}`);
    }
    return sha;
}

/** Pure: given the recorded and upstream shas, is the vendored manifest current? */
export function compare(recorded, upstreamHead) {
    if (!/^[0-9a-f]{40}$/.test(String(recorded || ''))) {
        return { current: false, reason: `SOURCE.json records ${JSON.stringify(recorded)}, which is not a commit sha` };
    }
    if (recorded === upstreamHead) return { current: true, reason: `vendored at ${recorded}, which is the upstream head` };
    return {
        current: false,
        reason: `vendored at ${recorded}, but the upstream head is ${upstreamHead}`,
    };
}

function main() {
    let source;
    try {
        source = JSON.parse(readFileSync(SOURCE, 'utf8'));
    } catch (error) {
        console.error(`could not read ${SOURCE}: ${error.message}`);
        return 2;
    }
    const remote = arg('--remote', `https://github.com/${source.repository}`);
    const ref = arg('--ref', 'refs/heads/main');

    let upstreamHead;
    try {
        upstreamHead = resolveUpstreamHead(remote, ref);
    } catch (error) {
        // Unreachable is not "current": say so and fail.
        console.error(`could not check whether the vendored manifest is current: ${error.message}`);
        return 2;
    }

    const verdict = compare(source.ref, upstreamHead);
    if (verdict.current) {
        console.log(`in step: ${verdict.reason}`);
        return 0;
    }
    console.error([
        `STALE: ${verdict.reason}.`,
        '',
        'The vendored manifest still matches the commit it records, so the parity job is green;',
        'that job asks a different question. To clear this, re-vendor from the upstream head and',
        'commit the result:',
        '',
        `    node scripts/vendor-manifest.mjs --ref ${upstreamHead}`,
        '    node scripts/readme-tools.mjs',
        '    npm run build && npm test',
        '',
        'If the upstream manifest changed, expect the tool table and tests to change with it.',
    ].join('\n'));
    return 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    process.exit(main());
}
