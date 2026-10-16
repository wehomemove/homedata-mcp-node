#!/usr/bin/env node
/** tsc does not copy JSON, so the vendored manifest is copied into dist/ after each build. */
import { cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
cpSync(join(ROOT, 'src/manifest'), join(ROOT, 'dist/manifest'), { recursive: true });
console.error('copied src/manifest → dist/manifest');
// The Homemove quote widget (HTML/CSS/JS and its Homie art) is served from dist/ as-is.
cpSync(join(ROOT, 'src/homemove/widget'), join(ROOT, 'dist/homemove/widget'), { recursive: true, filter: (src) => !src.endsWith('index.html') });
console.error('copied src/homemove/widget → dist/homemove/widget');
