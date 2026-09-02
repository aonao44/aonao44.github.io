#!/usr/bin/env node
// data/eras/*.geojson を走査して、政体名 → 登場する断面 の索引を作る。
//
//   node scripts/build-name-eras.mjs
//
// 出力: data/name-eras.json
//   { "Roman Empire": ["bc1","100","200","300"], ... }
//   断面は時系列順。
//
// 注意: 元データの NAME は表記が揺れる（Bantu / Bantou、Saharan Pastoral Nomads /
// Saharan pastoral nomads、United States / United States of America）。
// ここでは名寄せを一切しない。別表記は別の政体として索引される。
// 勝手に統合すると、実際には別物の政体まで束ねてしまうため。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ERA_IDS } from '../src/eras.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eraDir = join(root, 'data', 'eras');

/** @type {Map<string, string[]>} */
const index = new Map();

for (const id of ERA_IDS) {
  const geo = JSON.parse(readFileSync(join(eraDir, `${id}.geojson`), 'utf8'));
  const seen = new Set();
  for (const f of geo.features ?? []) {
    const raw = f.properties?.NAME;
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (!name) continue;
    seen.add(name);
  }
  for (const name of seen) {
    if (!index.has(name)) index.set(name, []);
    index.get(name).push(id);
  }
}

// キー順を安定させる（差分を読みやすくするため）
const out = {};
for (const name of [...index.keys()].sort((a, b) => a.localeCompare(b))) {
  out[name] = index.get(name);
}

const path = join(root, 'data', 'name-eras.json');
writeFileSync(path, `${JSON.stringify(out, null, 0)}\n`);

const counts = [...index.values()].map((v) => v.length);
const total = counts.reduce((s, n) => s + n, 0);
console.log(`names: ${index.size}`);
console.log(`appearances: ${total} (avg ${(total / index.size).toFixed(1)} eras per name)`);
console.log(`longest-lived:`);
[...index.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 8)
  .forEach(([n, eras]) => console.log(`  ${eras.length}  ${n}  ${eras[0]}..${eras[eras.length - 1]}`));
console.log(`wrote ${path}`);
