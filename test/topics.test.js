import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { ERA_IDS, ERAS, formatYear } from '../src/eras.js';
import { isDrawableGeometry } from '../src/geojson.js';
import { renderTopics } from '../src/panel.js';
import { citedYears } from './year-utils.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const topics = readJson('data/topics.json');
const len = (s) => Array.from(String(s)).length;

test('topics.json covers every era with 4-7 topics', () => {
  for (const id of ERA_IDS) {
    assert.ok(Array.isArray(topics[id]), `era ${id} has no topics`);
    assert.ok(
      topics[id].length >= 4 && topics[id].length <= 7,
      `era ${id} has ${topics[id].length} topics, expected 4-7`,
    );
  }
});

test('topics.json has no eras that are not in the era list', () => {
  const known = new Set(ERA_IDS);
  const stray = Object.keys(topics).filter((k) => !known.has(k));
  assert.deepEqual(stray, []);
});

test('every topic has the required shape and no stray fields', () => {
  const allowed = new Set(['title_ja', 'body_ja', 'polity', 'wiki_url']);
  for (const [id, list] of Object.entries(topics)) {
    list.forEach((t, i) => {
      const at = `${id}[${i}]`;
      assert.equal(typeof t.title_ja, 'string', `${at}: title_ja`);
      assert.equal(typeof t.body_ja, 'string', `${at}: body_ja`);
      assert.equal(typeof t.wiki_url, 'string', `${at}: wiki_url`);
      assert.ok(t.title_ja.trim(), `${at}: empty title`);
      assert.ok(t.body_ja.trim(), `${at}: empty body`);
      const stray = Object.keys(t).filter((k) => !allowed.has(k));
      assert.deepEqual(stray, [], `${at}: unexpected fields`);
    });
  }
});

test('topic text stays within the length limits', () => {
  for (const [id, list] of Object.entries(topics)) {
    list.forEach((t, i) => {
      assert.ok(len(t.title_ja) <= 30, `${id}[${i}]: title is ${len(t.title_ja)} chars`);
      assert.ok(len(t.body_ja) <= 120, `${id}[${i}]: body is ${len(t.body_ja)} chars`);
    });
  }
});

test('every topic links to Japanese Wikipedia', () => {
  for (const [id, list] of Object.entries(topics)) {
    list.forEach((t, i) => {
      assert.match(t.wiki_url, /^https:\/\/ja\.wikipedia\.org\/wiki\/.+/, `${id}[${i}]`);
    });
  }
});

test('every polity named by a topic has drawable geometry in that era file', () => {
  const missing = [];
  for (const id of ERA_IDS) {
    const era = readJson(`data/eras/${id}.geojson`);
    const names = new Set(
      era.features
        .filter((f) => isDrawableGeometry(f.geometry))
        .map((f) => f.properties?.NAME)
        .filter((n) => typeof n === 'string' && n.trim())
        .map((n) => n.trim()),
    );
    for (const t of topics[id]) {
      if (t.polity === undefined) continue;
      assert.equal(typeof t.polity, 'string', `${id}: polity must be a string`);
      if (!names.has(t.polity.trim())) missing.push(`${id}: "${t.polity}"`);
    }
  }
  assert.deepEqual(missing, [], 'topics must only reference polities present in their own era');
});

test('most topics are linked to a polity so the map can be driven from the panel', () => {
  const all = Object.values(topics).flat();
  const linked = all.filter((t) => t.polity).length;
  assert.ok(linked / all.length > 0.7, `only ${linked}/${all.length} topics name a polity`);
});

test('the three topics without a polity render as static headings, never buttons', () => {
  const unlinked = [];
  for (const id of ERA_IDS) {
    const list = topics[id];
    list.forEach((topic, index) => {
      if (!topic.polity) unlinked.push(`${id}[${index}]`);
    });
    const el = fakeEl();
    renderTopics(el, id, list, {});
    assert.equal(
      (el.innerHTML.match(/class="topic-btn"/g) || []).length,
      list.filter((topic) => topic.polity).length,
      `${id}: button count`,
    );
    assert.equal(
      (el.innerHTML.match(/class="topic-static"/g) || []).length,
      list.filter((topic) => !topic.polity).length,
      `${id}: static topic count`,
    );
  }
  assert.deepEqual(unlinked.map((at) => at.replace(/\[\d+\]$/, '')), ['700', '1914', '2010']);
});

