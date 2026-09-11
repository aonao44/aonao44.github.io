import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { ERA_IDS, ERAS, formatYear, indexOfEra } from '../src/eras.js';
import { isDrawableGeometry } from '../src/geojson.js';
import { buildEraJumpModel, buildPanelModel, renderTopics } from '../src/panel.js';
import { citedYears } from './year-utils.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const overviews = readJson('data/overviews.json');
const polityInfo = readJson('data/polity-info.json');
const nameEras = readJson('data/name-eras.json');
const len = (s) => Array.from(String(s)).length;

// --- overviews ---

test('overviews.json covers every era', () => {
  for (const id of ERA_IDS) {
    assert.equal(typeof overviews[id], 'string', `era ${id} has no overview`);
  }
  const stray = Object.keys(overviews).filter((k) => !ERA_IDS.includes(k));
  assert.deepEqual(stray, []);
});

test('every overview is 150-350 characters', () => {
  for (const id of ERA_IDS) {
    const n = len(overviews[id]);
    assert.ok(n >= 150 && n <= 350, `era ${id}: ${n} characters`);
  }
});

test('overviews are single paragraphs of Japanese prose', () => {
  for (const id of ERA_IDS) {
    const t = overviews[id];
    assert.ok(!t.includes('\n'), `era ${id} contains a newline`);
    assert.match(t, /[ぁ-んァ-ヶ一-龯]/, `era ${id} has no Japanese`);
    // 英単語（小文字を含む語）は不可。全大文字の略語(OPEC/WTO)は日本語文でも標準
    const english = t.match(/[A-Za-z]*[a-z]{2,}[A-Za-z]*/);
    assert.equal(english, null, `era ${id} contains an English word: ${english?.[0]}`);
  }
});

test('overviews do not all open with the same phrase', () => {
  const openings = ERA_IDS.map((id) => overviews[id].slice(0, 6));
  assert.ok(new Set(openings).size > ERA_IDS.length * 0.6, 'overviews are too formulaic');
});

