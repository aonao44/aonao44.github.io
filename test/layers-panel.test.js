import test from 'node:test';
import assert from 'node:assert/strict';

import { colorForName, hashString, decorateEra } from '../src/layers.js';
import { buildPanelModel, modernCountries, japaneseName, MODERN_FALLBACK } from '../src/panel.js';

test('hashString is deterministic and differs across inputs', () => {
  assert.equal(hashString('Roman Empire'), hashString('Roman Empire'));
  assert.notEqual(hashString('Roman Empire'), hashString('Han Empire'));
});

test('same NAME gets the same color across eras (spec: 色の一貫性)', () => {
  // 別々の断面に現れた同名ポリゴンを模す
  const a = decorateEra({ features: [{ properties: { NAME: 'Roman Empire' } }] });
  const b = decorateEra({ features: [{ properties: { NAME: 'Roman Empire' }, geometry: null }] });
  assert.equal(a.features[0].properties._color, b.features[0].properties._color);
  assert.equal(a.features[0].properties._color, colorForName('Roman Empire'));
});

test('different NAMEs generally get different colors', () => {
  const names = ['Roman Empire', 'Han Empire', 'Mongol Empire', 'Ottoman Empire', 'Egypt'];
  const colors = new Set(names.map(colorForName));
  assert.equal(colors.size, names.length);
});

test('colorForName is a valid hsl string and handles missing names', () => {
  assert.match(colorForName('Persia'), /^hsl\(\d{1,3}, \d{1,3}%, \d{1,3}%\)$/);
  assert.match(colorForName(null), /^hsl\(/);
  assert.match(colorForName(undefined), /^hsl\(/);
  assert.match(colorForName(''), /^hsl\(/);
});

test('decorateEra preserves original properties and does not mutate input', () => {
  const input = { features: [{ properties: { NAME: 'Qin', SUBJECTO: 'Qin', BORDERPRECISION: 2 } }] };
  const out = decorateEra(input);
  assert.equal(out.features[0].properties.SUBJECTO, 'Qin');
  assert.equal(out.features[0].properties.BORDERPRECISION, 2);
  assert.equal(input.features[0].properties._color, undefined, 'input must not be mutated');
});

test('decorateEra tolerates empty / missing collections', () => {
  assert.deepEqual(decorateEra({ features: [] }).features, []);
  assert.deepEqual(decorateEra({}).features, []);
  assert.deepEqual(decorateEra(null).features, []);
});

test('japaneseName falls back to the English name when untranslated', () => {
  assert.equal(japaneseName('Roman Empire', { 'Roman Empire': 'ローマ帝国' }), 'ローマ帝国');
  assert.equal(japaneseName('Blemmyes', {}), 'Blemmyes');
  assert.equal(japaneseName(null, {}), null);
});

test('modernCountries joins a list and falls back when unregistered', () => {
  const modern = { 'Roman Empire': ['イタリア', 'フランス'], Persia: 'イラン', Empty: [] };
  assert.equal(modernCountries('Roman Empire', modern), 'イタリア、フランス');
  assert.equal(modernCountries('Persia', modern), 'イラン');
  assert.equal(modernCountries('Empty', modern), MODERN_FALLBACK);
  assert.equal(modernCountries('Unknown', modern), MODERN_FALLBACK);
  assert.equal(modernCountries(null, modern), MODERN_FALLBACK);
});

test('buildPanelModel drops SUBJECTO when it points at the polity itself', () => {
  const self = buildPanelModel({ NAME: 'Austronesians', SUBJECTO: 'Austronesians' });
  assert.equal(self.subjectEn, null, 'self-referential SUBJECTO is not an overlord');

  const vassal = buildPanelModel({ NAME: 'Judaea', SUBJECTO: 'Roman Empire' });
  assert.equal(vassal.subjectEn, 'Roman Empire');
});

test('buildPanelModel resolves names and modern countries together', () => {
  const m = buildPanelModel(
    { NAME: 'Roman Empire', SUBJECTO: null },
    { namesJa: { 'Roman Empire': 'ローマ帝国' }, modern: { 'Roman Empire': ['イタリア'] } },
  );
  assert.equal(m.nameJa, 'ローマ帝国');
  assert.equal(m.nameEn, 'Roman Empire');
  assert.equal(m.hasTranslation, true);
  assert.equal(m.modern, 'イタリア');
});

test('buildPanelModel handles a nameless polygon', () => {
  const m = buildPanelModel({ NAME: null });
  assert.equal(m.nameEn, null);
  assert.equal(m.nameJa, null);
  assert.equal(m.modern, MODERN_FALLBACK);
  assert.equal(buildPanelModel(null).nameEn, null);
});
