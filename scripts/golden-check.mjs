#!/usr/bin/env node
/**
 * Check the golden prompt set against a LIVE endpoint's tool list, e.g. after a
 * deploy and before rerunning the set in ChatGPT developer mode:
 *
 *   npm run build && node scripts/golden-check.mjs https://<host>/mcp/<secret>
 *
 * Exit 0 when the set holds, 1 when it has drifted, 2 when the endpoint could
 * not be read. The URL is never printed: in phase 1 its path is the secret.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkGoldenSet } from '../dist/golden.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/golden-check.mjs <mcp endpoint url>');
  process.exit(2);
}

let tools;
try {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  tools = (await response.json()).result.tools;
  if (!Array.isArray(tools)) throw new Error(`status ${response.status}`);
} catch (err) {
  console.error(`could not read the tool list: ${err.message}`);
  process.exit(2);
}

const set = JSON.parse(readFileSync(join(ROOT, 'docs/chatgpt-app/golden-prompts.json'), 'utf8'));
const problems = checkGoldenSet(set, tools);
for (const p of problems) console.log(p);
console.log(problems.length ? `${problems.length} problem(s)` : `golden set ${set.version} holds: ${set.cases.length} cases, ${tools.length} tools`);
process.exit(problems.length ? 1 : 0);
