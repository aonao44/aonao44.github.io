import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ERA_IDS } from '../src/eras.js';
import { buildPanelModel } from '../src/panel.js';
import { normalizeSubjects } from '../src/subjects.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const aliases = readJson('data/subject-aliases.json');
const names = readJson('data/names.ja.json');

test('the subject alias dictionary covers all 14 meaningful unknown spellings', () => {
  const expectedCounts = {
    'Spanish Habsburg': 19,
    UK: 9,
    USA: 5,
    'S. Xiongnu': 2,
    'Savoy-Piedmont': 2,
    '(Russian and Japanese claim)': 2,
    Suom: 1,
    Danemark: 1,
    Neterlands: 1,
    'Habsburg Austria': 1,
    Papu: 1,
    'United Kingdom of Netherlands': 1,
    'Great Britain': 1,
    Persi: 1,
  };
  const actualCounts = Object.fromEntries(Object.keys(aliases).map((key) => [key, 0]));

  for (const id of ERA_IDS) {
    const era = readJson(`data/eras/${id}.geojson`);
    for (const feature of era.features) {
      const raw = feature.properties?.SUBJECTO;
      if (raw in actualCounts) actualCounts[raw] += 1;
    }
  }
  assert.deepEqual(actualCounts, expectedCounts);
});

test('every normalized subject resolves to a translated polity name', () => {
  for (const [raw, normalized] of Object.entries(aliases)) {
    for (const subject of Array.isArray(normalized) ? normalized : [normalized]) {
      assert.ok(subject in names, `${raw} -> ${subject} has no Japanese name`);
    }
  }
});

test('no SUBJECTO remains outside the polity names and alias dictionary', () => {
  const unknown = new Map();
  for (const id of ERA_IDS) {
    const era = readJson(`data/eras/${id}.geojson`);
    for (const feature of era.features) {
      const raw = feature.properties?.SUBJECTO;
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const subject = raw.trim();
      if (subject in names || subject in aliases) continue;
      unknown.set(subject, (unknown.get(subject) ?? 0) + 1);
    }
  }
  assert.deepEqual(Object.fromEntries(unknown), {});
});

test('numeric source artifacts are fixed in generated data, not hidden by aliases', () => {
  assert.equal('1' in aliases, false);
  assert.equal('3' in aliases, false);
  const numeric = [];
  for (const id of ERA_IDS) {
    const era = readJson(`data/eras/${id}.geojson`);
    era.features.forEach((feature, index) => {
      if (/^\d+$/.test(String(feature.properties?.SUBJECTO ?? ''))) {
        numeric.push(`${id}[${index}] ${feature.properties?.NAME ?? '(nameless)'}`);
      }
    });
  }
  assert.deepEqual(numeric, []);
});

test('subject normalization preserves joint claims and removes normalized self-references', () => {
  assert.deepEqual(
    normalizeSubjects('(Russian and Japanese claim)', aliases),
    ['Russian Empire', 'Japan'],
  );
  const self = buildPanelModel(
    { NAME: 'United Kingdom', SUBJECTO: 'UK' },
    { namesJa: names, subjectAliases: aliases },
  );
  assert.equal(self.subjectEn, null);

  const claim = buildPanelModel(
    { NAME: 'Kuril Islands', SUBJECTO: '(Russian and Japanese claim)' },
    { namesJa: names, subjectAliases: aliases },
  );
  assert.equal(claim.subjectEn, 'Russian Empire / Japan');
  assert.equal(claim.subjectJa, 'ロシア帝国・日本');
});
