import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { interiorPoint, pointInRing, buildLabelFeatures } from '../src/labelpoint.js';
import { decorateEra, geometryArea } from '../src/layers.js';
import { ERA_IDS } from '../src/eras.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];

test('pointInRing detects inside and outside', () => {
  const ring = square(0, 0, 10);
  assert.equal(pointInRing([5, 5], ring), true);
  assert.equal(pointInRing([15, 5], ring), false);
  assert.equal(pointInRing([-1, 5], ring), false);
});

test('interiorPoint returns the centroid of a convex polygon', () => {
  const p = interiorPoint({ type: 'Polygon', coordinates: [square(0, 0, 10)] });
  assert.ok(p);
  assert.ok(p[0] > 0 && p[0] < 10 && p[1] > 0 && p[1] < 10);
});

test('interiorPoint stays inside a C-shaped polygon whose centroid is outside', () => {
  // 中央が右に開いたコの字。重心はくぼみ(外)に落ちる
  const c = [
    [0, 0], [10, 0], [10, 3], [3, 3], [3, 7], [10, 7], [10, 10], [0, 10], [0, 0],
  ];
  const geom = { type: 'Polygon', coordinates: [c] };
  const p = interiorPoint(geom);
  assert.ok(p, 'must return a point');
  assert.equal(pointInRing(p, c), true, `point ${JSON.stringify(p)} fell outside the polygon`);
});

test('interiorPoint avoids holes', () => {
  const outer = square(0, 0, 20);
  const hole = square(5, 5, 10);
  const p = interiorPoint({ type: 'Polygon', coordinates: [outer, hole] });
  assert.ok(p);
  assert.equal(pointInRing(p, outer), true);
  assert.equal(pointInRing(p, hole), false, 'label must not land in the hole');
});

test('interiorPoint picks the largest part of a MultiPolygon', () => {
  const tiny = square(100, 0, 1);
  const big = square(0, 0, 40);
  const p = interiorPoint({ type: 'MultiPolygon', coordinates: [[tiny], [big]] });
  assert.ok(p);
  assert.equal(pointInRing(p, big), true, 'label belongs on the mainland, not the islet');
});

test('interiorPoint is safe on missing or unsupported geometry', () => {
  assert.equal(interiorPoint(null), null);
  assert.equal(interiorPoint({ type: 'Point', coordinates: [0, 0] }), null);
  assert.equal(interiorPoint({ type: 'Polygon', coordinates: [] }), null);
  assert.equal(interiorPoint({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }), null);
});

test('buildLabelFeatures emits exactly one point per polity', () => {
  const features = [
    { properties: { _label: 'ローマ帝国', _area: 100, _nonstate: false }, geometry: { type: 'Polygon', coordinates: [square(0, 0, 5)] } },
    { properties: { _label: 'ローマ帝国', _area: 900, _nonstate: false }, geometry: { type: 'Polygon', coordinates: [square(20, 0, 20)] } },
    { properties: { _label: '漢', _area: 400, _nonstate: false }, geometry: { type: 'Polygon', coordinates: [square(50, 0, 10)] } },
  ];
  const fc = buildLabelFeatures(features);
  assert.equal(fc.features.length, 2, 'one label per distinct name');
  const rome = fc.features.find((f) => f.properties._label === 'ローマ帝国');
  assert.equal(rome.properties._area, 900, 'label goes on the largest piece');
  assert.equal(rome.geometry.type, 'Point');
});

test('buildLabelFeatures drops unlabelled and too-small polities', () => {
  const features = [
    { properties: { _label: '', _area: 999 }, geometry: { type: 'Polygon', coordinates: [square(0, 0, 5)] } },
    { properties: { _label: '小国', _area: 10 }, geometry: { type: 'Polygon', coordinates: [square(0, 0, 5)] } },
    { properties: { _label: '大国', _area: 5000 }, geometry: { type: 'Polygon', coordinates: [square(0, 0, 5)] } },
  ];
  const fc = buildLabelFeatures(features, 100);
  assert.deepEqual(fc.features.map((f) => f.properties._label), ['大国']);
});

test('buildLabelFeatures carries the colour and non-state flag through', () => {
  const fc = buildLabelFeatures([{
    properties: { _label: 'X', _area: 10, _nonstate: true, _stroke: 'hsl(10, 70%, 30%)' },
    geometry: { type: 'Polygon', coordinates: [square(0, 0, 5)] },
  }]);
  assert.equal(fc.features[0].properties._nonstate, true);
  assert.equal(fc.features[0].properties._stroke, 'hsl(10, 70%, 30%)');
});

