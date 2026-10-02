#!/usr/bin/env node
/**
 * Build a ChatGPT plugin ZIP for OpenAI's plugin portal:
 *
 *   npm run build && node scripts/package-chatgpt-plugin.mjs [homedata|home]
 *
 * homedata (the default) writes dist-plugin/homedata-chatgpt-plugin.zip from
 * chatgpt-plugin/; home writes dist-plugin/home-chatgpt-plugin.zip from
 * home-chatgpt-plugin/. Each holds plugin.json (built from listing.json plus
 * the golden set's review cases), mcp.json, the icons and any skills. Refuses
 * to write a ZIP that fails validatePackage() or validateSkills(). Reviewer
 * credentials never go in the package: they are entered in the portal's Review
 * details form.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOME_RULES } from '../dist/home/plugin.js';
import { HOME_TOOLS } from '../dist/home/server.js';
import { buildManifest, HOMEDATA_RULES, readSkills, validatePackage, validateSkills } from '../dist/plugin-package.js';
import { PROFILES } from '../dist/profile.js';
import { profileTools } from '../dist/server.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = {
  homedata: { src: 'chatgpt-plugin', golden: 'docs/chatgpt-app/golden-prompts.json', tools: () => profileTools(PROFILES.chatgpt), rules: HOMEDATA_RULES },
  home: { src: 'home-chatgpt-plugin', golden: 'docs/home-chatgpt-app/golden-prompts.json', tools: () => HOME_TOOLS, rules: HOME_RULES },
};

const which = process.argv[2] ?? 'homedata';
const plugin = PLUGINS[which];
if (!plugin) {
  console.error(`usage: node scripts/package-chatgpt-plugin.mjs [${Object.keys(PLUGINS).join('|')}]`);
  process.exit(2);
}

const SRC = join(ROOT, plugin.src);
const OUT = join(ROOT, 'dist-plugin');
const STAGE = join(OUT, which);
const ZIP = `${which}-chatgpt-plugin.zip`;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pngSize = (p) => {
  const b = readFileSync(p);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

const manifest = buildManifest(readJson(join(SRC, 'listing.json')), readJson(join(ROOT, plugin.golden)));
const assets = readdirSync(join(SRC, 'assets')).filter((f) => f.endsWith('.png')).map((f) => ({ path: `./assets/${f}`, ...pngSize(join(SRC, 'assets', f)) }));
const tools = plugin.tools();
const skills = readSkills(SRC);
const mcpUrl = Object.values(readJson(join(SRC, 'mcp.json')).mcpServers)[0].url;
const problems = [
  ...validatePackage(manifest, tools.map((t) => t.name), assets, plugin.rules),
  ...(skills.length ? validateSkills(skills, tools, plugin.rules, mcpUrl) : []),
];
if (problems.length) {
  for (const p of problems) console.error(`- ${p}`);
  console.error('package refused');
  process.exit(1);
}

rmSync(STAGE, { recursive: true, force: true });
rmSync(join(OUT, ZIP), { force: true });
mkdirSync(STAGE, { recursive: true });
writeFileSync(join(STAGE, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
cpSync(join(SRC, 'mcp.json'), join(STAGE, 'mcp.json'));
cpSync(join(SRC, 'assets'), join(STAGE, 'assets'), { recursive: true });
if (existsSync(join(SRC, 'skills'))) cpSync(join(SRC, 'skills'), join(STAGE, 'skills'), { recursive: true });
execFileSync('zip', ['-qrX', `../${ZIP}`, '.'], { cwd: STAGE });
console.log(`wrote dist-plugin/${ZIP}`);