test('topic bodies do not mention a year far from their era', () => {
  const yearOf = Object.fromEntries(ERAS.map((e) => [e.id, e.year]));
  const offenders = [];
  for (const [id, list] of Object.entries(topics)) {
    for (const t of list) {
      const text = `${t.title_ja} ${t.body_ja}`;
      const years = citedYears(text);
      for (const y of years) {
        if (Math.abs(y - yearOf[id]) > 60) offenders.push(`${id}(${yearOf[id]}): ${y} in "${t.title_ja}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'a topic cites a year far outside its era');
});

test('topics are globally spread, not one region repeated', () => {
  // 同じ断面のなかで題名が重複していないこと
  for (const [id, list] of Object.entries(topics)) {
    const titles = list.map((t) => t.title_ja);
    assert.equal(new Set(titles).size, titles.length, `${id}: duplicate topic titles`);
    // 同じ政体が2回出るのは正当（1492年はコロンブスもグラナダ陥落もカスティーリャ）。
    // ただし1つの政体が断面を占領していたら、その断面は視野が狭い。
    const counts = new Map();
    for (const t of list) {
      if (!t.polity) continue;
      counts.set(t.polity, (counts.get(t.polity) ?? 0) + 1);
    }
    for (const [polity, n] of counts) {
      assert.ok(n <= 2, `${id}: ${polity} appears in ${n} of ${list.length} topics`);
    }
  }
});

// --- 描画 ---

function fakeEl() {
  return {
    innerHTML: '',
    prepend() {},
  };
}

test('renderTopics lists every topic with its Japanese polity name', () => {
  const el = fakeEl();
  const n = renderTopics(el, '紀元前1年', [
    { title_ja: 'アウグストゥス', body_ja: '本文', polity: 'Roman Empire', wiki_url: 'https://ja.wikipedia.org/wiki/X' },
    { title_ja: '王莽', body_ja: '本文2', wiki_url: 'https://ja.wikipedia.org/wiki/Y' },
  ], { 'Roman Empire': 'ローマ帝国' });
  assert.equal(n, 2);
  assert.match(el.innerHTML, /紀元前1年/);
  assert.match(el.innerHTML, /この時代のトピック/);
  assert.match(el.innerHTML, /アウグストゥス/);
  assert.match(el.innerHTML, /ローマ帝国/, 'polity shown in Japanese');
  assert.match(el.innerHTML, /data-polity="Roman Empire"/, 'raw NAME kept for map lookup');
  // polity の無いトピックにはボタンの data 属性が付かない
  assert.equal((el.innerHTML.match(/data-polity=/g) || []).length, 1);
  assert.equal((el.innerHTML.match(/<button/g) || []).length, 1);
  assert.equal((el.innerHTML.match(/class="topic-static"/g) || []).length, 1);
});

test('renderTopics escapes user-visible text', () => {
  const el = fakeEl();
  renderTopics(el, '100年', [
    { title_ja: '<script>x</script>', body_ja: 'a & b', wiki_url: 'https://ja.wikipedia.org/wiki/Z' },
  ]);
  assert.ok(!el.innerHTML.includes('<script>'), 'title must be escaped');
  assert.match(el.innerHTML, /a &amp; b/);
});

test('renderTopics degrades gracefully with no topics', () => {
  const el = fakeEl();
  assert.equal(renderTopics(el, '100年', []), 0);
  assert.match(el.innerHTML, /100年/);
  assert.match(el.innerHTML, /登録されていません/);
});

test('every era label used by the panel is well formed', () => {
  for (const era of ERAS) {
    const el = fakeEl();
    renderTopics(el, formatYear(era.year), topics[era.id], {});
    assert.match(el.innerHTML, /のトピック/, `era ${era.id} header`);
  }
});