test('buildLabelFeatures handles an empty input', () => {
  assert.deepEqual(buildLabelFeatures().features, []);
  assert.deepEqual(buildLabelFeatures([]).features, []);
});

// --- NAME の空白正規化 ---

test('decorateEra trims stray whitespace so translations resolve', () => {
  // 元データに実在する事例: "Pomeranian culture " (末尾に空白)
  const out = decorateEra(
    { features: [{ properties: { NAME: 'Pomeranian culture ' } }] },
    undefined,
    { 'Pomeranian culture': 'ポンメルン文化' },
  );
  assert.equal(out.features[0].properties.NAME, 'Pomeranian culture');
  assert.equal(out.features[0].properties._label, 'ポンメルン文化');
});

test('decorateEra falls back to the English name when untranslated', () => {
  const out = decorateEra({ features: [{ properties: { NAME: 'Nowhere' } }] }, undefined, {});
  assert.equal(out.features[0].properties._label, 'Nowhere');
});

test('decorateEra gives nameless polygons an empty label', () => {
  const out = decorateEra({ features: [{ properties: { NAME: null } }] });
  assert.equal(out.features[0].properties._label, '');
  const blank = decorateEra({ features: [{ properties: { NAME: '   ' } }] });
  assert.equal(blank.features[0].properties.NAME, null);
  assert.equal(blank.features[0].properties._label, '');
});

test('no era file contains a NAME whose translation is missing after trimming', () => {
  const names = readJson('data/names.ja.json');
  const missing = new Set();
  for (const id of ['bc3000', '100', '1492', '2010']) {
    const era = readJson(`data/eras/${id}.geojson`);
    for (const f of era.features) {
      const raw = f.properties?.NAME;
      if (typeof raw !== 'string' || !raw.trim()) continue;
      if (!(raw.trim() in names)) missing.add(raw);
    }
  }
  assert.deepEqual([...missing], [], 'every NAME must resolve to a Japanese label');
});

// --- 面積 ---

test('geometryArea is plausible for a known country', () => {
  const era = readJson('data/eras/2010.geojson');
  const japan = era.features.find((f) => f.properties?.NAME === 'Japan');
  assert.ok(japan, 'Japan must exist in the 2010 data');
  const km2 = geometryArea(japan.geometry);
  // 日本は約 37.8 万 km^2。簡略化とマルチポリゴンの粗さを見込んで広めに取る
  assert.ok(km2 > 200000 && km2 < 600000, `Japan area looked wrong: ${km2} km2`);
});

test('all 9,377 label points across 49 eras stay strictly inside and off outer vertices', () => {
  const names = readJson('data/names.ja.json');
  const rule = readJson('data/nonstate.json');
  let total = 0;

  const areaOfRing = (ring) => {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      sum += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
    }
    return Math.abs(sum / 2);
  };

  for (const id of ERA_IDS) {
    const decorated = decorateEra(readJson(`data/eras/${id}.geojson`), rule, names);
    const labels = buildLabelFeatures(decorated.features);
    total += labels.features.length;

    for (const label of labels.features) {
      const source = decorated.features.find((feature) => (
        feature.properties.NAME === label.properties.NAME
        && feature.properties._area === label.properties._area
      ));
      assert.ok(source, `${id}/${label.properties.NAME}: source feature missing`);

      const polygons = source.geometry.type === 'Polygon'
        ? [source.geometry.coordinates]
        : source.geometry.coordinates;
      const rings = polygons.reduce((largest, candidate) => (
        areaOfRing(candidate[0]) > areaOfRing(largest[0]) ? candidate : largest
      ));
      const point = label.geometry.coordinates;
      assert.equal(pointInRing(point, rings[0]), true, `${id}/${label.properties.NAME}: outside outer ring`);
      for (const hole of rings.slice(1)) {
        assert.equal(pointInRing(point, hole), false, `${id}/${label.properties.NAME}: inside a hole`);
      }
      assert.equal(
        rings[0].some(([x, y]) => x === point[0] && y === point[1]),
        false,
        `${id}/${label.properties.NAME}: fell back to an outer vertex`,
      );
    }
  }

  assert.equal(total, 9377, 'the full 49-era corpus must be exercised');
});

test('geometryArea returns 0 for non-polygons', () => {
  assert.equal(geometryArea(null), 0);
  assert.equal(geometryArea({ type: 'Point', coordinates: [0, 0] }), 0);
});
