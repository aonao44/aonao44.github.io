import test from 'node:test';
import assert from 'node:assert/strict';

import { parseYear, eraIndexForYear, resolveYearInput } from '../src/yearinput.js';
import { ERAS, ERA_COUNT, indexOfEra } from '../src/eras.js';

// --- パーサ ---

test('parseYear reads plain AD years', () => {
  assert.equal(parseYear('117'), 117);
  assert.equal(parseYear('2010'), 2010);
  assert.equal(parseYear('1'), 1);
  assert.equal(parseYear('117年'), 117);
});

test('parseYear reads negative years', () => {
  assert.equal(parseYear('-500'), -500);
  assert.equal(parseYear('-3000'), -3000);
});

test('parseYear reads the Japanese BC forms', () => {
  assert.equal(parseYear('紀元前500'), -500);
  assert.equal(parseYear('紀元前500年'), -500);
  assert.equal(parseYear('前500'), -500);
  assert.equal(parseYear('前500年'), -500);
  assert.equal(parseYear('西暦前500'), -500);
  assert.equal(parseYear('500年前'), -500);
});

test('parseYear reads the English BC forms in either position', () => {
  assert.equal(parseYear('BC500'), -500);
  assert.equal(parseYear('500BC'), -500);
  assert.equal(parseYear('bc500'), -500);
  assert.equal(parseYear('500 bc'), -500);
  assert.equal(parseYear('B.C. 500'), -500);
  assert.equal(parseYear('500 BCE'), -500);
});

test('parseYear ignores an AD marker', () => {
  assert.equal(parseYear('西暦117'), 117);
  assert.equal(parseYear('AD117'), 117);
  assert.equal(parseYear('紀元後117年'), 117);
});

test('parseYear accepts full-width digits and stray separators', () => {
  assert.equal(parseYear('１１７'), 117);
  assert.equal(parseYear('紀元前５００年'), -500);
  assert.equal(parseYear('1,492'), 1492);
  assert.equal(parseYear('  1492  '), 1492);
});

test('parseYear rejects what it cannot read', () => {
  assert.equal(parseYear(''), null);
  assert.equal(parseYear('   '), null);
  assert.equal(parseYear('abc'), null);
  assert.equal(parseYear('ローマ'), null);
  assert.equal(parseYear('12x3'), null);
  assert.equal(parseYear('1.5'), null);
  assert.equal(parseYear(null), null);
  assert.equal(parseYear(117), null, 'only strings are accepted');
});

test('parseYear rejects year zero and double negatives', () => {
  // 紀元前1年の翌年が1年で、0年は存在しない
  assert.equal(parseYear('0'), null);
  assert.equal(parseYear('紀元前0年'), null);
  assert.equal(parseYear('紀元前-500'), null);
  assert.equal(parseYear('BC-500'), null);
});

// --- 断面への寄せ ---

test('eraIndexForYear snaps to the era in force at that year', () => {
  // 117年当時に有効なのは100年の断面
  assert.equal(eraIndexForYear(117), indexOfEra('100'));
  assert.equal(eraIndexForYear(-480), indexOfEra('bc500'));
  assert.equal(eraIndexForYear(1500), indexOfEra('1500'));
  assert.equal(eraIndexForYear(1499), indexOfEra('1492'));
});

test('eraIndexForYear returns the exact era when the year matches one', () => {
  assert.equal(eraIndexForYear(1492), indexOfEra('1492'));
  assert.equal(eraIndexForYear(100), indexOfEra('100'));
  assert.equal(eraIndexForYear(-3000), 0);
  assert.equal(eraIndexForYear(2010), ERA_COUNT - 1);
});

test('eraIndexForYear never snaps forward past the requested year', () => {
  for (let i = 0; i < ERA_COUNT; i += 1) {
    const { year } = ERAS[i];
    // 断面のちょうど1年後は、その断面のまま
    const idx = eraIndexForYear(year + 1);
    assert.ok(ERAS[idx].year <= year + 1, `snapped forward at ${year}`);
    assert.ok(idx >= i, `snapped backwards at ${year}`);
  }
});

test('eraIndexForYear clamps outside the covered range', () => {
  assert.equal(eraIndexForYear(-99999), 0, 'before the first era shows the first era');
  assert.equal(eraIndexForYear(-3001), 0);
  assert.equal(eraIndexForYear(99999), ERA_COUNT - 1, 'after the last era shows the last era');
  assert.equal(eraIndexForYear(NaN), 0);
});

// --- 入力からの解決 ---

test('resolveYearInput reports whether it had to snap', () => {
  const exact = resolveYearInput('1492');
  assert.equal(exact.ok, true);
  assert.equal(exact.year, 1492);
  assert.equal(exact.era.id, '1492');
  assert.equal(exact.snapped, false, '1492 is itself an era');

  const snapped = resolveYearInput('117');
  assert.equal(snapped.ok, true);
  assert.equal(snapped.year, 117);
  assert.equal(snapped.era.id, '100');
  assert.equal(snapped.snapped, true);
});

test('resolveYearInput handles the Japanese BC form end to end', () => {
  const r = resolveYearInput('紀元前480年');
  assert.equal(r.ok, true);
  assert.equal(r.year, -480);
  assert.equal(r.era.id, 'bc500');
  assert.equal(r.snapped, true);
  assert.equal(r.index, indexOfEra('bc500'));
});

test('resolveYearInput distinguishes empty from unreadable', () => {
  assert.deepEqual(resolveYearInput(''), { ok: false, reason: 'empty' });
  assert.deepEqual(resolveYearInput('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(resolveYearInput('ローマ'), { ok: false, reason: 'unparsable' });
  assert.deepEqual(resolveYearInput('0'), { ok: false, reason: 'unparsable' });
  assert.deepEqual(resolveYearInput(null), { ok: false, reason: 'empty' });
});

test('resolveYearInput always returns an index the slider can take', () => {
  for (const input of ['-99999', '99999', '紀元前3000', '2010', 'BC1', '1']) {
    const r = resolveYearInput(input);
    assert.equal(r.ok, true, `${input} should parse`);
    assert.ok(Number.isInteger(r.index) && r.index >= 0 && r.index < ERA_COUNT,
      `${input} produced index ${r.index}`);
  }
});
