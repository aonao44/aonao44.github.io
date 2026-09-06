import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { compileNonStateRule, isNonState, EMPTY_RULE } from '../src/nonstate.js';
import * as eventModule from '../src/events.js';
import { eventsForEra } from '../src/events.js';
import {
  decorateEra, colorForName, strokeForName, hueForName,
  WATER_HUE_MIN, WATER_HUE_MAX, NONSTATE_FILL, NONSTATE_STROKE,
} from '../src/layers.js';
import { ERAS, ERA_COUNT, formatYear } from '../src/eras.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

// --- 非国家判定 ---

test('isNonState matches subsistence-mode and culture names', () => {
  const rule = compileNonStateRule({ patterns: ['hunter', 'culture', 'nomad'], explicit: ['Bantu'] });
  assert.equal(isNonState('Amazon hunter-gatherers', rule), true);
  assert.equal(isNonState('Yamnaya culture', rule), true);
  assert.equal(isNonState('Saharan pastoral Nomads', rule), true, 'match must be case-insensitive');
  assert.equal(isNonState('Bantu', rule), true, 'explicit list');
});

test('isNonState leaves real polities alone', () => {
  const rule = compileNonStateRule({ patterns: ['hunter', 'culture', 'nomad'], explicit: ['Bantu'] });
  for (const name of ['Roman Empire', 'Qing Empire', 'Mongol Empire', 'France', 'Abbasid Caliphate']) {
    assert.equal(isNonState(name, rule), false, `${name} must stay a state`);
  }
});

test('isNonState honours the exceptions list over patterns', () => {
  const rule = compileNonStateRule({ patterns: ['culture'], exceptions: ['Culture Kingdom'] });
  assert.equal(isNonState('Culture Kingdom', rule), false);
  assert.equal(isNonState('Other culture', rule), true);
});

test('isNonState is safe with missing name or rule', () => {
  const rule = compileNonStateRule(EMPTY_RULE);
  assert.equal(isNonState(null, rule), false);
  assert.equal(isNonState('', rule), false);
  assert.equal(isNonState('Anything', rule), false, 'empty rule classifies nothing');
  assert.equal(isNonState('Anything', null), false);
});

// --- 実データの規則 ---

test('the shipped rule classifies the known non-state names', () => {
  const rule = compileNonStateRule(readJson('data/nonstate.json'));
  const nonState = [
    'Archaic Amerindian hunter-gatherers',
    'Saharan pastoral nomads',
    'Australian aboriginal hunter-gatherers',
    'Yamnaya culture',
    'Bantu',
    'Ainu',
    'Afanasevo',
    'Aboriginal tribes',
    'West African cereal farmers',
  ];
  for (const n of nonState) assert.equal(isNonState(n, rule), true, `${n} should be non-state`);
});

test('the shipped rule never greys out a major empire', () => {
  const rule = compileNonStateRule(readJson('data/nonstate.json'));
  const states = [
    'Roman Empire', 'Roman Republic', 'Byzantine Empire', 'Achaemenid Empire',
    'Han Empire', 'Qin', 'Tang Empire', 'Song Empire', 'Qing Empire', 'Ming Chinese Empire',
    'Mongol Empire', 'Ottoman Empire', 'Abbasid Caliphate', 'Umayyad Caliphate',
    'Mauryan Empire', 'Gupta Empire', 'Sasanian Empire', 'Parthian Empire',
    'Inca Empire', 'Aztec Empire', 'Holy Roman Empire', 'USSR', 'Russian Empire',
    'Chinese Warlords', 'Chinese warlords',
  ];
  for (const n of states) assert.equal(isNonState(n, rule), false, `${n} must render as a state`);
});

