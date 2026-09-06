#!/usr/bin/env node
// historical-basemaps 原典に混入している、宗主名ではない数値 SUBJECTO を補正する。
// 通常の綴り揺れは data/subject-aliases.json で表示時に正規化するが、"1" / "3" は
// 政体名ではないためそこへ混ぜず、出典・断面・feature の組を限定して null にする。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 原典 world_100.geojson では NAME:null / SUBJECTO:"1" / PARTOF:"true" の広域面。
// world_1783.geojson では Lombardy と Bhutan がともに SUBJECTO:"3" なのに、PARTOF は
// それぞれ自身の NAME。さらに海南島の NAME:null feature にも同じ "3" が付く。
// 地理的・属性的に共通の宗主を表さない原典アーティファクトなので、この4件だけを補正する。
const INVALID_NUMERIC_SUBJECTS = Object.freeze({
  100: new Map([[null, '1']]),
  1783: new Map([['Lombardy', '3'], ['Bhutan', '3'], [null, '3']]),
});

function normalizeFile(id) {
  const path = join(root, 'data', 'eras', `${id}.geojson`);
  const geojson = JSON.parse(readFileSync(path, 'utf8'));
  const expected = INVALID_NUMERIC_SUBJECTS[id] ?? new Map();
  let changed = 0;

  for (const feature of geojson.features ?? []) {
    const subject = feature.properties?.SUBJECTO;
    if (!/^\d+$/.test(String(subject ?? ''))) continue;
    const name = feature.properties?.NAME ?? null;
    if (expected.get(name) !== subject) {
      throw new Error(`${id}: unexpected numeric SUBJECTO ${JSON.stringify(subject)} on ${JSON.stringify(name)}`);
    }
    feature.properties.SUBJECTO = null;
    changed += 1;
  }

  // mapshaper の既存形式（feature 1件 = 1行）を保ち、巨大な整形差分を作らない。
  const serialized = '{"type":"FeatureCollection", "features": [\n'
    + `${geojson.features.map((feature) => JSON.stringify(feature)).join(',\n')}\n]}`
    + '\n';
  if (changed) writeFileSync(path, serialized);
  console.log(`${id}: normalized ${changed} numeric SUBJECTO value(s)`);
}

const ids = process.argv.slice(2);
if (!ids.length) throw new Error('usage: node scripts/normalize-era-data.mjs <era> [...]');
ids.forEach(normalizeFile);