test('an overview does not cite a year far outside its era', () => {
  const yearOf = Object.fromEntries(ERAS.map((e) => [e.id, e.year]));
  const offenders = [];
  for (const id of ERA_IDS) {
    const t = overviews[id];
    const years = citedYears(t);
    for (const y of years) {
      if (Math.abs(y - yearOf[id]) > 60) offenders.push(`${id}(${yearOf[id]}) cites ${y}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// --- polity-info ---

test('polity-info covers a useful number of polities and only real ones', () => {
  const keys = Object.keys(polityInfo);
  assert.ok(keys.length >= 200, `only ${keys.length} polities described`);
  const unknown = keys.filter((k) => !(k in nameEras));
  assert.deepEqual(unknown, [], 'every described polity must exist somewhere in the era data');
});

test('every polity entry has a summary; a period is optional', () => {
  const allowed = new Set(['summary_ja', 'period_ja', 'capital_ja', 'name_ja']);
  for (const [k, v] of Object.entries(polityInfo)) {
    assert.equal(typeof v.summary_ja, 'string', `${k}: summary_ja`);
    // 長さの厳密な検査は coverage.test.js 側に集約した（長い尾は短い記述が正しい）
    assert.ok(len(v.summary_ja) >= 25, `${k}: summary is only ${len(v.summary_ja)} chars`);
    // period_ja は任意。無名の政体では「年代を捏造しない」ことの方が大事なので、
    // 省略が正しい振る舞いになる（長い尾の大半は省略されている）。
    if (v.period_ja !== undefined) {
      assert.ok(typeof v.period_ja === 'string' && v.period_ja.trim(), `${k}: bad period_ja`);
    }
    const stray = Object.keys(v).filter((x) => !allowed.has(x));
    assert.deepEqual(stray, [], `${k}: unexpected fields`);
    for (const opt of ['period_ja', 'capital_ja', 'name_ja']) {
      if (v[opt] !== undefined) assert.ok(typeof v[opt] === 'string' && v[opt].trim(), `${k}: ${opt}`);
    }
  }
});

test('polity summaries are Japanese, not English', () => {
  for (const [k, v] of Object.entries(polityInfo)) {
    const english = v.summary_ja.match(/[A-Za-z]*[a-z]{3,}[A-Za-z]*/);
    assert.equal(english, null, `${k}: English in summary: ${english?.[0]}`);
  }
});

test('the major polities are all described', () => {
  const majors = [
    'Roman Empire', 'Byzantine Empire', 'Achaemenid Empire', 'Sasanian Empire',
    'Han', 'Qin', 'Tang Empire', 'Song Empire', 'Qing Empire', 'Mongol Empire',
    'Ottoman Empire', 'Abbasid Caliphate', 'Mauryan Empire', 'Gupta Empire',
    'Inca Empire', 'Aztec Empire', 'Holy Roman Empire', 'Carthage',
  ];
  const missing = majors.filter((m) => !(m in polityInfo));
  assert.deepEqual(missing, []);
});

test('name_ja overrides do not contradict the era range they cover', () => {
  // 「満洲帝国」は満洲国(1932-45)を指す語なので、清の断面には使わない
  assert.equal(polityInfo['Manchu Empire'].name_ja, '清');
  // 近代マケドニアは1994年以降の断面にしか出ない
  assert.deepEqual(nameEras.Macedonia, ['1994', '2000', '2010']);
  assert.equal(polityInfo.Macedonia.name_ja, '北マケドニア');
});

// --- name-eras ---

test('name-eras lists every distinct drawable NAME with eras in chronological order', () => {
  const names = Object.keys(nameEras);
  assert.equal(names.length, 2546);
  for (const [name, eras] of Object.entries(nameEras)) {
    assert.ok(Array.isArray(eras) && eras.length > 0, `${name}: no eras`);
    assert.equal(new Set(eras).size, eras.length, `${name}: duplicate eras`);
    const indexes = eras.map((e) => indexOfEra(e));
    assert.ok(indexes.every((i) => i >= 0), `${name}: unknown era id`);
    for (let i = 1; i < indexes.length; i += 1) {
      assert.ok(indexes[i] > indexes[i - 1], `${name}: eras out of order`);
    }
  }
});

test('name-eras agrees with drawable geometry in all 48 era files', () => {
  const expected = {};
  for (const id of ERA_IDS) {
    const era = readJson(`data/eras/${id}.geojson`);
    const inFile = new Set(
      era.features.filter((f) => isDrawableGeometry(f.geometry))
        .map((f) => f.properties?.NAME)
        .filter((n) => typeof n === 'string' && n.trim())
        .map((n) => n.trim()),
    );
    for (const name of inFile) {
      (expected[name] ??= []).push(id);
    }
  }
  assert.deepEqual(nameEras, Object.fromEntries(
    Object.entries(expected).sort(([a], [b]) => a.localeCompare(b)),
  ));
});

test('spelling drift is left unmerged, as documented', () => {
  // 表記揺れは別政体として索引される。統合しないことを明示的に固定する
  assert.ok(nameEras.Bantu, 'Bantu missing');
  assert.ok(nameEras.Bantou, 'Bantou missing');
  assert.notDeepEqual(nameEras.Bantu, nameEras.Bantou);
});

// --- era jump model ---

const yearOfEra = (id) => ERAS[indexOfEra(id)]?.year ?? 0;

test('buildEraJumpModel describes the span and neighbours', () => {
  const m = buildEraJumpModel('Roman Empire', nameEras, '100', yearOfEra, formatYear);
  assert.ok(m);
  assert.equal(m.count, nameEras['Roman Empire'].length);
  assert.equal(m.first, nameEras['Roman Empire'][0]);
  assert.equal(m.last, nameEras['Roman Empire'].slice(-1)[0]);
  assert.match(m.label, /断面）$/);
});

test('buildEraJumpModel marks the ends so the buttons can disable', () => {
  const eras = { X: ['bc1', '100', '200'] };
  const first = buildEraJumpModel('X', eras, 'bc1', yearOfEra, formatYear);
  assert.equal(first.atFirst, true);
  assert.equal(first.prev, null);
  assert.equal(first.next, '100');

  const last = buildEraJumpModel('X', eras, '200', yearOfEra, formatYear);
  assert.equal(last.atLast, true);
  assert.equal(last.next, null);
  assert.equal(last.prev, '100');
});

test('buildEraJumpModel works from an era the polity is absent from', () => {
  // 政体が居ない断面(300年)から見ても、前後の登場断面を出せること
  const m = buildEraJumpModel('X', { X: ['bc1', '100'] }, '300', yearOfEra, formatYear);
  assert.equal(m.prev, '100', 'previous appearance');
  assert.equal(m.next, null, 'nothing later');
  assert.equal(m.atFirst, false);
  assert.equal(m.atLast, false);
});

test('buildEraJumpModel collapses a single-era polity', () => {
  const m = buildEraJumpModel('X', { X: ['1492'] }, '1492', yearOfEra, formatYear);
  assert.equal(m.count, 1);
  assert.equal(m.rangeLabel, '1492年');
  assert.equal(m.atFirst, true);
  assert.equal(m.atLast, true);
});

test('buildEraJumpModel returns null when there is nothing to navigate', () => {
  assert.equal(buildEraJumpModel(null, nameEras, '100', yearOfEra, formatYear), null);
  assert.equal(buildEraJumpModel('Nowhere', {}, '100', yearOfEra, formatYear), null);
});

// --- panel integration ---

test('buildPanelModel prefers a polity-info name override', () => {
  const m = buildPanelModel({ NAME: 'Manchu Empire' }, {
    namesJa: { 'Manchu Empire': '後金' },
    polityInfo: { 'Manchu Empire': { name_ja: '清', summary_ja: 'x', period_ja: 'y' } },
  });
  assert.equal(m.nameJa, '清');
  assert.equal(m.info.period_ja, 'y');
});

test('buildPanelModel falls back cleanly with no polity-info', () => {
  const m = buildPanelModel({ NAME: 'Roman Empire' }, { namesJa: { 'Roman Empire': 'ローマ帝国' } });
  assert.equal(m.nameJa, 'ローマ帝国');
  assert.equal(m.info, null);
});

test('renderTopics puts the overview above the topic list', () => {
  const el = { innerHTML: '', prepend() {} };
  renderTopics(el, '100年', [
    { title_ja: 'T', body_ja: 'B', wiki_url: 'https://ja.wikipedia.org/wiki/X' },
  ], {}, 'この時代の概説テキスト');
  assert.match(el.innerHTML, /この時代の世界/);
  assert.match(el.innerHTML, /この時代の概説テキスト/);
  assert.ok(
    el.innerHTML.indexOf('概説テキスト') < el.innerHTML.indexOf('topics-list'),
    'overview must come before the topic list',
  );
});

test('renderTopics omits the overview block when there is none', () => {
  const el = { innerHTML: '', prepend() {} };
  renderTopics(el, '100年', [], {}, '');
  assert.ok(!el.innerHTML.includes('この時代の世界'));
});

// --- 地図より後に起きたこと ---
// 断面は指定年より前へ寄るので、地図は指定年時点の世界と食い違う。
// 紀元前220年を求めた読者に紀元前300年の分裂した中国を見せて秦の統一に
// 触れないのは、事実として誤った印象を与える。

const fakeYear = (y) => (y < 0 ? `紀元前${Math.abs(y)}年` : `${y}年`);

test('renderTopics leads with what changed after the map it is showing', () => {
  const el = { innerHTML: '', prepend() {} };
  renderTopics(el, '紀元前300年', [
    { title_ja: 'T', body_ja: 'B', wiki_url: 'https://ja.wikipedia.org/wiki/X' },
  ], {}, 'この時代の概説', {
    askedLabel: '紀元前220年',
    formatYear: fakeYear,
    events: [{
      year: -221,
      title_ja: '秦の中国統一',
      summary_ja: '秦王政が中国全土を統一し、始皇帝として中央集権的な統一帝国を築いた。',
      source_url: 'https://ja.wikipedia.org/wiki/秦',
    }],
  });

  assert.match(el.innerHTML, /この地図は紀元前300年のものです/, '地図がいつのものか言っていない');
  assert.match(el.innerHTML, /紀元前220年までに/, '読者が求めた年を言っていない');
  assert.match(el.innerHTML, /秦の中国統一/);
  assert.match(el.innerHTML, /紀元前221年/, '出来事の年が出ていない');
  assert.match(el.innerHTML, /始皇帝/, '何が起きたのか説明していない');
  assert.match(el.innerHTML, /ja\.wikipedia\.org/, '出典が無い');
  assert.ok(
    el.innerHTML.indexOf('秦の中国統一') < el.innerHTML.indexOf('この時代の概説'),
    '地図と食い違う内容なので、概説より前に出す',
  );
});

test('renderTopics stays quiet when the map is the year that was asked for', () => {
  const el = { innerHTML: '', prepend() {} };
  renderTopics(el, '紀元前300年', [], {}, '概説', null);
  assert.ok(!el.innerHTML.includes('この地図は'), '寄せていないのに注意書きが出ている');

  const empty = { innerHTML: '', prepend() {} };
  renderTopics(empty, '紀元前300年', [], {}, '概説',
    { askedLabel: '紀元前290年', formatYear: fakeYear, events: [] });
  assert.ok(!empty.innerHTML.includes('この地図は'), '出来事ゼロでも枠が出ている');
});
