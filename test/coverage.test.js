import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { ERA_IDS, ERAS } from '../src/eras.js';
import { eventsForEra } from '../src/events.js';
import { citedYears } from './year-utils.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const polityInfo = readJson('data/polity-info.json');
const nameEras = readJson('data/name-eras.json');
const events = readJson('data/events.json');
const len = (s) => Array.from(String(s)).length;

// --- polity-info: 全政体を網羅しているか ---

test('every polity in the map data has a description', () => {
  const names = Object.keys(nameEras);
  const missing = names.filter((n) => !(n in polityInfo));
  assert.deepEqual(missing, [], `${missing.length} polities still undescribed`);
  assert.equal(Object.keys(polityInfo).length, names.length);
});

test('no polity-info entry describes something absent from the map', () => {
  const stray = Object.keys(polityInfo).filter((k) => !(k in nameEras));
  assert.deepEqual(stray, []);
});

test('every entry has a non-empty summary within the length limit', () => {
  const allowed = new Set(['summary_ja', 'period_ja', 'capital_ja', 'name_ja']);
  for (const [k, v] of Object.entries(polityInfo)) {
    assert.equal(typeof v.summary_ja, 'string', `${k}: summary_ja must be a string`);
    assert.ok(v.summary_ja.trim(), `${k}: empty summary`);
    assert.ok(len(v.summary_ja) <= 400, `${k}: summary is ${len(v.summary_ja)} characters`);
    assert.ok(len(v.summary_ja) >= 25, `${k}: summary is only ${len(v.summary_ja)} characters`);
    const stray = Object.keys(v).filter((x) => !allowed.has(x));
    assert.deepEqual(stray, [], `${k}: unexpected fields`);
    for (const opt of ['period_ja', 'capital_ja', 'name_ja']) {
      if (v[opt] !== undefined) {
        assert.ok(typeof v[opt] === 'string' && v[opt].trim(), `${k}: bad ${opt}`);
      }
    }
  }
});

test('summaries are Japanese, not English', () => {
  for (const [k, v] of Object.entries(polityInfo)) {
    const english = v.summary_ja.match(/[A-Za-z]*[a-z]{3,}[A-Za-z]*/);
    assert.equal(english, null, `${k}: English in summary: ${english?.[0]}`);
  }
});

// --- polity-info: 年の健全性 ---

test('no cited year is impossible', () => {
  const bad = [];
  for (const [k, v] of Object.entries(polityInfo)) {
    for (const field of ['summary_ja', 'period_ja']) {
      if (!v[field]) continue;
      for (const y of citedYears(v[field])) {
        // 0年は存在しない。この地図が扱うのは前4000年〜現在まで
        if (y === 0) bad.push(`${k}.${field}: year 0`);
        if (y > 2026) bad.push(`${k}.${field}: future year ${y}`);
        // 地図は前3000年から始まるが、記述はそれ以前の文化にも触れる
        // （チンチョーロ文化の人工ミイラは前7000年ごろ）
        if (y < -12000) bad.push(`${k}.${field}: implausibly early ${y}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('a summary does not cite a year outside its own stated period', () => {
  // period_ja が「前202年〜220年」のように両端を持つ場合だけ検査する。
  // 前後200年の余裕を見る（前史・後日談に触れるのは自然なため）。
  const bad = [];
  for (const [k, v] of Object.entries(polityInfo)) {
    if (!v.period_ja) continue;
    const bounds = citedYears(v.period_ja);
    if (bounds.length < 2) continue;
    const lo = Math.min(...bounds) - 200;
    const hi = Math.max(...bounds) + 200;
    for (const y of citedYears(v.summary_ja)) {
      if (y < lo || y > hi) bad.push(`${k}: period ${v.period_ja} but summary cites ${y}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('a described polity appears in at least one era', () => {
  for (const k of Object.keys(polityInfo)) {
    assert.ok(nameEras[k]?.length > 0, `${k}: described but never on the map`);
  }
});

test('most obscure polities correctly omit a period rather than inventing one', () => {
  // 登場断面が1つしかない無名の政体に、軒並み具体的な年代が付いていたら
  // 捏造を疑うべき。ここでは「省略が多数派であること」を確かめる。
  const obscure = Object.keys(polityInfo).filter((k) => nameEras[k].length === 1);
  const withPeriod = obscure.filter((k) => polityInfo[k].period_ja).length;
  assert.ok(
    withPeriod / obscure.length < 0.5,
    `${withPeriod}/${obscure.length} single-era polities claim a period — suspicious`,
  );
});

// --- events ---

test('events.json has grown to roughly 300 and stays well formed', () => {
  assert.ok(events.length >= 300, `only ${events.length} events`);
  const seen = new Set();
  events.forEach((e, i) => {
    const at = `event ${i} (${e.title_ja})`;
    assert.ok(Number.isInteger(e.year) && e.year !== 0, `${at}: bad year ${e.year}`);
    assert.ok(e.lat >= -90 && e.lat <= 90, `${at}: bad lat`);
    assert.ok(e.lng >= -180 && e.lng <= 180, `${at}: bad lng`);
    assert.ok(len(e.title_ja) > 0 && len(e.title_ja) <= 20, `${at}: title length`);
    assert.ok(len(e.summary_ja) > 0 && len(e.summary_ja) <= 80, `${at}: summary length`);
    assert.match(e.source_url, /^https:\/\/ja\.wikipedia\.org\/wiki\/.+/, `${at}: source_url`);
    assert.deepEqual(
      Object.keys(e).sort(),
      ['lat', 'lng', 'source_url', 'summary_ja', 'title_ja', 'year'],
      `${at}: unexpected fields`,
    );
    const key = `${e.title_ja}|${e.year}`;
    assert.ok(!seen.has(key), `${at}: duplicate of an earlier event`);
    seen.add(key);
  });
});

test('events are sorted by year', () => {
  for (let i = 1; i < events.length; i += 1) {
    assert.ok(events[i - 1].year <= events[i].year, `event ${i} out of order`);
  }
});

test('no era is left without events', () => {
  const empty = ERA_IDS.filter((_, i) => eventsForEra(i, events).length === 0);
  assert.deepEqual(empty, [], 'every era must show at least one event');
});

test('every era has a workable number of events', () => {
  const counts = ERA_IDS.map((id, i) => ({ id, n: eventsForEra(i, events).length }));
  for (const { id, n } of counts) {
    assert.ok(n >= 4, `era ${id} has only ${n} events`);
    assert.ok(n <= 14, `era ${id} has ${n} events — too many dots for one map`);
  }
});

test('events do not cite a year in the text far from their own year', () => {
  const bad = [];
  for (const e of events) {
    for (const y of citedYears(`${e.title_ja} ${e.summary_ja}`)) {
      if (Math.abs(y - e.year) > 60) bad.push(`${e.title_ja} (${e.year}) cites ${y}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('events span the whole timeline, not just the modern end', () => {
  const ancient = events.filter((e) => e.year < 0).length;
  assert.ok(ancient >= 60, `only ${ancient} BC events`);
  const modern = events.filter((e) => e.year >= 1900).length;
  assert.ok(modern < events.length * 0.4, 'events are too concentrated in the modern era');
});
