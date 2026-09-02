import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ERA_IDS, ERAS, ERA_COUNT, eraIdToYear, formatYear, clampIndex,
  eraAt, labelAt, indexOfEra, EraStore,
} from '../src/eras.js';

test('era list is unique and strictly increasing in time', () => {
  assert.equal(new Set(ERA_IDS).size, ERA_IDS.length, 'duplicate era ids');
  for (let i = 1; i < ERAS.length; i += 1) {
    assert.ok(
      ERAS[i].year > ERAS[i - 1].year,
      `not increasing at ${ERAS[i - 1].id} -> ${ERAS[i].id}`,
    );
  }
});

test('era list spans BC3000 to 2010', () => {
  assert.equal(ERAS[0].id, 'bc3000');
  assert.equal(ERAS[0].year, -3000);
  assert.equal(ERAS[ERA_COUNT - 1].id, '2010');
  assert.equal(ERAS[ERA_COUNT - 1].year, 2010);
});

test('eraIdToYear parses BC and AD ids', () => {
  assert.equal(eraIdToYear('bc3000'), -3000);
  assert.equal(eraIdToYear('bc1'), -1);
  assert.equal(eraIdToYear('100'), 100);
  assert.equal(eraIdToYear('2010'), 2010);
});

test('eraIdToYear rejects malformed ids', () => {
  assert.throws(() => eraIdToYear('ad100'), /invalid era id/);
  assert.throws(() => eraIdToYear(''), /invalid era id/);
  assert.throws(() => eraIdToYear('bc'), /invalid era id/);
  assert.throws(() => eraIdToYear(100), TypeError);
});

test('formatYear renders Japanese year labels', () => {
  assert.equal(formatYear(-3000), '紀元前3000年');
  assert.equal(formatYear(-1), '紀元前1年');
  assert.equal(formatYear(117), '117年');
  assert.equal(formatYear(2010), '2010年');
});

test('formatYear rejects non-finite input', () => {
  assert.throws(() => formatYear(NaN), TypeError);
  assert.throws(() => formatYear(Infinity), TypeError);
});

test('clampIndex keeps the index inside the slider range', () => {
  assert.equal(clampIndex(-5), 0);
  assert.equal(clampIndex(0), 0);
  assert.equal(clampIndex(3), 3);
  assert.equal(clampIndex(ERA_COUNT - 1), ERA_COUNT - 1);
  assert.equal(clampIndex(ERA_COUNT), ERA_COUNT - 1);
  assert.equal(clampIndex(999), ERA_COUNT - 1);
});

test('clampIndex rounds fractional slider values', () => {
  assert.equal(clampIndex(2.4), 2);
  assert.equal(clampIndex(2.6), 3);
  assert.equal(clampIndex(NaN), 0);
});

test('eraAt and labelAt agree with the era list', () => {
  assert.equal(eraAt(0).id, 'bc3000');
  assert.equal(labelAt(0), '紀元前3000年');
  const last = ERA_COUNT - 1;
  assert.equal(eraAt(last).id, '2010');
  assert.equal(labelAt(last), '2010年');
  // 範囲外もクランプして落ちない
  assert.equal(labelAt(-1), '紀元前3000年');
  assert.equal(labelAt(ERA_COUNT + 10), '2010年');
});

test('labelAt matches formatYear for every era', () => {
  ERAS.forEach((era, i) => {
    assert.equal(labelAt(i), formatYear(era.year));
  });
});

test('indexOfEra round-trips era ids', () => {
  ERA_IDS.forEach((id, i) => {
    assert.equal(indexOfEra(id), i);
  });
  assert.equal(indexOfEra('bc9999'), -1);
});

// --- EraStore ---

function fakeFetch(bodies, log = []) {
  return async (url) => {
    log.push(url);
    const key = url.split('/').pop().replace('.geojson', '');
    if (!(key in bodies)) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => bodies[key] };
  };
}

test('EraStore fetches from the expected path', async () => {
  const log = [];
  const store = new EraStore({ fetchImpl: fakeFetch({ bc3000: { ok: 1 } }, log) });
  const data = await store.load('bc3000');
  assert.deepEqual(data, { ok: 1 });
  assert.deepEqual(log, ['data/eras/bc3000.geojson']);
});

test('EraStore caches: a second load does not refetch', async () => {
  const log = [];
  const store = new EraStore({ fetchImpl: fakeFetch({ '100': { era: 100 } }, log) });
  await store.load('100');
  assert.equal(store.has('100'), true);
  const again = await store.load('100');
  assert.deepEqual(again, { era: 100 });
  assert.equal(log.length, 1, 'cached era should not be refetched');
});

test('EraStore dedupes concurrent loads of the same era', async () => {
  const log = [];
  const store = new EraStore({ fetchImpl: fakeFetch({ '2010': { era: 2010 } }, log) });
  const [a, b] = await Promise.all([store.load('2010'), store.load('2010')]);
  assert.deepEqual(a, b);
  assert.equal(log.length, 1, 'concurrent loads should share one request');
});

test('EraStore rejects on HTTP error and does not cache the failure', async () => {
  const log = [];
  const store = new EraStore({ fetchImpl: fakeFetch({}, log) });
  await assert.rejects(() => store.load('bc700'), /404/);
  assert.equal(store.has('bc700'), false);
  // 再試行できること (spec: 再試行ボタン)
  await assert.rejects(() => store.load('bc700'), /404/);
  assert.equal(log.length, 2, 'a failed era must be retryable');
});

test('EraStore.peek returns undefined until loaded', async () => {
  const store = new EraStore({ fetchImpl: fakeFetch({ '500': { era: 500 } }) });
  assert.equal(store.peek('500'), undefined);
  await store.load('500');
  assert.deepEqual(store.peek('500'), { era: 500 });
});
