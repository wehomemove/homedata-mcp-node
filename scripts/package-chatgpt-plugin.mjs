#!/usr/bin/env node
/**
 * Build the ChatGPT plugin ZIP for OpenAI's plugin portal:
 *
 *   npm run build && node scripts/package-chatgpt-plugin.mjs
 *
 * Writes dist-plugin/homedata-chatgpt-plugin.zip containing plugin.json (built
 * from chatgpt-plugin/listing.json plus the golden set's review cases),
 * mcp.json and the icons. Refuses to write a ZIP that fails validatePackage().
 * Reviewer credentials never go in the package: they are entered in the
 * portal's Review details form.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildManifest, validatePackage } from '../dist/plugin-package.js';
import { PROFILES } from '../dist/profile.js';
import { profileTools } from '../dist/server.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'chatgpt-plugin');
const OUT = join(ROOT, 'dist-plugin');
const STAGE = join(OUT, 'homedata');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pngSize = (p) => {
  const b = readFileSync(p);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

const manifest = buildManifest(readJson(join(SRC, 'listing.json')), readJson(join(ROOT, 'docs/chatgpt-app/golden-prompts.json')));
const assets = ['logo.png', 'logo-dark.png'].map((f) => ({ path: `./assets/${f}`, ...pngSize(join(SRC, 'assets', f)) }));
const problems = validatePackage(manifest, profileTools(PROFILES.chatgpt).map((t) => t.name), assets);
if (problems.length) {
  for (const p of problems) console.error(`- ${p}`);
  console.error('package refused');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
writeFileSync(join(STAGE, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
cpSync(join(SRC, 'mcp.json'), join(STAGE, 'mcp.json'));
cpSync(join(SRC, 'assets'), join(STAGE, 'assets'), { recursive: true });
execFileSync('zip', ['-qrX', '../homedata-chatgpt-plugin.zip', '.'], { cwd: STAGE });
console.log('wrote dist-plugin/homedata-chatgpt-plugin.zip');
