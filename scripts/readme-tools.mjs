#!/usr/bin/env node
/**
 * Render the README's tool table from the vendored manifest.
 *   node scripts/readme-tools.mjs          rewrite the table
 *   node scripts/readme-tools.mjs --check  exit 1 if it is stale (tests run this)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');
const read = (f) => JSON.parse(readFileSync(join(ROOT, 'src/manifest', f), 'utf8'));
const manifest = read('tools.json');
const descriptions = read('descriptions.json');
const BEGIN = '<!-- BEGIN GENERATED: tools -->';
const END = '<!-- END GENERATED: tools -->';

const price = (tokens) => {
    if (tokens.plus_with_addons) return `${tokens.default} + add-ons`;
    if (tokens.default === 0) return 'free';
    const rules = (tokens.when ?? []).map((w) => `; ${w.tokens} when \`${w.param}\` is ${w.in.join(' or ')}`).join('');
    return `${tokens.default}${rules}`;
};

const rows = ['| Tool | Tokens | What it returns |', '|---|---|---|'];
for (const spec of [...manifest.tools].sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push(`| \`${spec.name}\` | ${price(spec.tokens)} | ${descriptions[spec.name].replace(/\s*(Costs .*|Free: .*)$/, '')} |`);
}
for (const spec of manifest.static_tools) rows.push(`| \`${spec.name}\` | none | ${descriptions[spec.name]} |`);

const text = readFileSync(README, 'utf8');
const updated = text.slice(0, text.indexOf(BEGIN)) + [BEGIN, ...rows, END].join('\n') + text.slice(text.indexOf(END) + END.length);
if (process.argv.includes('--check')) {
    if (updated !== text) {
        console.error('README tool table is stale: run node scripts/readme-tools.mjs');
        process.exit(1);
    }
    console.log('README tool table is current');
} else {
    writeFileSync(README, updated);
    console.log('README tool table written');
}
