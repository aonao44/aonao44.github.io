// 年の入力欄。入力文字列を年に直し、その年に最も近い（その年以前の）断面へ寄せる。
//
// 断面は48しかないので、入力された年ちょうどの断面はまず存在しない。
// 「117年」と打たれたら 100年の断面（117年当時に有効だった最後の断面）を出すのが正しい。

import { ERAS, clampIndex } from './eras.js';

/** 全角英数字・記号を半角に落とす。 */
function toHalfWidth(str) {
  return String(str)
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－ー―‐−]/g, '-')
    .replace(/　/g, ' ');
}

// 「紀元前」を表す接頭辞・接尾辞。長いものから順に試す
const BC_PREFIXES = ['紀元前', '西暦前', 'b.c.e.', 'b.c.', 'bce', 'bc', '前'];
const BC_SUFFIXES = ['b.c.e.', 'b.c.', 'bce', 'bc', '年前'];
// 「西暦」を表す接頭辞（あっても意味は変わらない）
const AD_PREFIXES = ['紀元後', '西暦', 'a.d.', 'ad'];

/**
 * 入力文字列を符号付きの年に直す。解釈できなければ null。
 *
 * 受け付ける形: "117" / "117年" / "-500" / "紀元前500" / "紀元前500年"
 * / "BC500" / "500BC" / "前500" / "西暦117" / 全角
 *
 * @param {string} input
 * @returns {number|null}
 */
export function parseYear(input) {
  if (typeof input !== 'string') return null;

  let s = toHalfWidth(input).trim().toLowerCase();
  if (!s) return null;

  // 「年」は位置によらず捨てる。ただし「年前」は紀元前の意味なので先に処理する
  let bc = false;

  for (const suffix of BC_SUFFIXES) {
    if (s.endsWith(suffix)) {
      bc = true;
      s = s.slice(0, -suffix.length).trim();
      break;
    }
  }
  if (!bc) {
    for (const prefix of BC_PREFIXES) {
      if (s.startsWith(prefix)) {
        bc = true;
        s = s.slice(prefix.length).trim();
        break;
      }
    }
  }
  if (!bc) {
    for (const prefix of AD_PREFIXES) {
      if (s.startsWith(prefix)) {
        s = s.slice(prefix.length).trim();
        break;
      }
    }
  }

  s = s.replace(/年$/, '').trim();
  // 数字のあいだの空白・カンマは無視する ("1 492", "1,492")
  s = s.replace(/[\s,]/g, '');

  if (!/^-?\d+$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;

  // 「紀元前-500」のような二重否定は受け付けない
  if (bc && n < 0) return null;
  // 0年は存在しない（紀元前1年の翌年が1年）
  if (n === 0) return null;

  return bc ? -n : n;
}

/**
 * その年に有効だった断面のインデックス。
 * 「その年以下で最大の年を持つ断面」を返す。
 * 最初の断面より前の年は先頭に、最後の断面より後の年は末尾に寄せる。
 *
 * @param {number} year
 * @returns {number}
 */
export function eraIndexForYear(year) {
  if (!Number.isFinite(year)) return 0;
  let found = -1;
  for (let i = 0; i < ERAS.length; i += 1) {
    if (ERAS[i].year <= year) found = i;
    else break;
  }
  // BC3000 より前しか指していない場合も、いちばん古い断面を出す
  return clampIndex(found < 0 ? 0 : found);
}

/**
 * 入力文字列から表示すべき断面を決める。
 *
 * @param {string} input
 * @returns {{ok: true, year: number, index: number, era: {id:string,year:number}, snapped: boolean}
 *   | {ok: false, reason: 'empty'|'unparsable'}}
 */
export function resolveYearInput(input) {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, reason: 'empty' };
  const year = parseYear(input);
  if (year === null) return { ok: false, reason: 'unparsable' };
  const index = eraIndexForYear(year);
  const era = ERAS[index];
  return { ok: true, year, index, era, snapped: era.year !== year };
}