test('the shipped rule classifies a small minority, not most of the map', () => {
  const rule = compileNonStateRule(readJson('data/nonstate.json'));
  const names = Object.keys(readJson('data/names.ja.json'));
  const matched = names.filter((n) => isNonState(n, rule));
  // 非国家は一部であるべき。半分を超えたら規則が広すぎる
  assert.ok(matched.length > 50, `expected a meaningful number of non-state names, got ${matched.length}`);
  assert.ok(
    matched.length < names.length * 0.25,
    `rule is too broad: ${matched.length}/${names.length} classified non-state`,
  );
});

// --- decorateEra ---

test('decorateEra marks non-state features and keeps colours stable', () => {
  const rule = readJson('data/nonstate.json');
  const out = decorateEra({
    features: [
      { properties: { NAME: 'Roman Empire' } },
      { properties: { NAME: 'Amazon hunter-gatherers' } },
    ],
  }, rule);
  assert.equal(out.features[0].properties._nonstate, false);
  assert.equal(out.features[1].properties._nonstate, true);
  assert.equal(out.features[0].properties._color, colorForName('Roman Empire'));
  assert.equal(out.features[0].properties._stroke, strokeForName('Roman Empire'));
});

test('decorateEra defaults to classifying nothing when no rule is given', () => {
  const out = decorateEra({ features: [{ properties: { NAME: 'Amazon hunter-gatherers' } }] });
  assert.equal(out.features[0].properties._nonstate, false);
});

test('fill and stroke share the hue so the outline is a darker shade', () => {
  for (const name of ['Roman Empire', 'Han', 'Mongol Empire']) {
    const hue = hueForName(name);
    assert.match(colorForName(name), new RegExp(`^hsl\\(${hue}, `));
    assert.match(strokeForName(name), new RegExp(`^hsl\\(${hue}, `));
    const fillL = Number(/(\d+)%\)$/.exec(colorForName(name))[1]);
    const strokeL = Number(/(\d+)%\)$/.exec(strokeForName(name))[1]);
    assert.ok(strokeL < fillL, `stroke must be darker than fill for ${name}`);
  }
});

