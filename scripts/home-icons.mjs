#!/usr/bin/env node
/**
 * Copies the Home widget's icons, byte for byte, out of the official @phosphor-icons/core
 * package (MIT, © 2023 Phosphor Icons) into dist/home/phosphor-icons.json after each build.
 * The widget never carries a hand-written path: add an icon here, by its Phosphor file name.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = join(ROOT, 'node_modules/@phosphor-icons/core');

/** Widget key → Phosphor asset (weight/file). Regular on cards and chips, duotone on the detail key facts. */
export const HOME_ICONS = {
  prev: 'regular/caret-left',
  next: 'regular/caret-right',
  heart: 'regular/heart',
  'heart-saved': 'fill/heart-fill',
  view: 'regular/arrow-up-right',
  back: 'regular/arrow-left',
  bed: 'regular/bed',
  bath: 'regular/bathtub',
  type: 'regular/house',
  key: 'regular/key',
  flood: 'regular/drop',
  radon: 'regular/atom',
  crime: 'regular/shield',
  tax: 'regular/bank',
  fibre: 'regular/wifi-high',
  school: 'regular/graduation-cap',
  'fact-bed': 'duotone/bed-duotone',
  'fact-bath': 'duotone/bathtub-duotone',
  'fact-sofa': 'duotone/armchair-duotone',
  'fact-type': 'duotone/house-duotone',
  'fact-area': 'duotone/ruler-duotone',
  'fact-key': 'duotone/key-duotone',
  'fact-calendar': 'duotone/calendar-duotone',
  'fact-energy': 'duotone/lightning-duotone',
  'fact-tax': 'duotone/bank-duotone',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version, license } = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
  const icons = Object.fromEntries(Object.entries(HOME_ICONS).map(([key, asset]) => [key, readFileSync(join(PACKAGE, 'assets', `${asset}.svg`), 'utf8').trim()]));
  mkdirSync(join(ROOT, 'dist/home'), { recursive: true });
  writeFileSync(join(ROOT, 'dist/home/phosphor-icons.json'), JSON.stringify({ package: '@phosphor-icons/core', version, license, assets: HOME_ICONS, icons }, null, 2));
  console.error(`copied ${Object.keys(icons).length} Phosphor ${version} icons → dist/home/phosphor-icons.json`);
}
