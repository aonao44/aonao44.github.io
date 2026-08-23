// 出来事の選別。
// spec: 「選択断面の前後（直前の断面より後〜当該断面まで）の出来事を点で表示」

import { ERAS, clampIndex } from './eras.js';

/**
 * 指定断面に対応する出来事だけを返す。
 * 直前の断面の年より後、当該断面の年以下のものを対象とする。
 * 先頭の断面では下限を設けない（それ以前の出来事も先頭断面に集める）。
 *
 * @param {number} index 断面インデックス
 * @param {Array<{year:number}>} events
 * @returns {Array} 年の昇順
 */
export function eventsForEra(index, events = []) {
  const i = clampIndex(index);
  const upper = ERAS[i].year;
  const lower = i === 0 ? -Infinity : ERAS[i - 1].year;
  return events
    .filter((e) => Number.isFinite(e?.year) && e.year > lower && e.year <= upper)
    .sort((a, b) => a.year - b.year);
}

/**
 * 出来事の年ラベル。formatYear と同じ規則。
 * @param {number} year
 * @returns {string}
 */
export function eventYearLabel(year) {
  return year < 0 ? `紀元前${Math.abs(year)}年` : `${year}年`;
}