test('colours are saturated enough to tell polities apart', () => {
  const sat = Number(/hsl\(\d+, (\d+)%/.exec(colorForName('Roman Empire'))[1]);
  assert.ok(sat >= 60, `fill saturation should be strong, got ${sat}%`);
});

// --- 非国家は無彩色 ---

const saturationOf = (hsl) => Number(/hsl\(\d+, (\d+)%/.exec(hsl)[1]);

test('the non-state palette is achromatic and darker on the outline', () => {
  assert.equal(saturationOf(NONSTATE_FILL), 0, 'fill must be achromatic');
  assert.equal(saturationOf(NONSTATE_STROKE), 0, 'stroke must be achromatic');
  const light = (hsl) => Number(/(\d+)%\)$/.exec(hsl)[1]);
  assert.ok(light(NONSTATE_STROKE) < light(NONSTATE_FILL), 'outline must stay darker than fill');
});

test('colorForName ignores a stray second argument from Array.map', () => {
  // 真偽値の第2引数を足すと names.map(colorForName) がインデックスを渡し、
  // 2件目以降が黙って非国家扱いになる。その退行を固定する。
  const names = ['Roman Empire', 'Han Empire', 'Mongol Empire', 'Ottoman Empire'];
  assert.equal(new Set(names.map(colorForName)).size, names.length);
  assert.equal(new Set(names.map(strokeForName)).size, names.length);
});

test('decorateEra hands the non-state verdict to the colours it bakes in', () => {
  const rule = readJson('data/nonstate.json');
  const out = decorateEra({
    features: [
      { properties: { NAME: 'Amazon hunter-gatherers' } },
      { properties: { NAME: 'Roman Empire' } },
    ],
  }, rule);

  const [culture, empire] = out.features.map((f) => f.properties);
  assert.equal(culture._nonstate, true);
  assert.equal(saturationOf(culture._color), 0, 'a culture must not be tinted');
  assert.equal(saturationOf(culture._stroke), 0);
  assert.equal(empire._nonstate, false);
  assert.ok(saturationOf(empire._color) >= 60, 'an empire keeps its identifying hue');
});

test('every non-state culture in the real corpus comes out achromatic', () => {
  const rule = readJson('data/nonstate.json');
  const compiled = compileNonStateRule(rule);
  const names = Object.keys(readJson('data/names.ja.json'));
  const cultures = names.filter((name) => isNonState(name, compiled));
  assert.ok(cultures.length > 100, `the corpus must contain cultures, found ${cultures.length}`);

  const decorated = decorateEra(
    { features: cultures.map((NAME) => ({ properties: { NAME } })) },
    rule,
  );
  const tinted = decorated.features
    .filter((f) => saturationOf(f.properties._color) !== 0
      || saturationOf(f.properties._stroke) !== 0)
    .map((f) => f.properties.NAME);

  assert.deepEqual(tinted, [], 'these cultures would still be tinted');
});

// --- 海の青は政体に使わない ---

test('no polity in the whole corpus is given a hue reserved for the sea', () => {
  const names = Object.keys(readJson('data/names.ja.json'));
  assert.ok(names.length > 2000, 'the real corpus must be exercised');

  const clashes = names.filter((name) => {
    const hue = hueForName(name);
    return hue >= WATER_HUE_MIN && hue <= WATER_HUE_MAX;
  });
  assert.deepEqual(clashes, [], 'these polities would be coloured like the sea');
});

test('the reserved band is skipped, not clamped onto its edges', () => {
  // 帯を「端に丸める」実装だと WATER_HUE_MIN-1 / WATER_HUE_MAX+1 に山ができる。
  const counts = new Map();
  for (let i = 0; i < 20000; i += 1) {
    const hue = hueForName(`synthetic polity ${i}`);
    assert.ok(hue >= 0 && hue < 360, `hue out of range: ${hue}`);
    assert.ok(
      hue < WATER_HUE_MIN || hue > WATER_HUE_MAX,
      `hue ${hue} fell inside the sea band`,
    );
    counts.set(hue, (counts.get(hue) ?? 0) + 1);
  }
  const edges = (counts.get(WATER_HUE_MIN - 1) ?? 0) + (counts.get(WATER_HUE_MAX + 1) ?? 0);
  const typical = 20000 / (360 - (WATER_HUE_MAX - WATER_HUE_MIN + 1));
  assert.ok(edges < typical * 6, `hues piled up on the band edges: ${edges}`);
});

test('the sea colours in the legend and the map sit inside the reserved band', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const app = readFileSync(join(root, 'app.js'), 'utf8');

  const hues = [
    ...html.matchAll(/\.lg-sea\s*\{[^}]*?hsl\((\d+),/gs),
    ...app.matchAll(/WATER_(?:FILL|LABEL)_COLOR\s*=\s*'hsl\((\d+),/g),
  ].map((m) => Number(m[1]));

  assert.equal(hues.length, 3, 'expected the legend swatch plus both map colours');
  for (const hue of hues) {
    assert.ok(
      hue >= WATER_HUE_MIN && hue <= WATER_HUE_MAX,
      `sea colour hue ${hue} is outside the reserved band`,
    );
  }
});

// --- 出来事 ---

test('eventsForEra takes events after the previous era up to this one', () => {
  const events = [
    { year: -3500 }, { year: -2500 }, { year: -1800 }, { year: -1500 }, { year: 100 },
  ];
  // index 1 = bc2000 -> (bc3000, bc2000] = (-3000, -2000]
  const at1 = eventsForEra(1, events);
  assert.deepEqual(at1.map((e) => e.year), [-2500]);
  // index 2 = bc1500 -> (-2000, -1500]
  assert.deepEqual(eventsForEra(2, events).map((e) => e.year), [-1800, -1500]);
});

test('eventsForEra collects everything before the first era into it', () => {
  const events = [{ year: -9000 }, { year: -3500 }, { year: -3000 }, { year: -2999 }];
  const first = eventsForEra(0, events);
  assert.deepEqual(first.map((e) => e.year), [-9000, -3500, -3000]);
});

test('eventsForEra returns results sorted by year and skips malformed entries', () => {
  const events = [{ year: 1500 }, { year: 1492 }, { year: null }, {}, { year: NaN }];
  const out = eventsForEra(28, events); // index 28 = 1500 -> (1492, 1500]
  assert.deepEqual(out.map((e) => e.year), [1500]);
});

test('eventsForEra clamps out-of-range indexes and handles no events', () => {
  assert.deepEqual(eventsForEra(0, []), []);
  assert.deepEqual(eventsForEra(999, []), []);
  assert.deepEqual(eventsForEra(-5, [{ year: -5000 }]).map((e) => e.year), [-5000]);
});

test('events share the canonical year formatter instead of duplicating it', () => {
  assert.equal('eventYearLabel' in eventModule, false);
  assert.equal(formatYear(-753), '紀元前753年');
  assert.equal(formatYear(1492), '1492年');
});

// --- 同梱データ ---

test('events.json is well formed', () => {
  const events = readJson('data/events.json');
  assert.ok(events.length >= 100, `expected ~100 events, got ${events.length}`);
  const len = (s) => Array.from(String(s)).length;
  events.forEach((e, i) => {
    assert.ok(Number.isInteger(e.year) && e.year !== 0, `event ${i}: bad year ${e.year}`);
    assert.ok(e.lat >= -90 && e.lat <= 90, `event ${i}: bad lat ${e.lat}`);
    assert.ok(e.lng >= -180 && e.lng <= 180, `event ${i}: bad lng ${e.lng}`);
    assert.ok(len(e.title_ja) > 0 && len(e.title_ja) <= 20, `event ${i}: title length`);
    assert.ok(len(e.summary_ja) > 0 && len(e.summary_ja) <= 80, `event ${i}: summary length`);
    assert.match(e.source_url, /^https:\/\/ja\.wikipedia\.org\/wiki\//, `event ${i}: source_url`);
    if (i > 0) assert.ok(events[i - 1].year <= e.year, `event ${i}: not sorted`);
  });
});

test('every era has at least one era-bucket covered across the timeline', () => {
  const events = readJson('data/events.json');
  const covered = ERAS.filter((_, i) => eventsForEra(i, events).length > 0).length;
  // 全断面に出来事がある必要はないが、半分以上は埋まっていてほしい
  assert.ok(covered > ERA_COUNT / 2, `only ${covered}/${ERA_COUNT} eras have events`);
});

test('names.ja.json covers every NAME and has Japanese values', () => {
  const names = readJson('data/names.ja.json');
  const keys = Object.keys(names);
  assert.equal(keys.length, 2548, 'expected every distinct NAME to be translated');
  const hasJa = (s) => /[ぁ-んァ-ヶ一-龯]/.test(s);
  const bad = keys.filter((k) => typeof names[k] !== 'string' || !hasJa(names[k]));
  assert.deepEqual(bad, [], 'every value must contain Japanese characters');
  assert.equal(names['Roman Empire'], 'ローマ帝国');
  assert.equal(names['Byzantine Empire'], 'ビザンツ帝国');
  assert.equal(names.Han, '漢');
});

test('modern.json values are non-empty arrays of Japanese country names', () => {
  const modern = readJson('data/modern.json');
  const keys = Object.keys(modern);
  assert.ok(keys.length >= 150, `expected >= 150 entries, got ${keys.length}`);
  for (const k of keys) {
    assert.ok(Array.isArray(modern[k]) && modern[k].length > 0, `${k}: bad value`);
    for (const v of modern[k]) assert.ok(typeof v === 'string' && v.trim(), `${k}: bad entry`);
  }
  assert.ok(modern['Roman Empire'].includes('イタリア'));
});
