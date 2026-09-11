// 出来事の選別。
// spec: 「選択断面の前後（直前の断面より後〜当該断面まで）の出来事を点で表示」

import { ERAS, clampIndex } from './eras.js';

/**
 * 指定断面に対応する出来事だけを返す。
 * 直前の断面の年より後、当該断面の年以下のものを対象とする。
 * 先頭の断面では下限を設けない（それ以前の出来事も先頭断面に集める）。
 *
 * `throughYear` は「読者が指定した年」。断面は指定年**以前**の最も近いものへ寄るのに、
 * 出来事は指定年**以後**の最初の断面に属するので、空白区間の年を指定すると
 * 「その年にはもう起きている出来事」が必ず一つ先の断面に隠れてしまう。
 * 紀元前220年を指定すると紀元前300年の地図が出るが、秦の中国統一(前221)は
 * 紀元前200年側にあって見えない、というのがその実例。
 * 指定年が断面より後なら、そこまでの出来事を含める。
 *
 * @param {number} index 断面インデックス
 * @param {Array<{year:number}>} events
 * @param {number|null} [throughYear] 読者が指定した年。断面より後ならここまで含める
 * @returns {Array} 年の昇順
 */
export function eventsForEra(index, events = [], throughYear = null) {
  const i = clampIndex(index);
  const eraYear = ERAS[i].year;
  const upper = Number.isFinite(throughYear) && throughYear > eraYear ? throughYear : eraYear;
  const lower = i === 0 ? -Infinity : ERAS[i - 1].year;
  return events
    .filter((e) => Number.isFinite(e?.year) && e.year > lower && e.year <= upper)
    .sort((a, b) => a.year - b.year);
}
