#!/usr/bin/env node
// data/eras/*.geojson から NAME をユニーク抽出する（対訳・modern.json の下書き用）。
//
//   node scripts/extract-names.js              # 出現断面数の多い順に NAME を出力
//   node scripts/extract-names.js --json       # {NAME: 出現断面数} を JSON で出力
//   node scripts/extract-names.js --missing    # names.ja.json に未登録の NAME だけ出力
//   node scripts/extract-names.js --count      # ユニーク件数だけ出力

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eraDir = join(root, 'data', 'eras');

const args = new Set(process.argv.slice(2));

/** @type {Map<string, number>} NAME -> 出現した断面の数 */
const counts = new Map();

const files = readdirSync(eraDir).filter((f) => f.endsWith('.geojson'));
for (const file of files) {
  const geo = JSON.parse(readFileSync(join(eraDir, file), 'utf8'));
  const seen = new Set();
  for (const f of geo.features ?? []) {
    const name = f.properties?.NAME;
    if (typeof name === 'string' && name.trim()) seen.add(name.trim());
  }
  for (const name of seen) counts.set(name, (counts.get(name) ?? 0) + 1);
}

const sorted = [...counts.entries()].sort(
  (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
);

if (args.has('--count')) {
  console.log(sorted.length);
} else if (args.has('--json')) {
  console.log(JSON.stringify(Object.fromEntries(sorted), null, 2));
} else if (args.has('--missing')) {
  const path = join(root, 'data', 'names.ja.json');
  const dict = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const missing = sorted.filter(([name]) => !(name in dict));
  for (const [name, n] of missing) console.log(`${n}\t${name}`);
  console.error(`\n${missing.length} untranslated / ${sorted.length} unique`);
} else {
  for (const [name, n] of sorted) console.log(`${n}\t${name}`);
  console.error(`\n${sorted.length} unique NAMEs across ${files.length} eras`);
}
