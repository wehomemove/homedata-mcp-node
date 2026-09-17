#!/usr/bin/env node
/** tsc does not copy JSON, so the vendored manifest is copied into dist/ after each build. */
import { cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
cpSync(join(ROOT, 'src/manifest'), join(ROOT, 'dist/manifest'), { recursive: true });
console.log('copied src/manifest → dist/manifest');
