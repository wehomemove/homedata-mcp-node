#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGoldenSet } from '../dist/golden.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2];
if (!url) { console.error('usage: node scripts/home-golden-check.mjs <Home MCP endpoint URL>'); process.exit(2); }
try {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  const body = await response.json();
  if (!Array.isArray(body?.result?.tools)) throw new Error(`status ${response.status}`);
  const set = JSON.parse(readFileSync(join(root, 'docs/home-chatgpt-app/golden-prompts.json'), 'utf8'));
  const problems = checkGoldenSet(set, body.result.tools);
  for (const problem of problems) console.log(problem);
  console.log(problems.length ? `${problems.length} problem(s)` : `Home golden set ${set.version} holds`);
  process.exit(problems.length ? 1 : 0);
} catch (error) { console.error(`could not read the Home tool list: ${error.message}`); process.exit(2); }
