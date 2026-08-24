// 日本語の文から「年」を拾う。テスト間で規則を1か所に保つためのヘルパー。
//
// 日本語では「260年」が西暦260年とも「260年間」とも読める。年代の取り違えを
// 検査したいので、期間を表している数字は年として拾ってはいけない。
// 実データで踏んだ誤検出:
//   「約260年にわたる」「35年間」「約300年ぶりに」「10年余りで」「100年以上続く」
//   「1935〜36年」「1920〜30年代」  ← 範囲の後半だけを拾ってしまう

/** 数字の直後（「年」の後ろ）に来ると期間を表す語。 */
const DURATION_SUFFIXES = [
  '間', 'ぶり', '余', '以上', '以下', '以降', '以内', '足らず',
  'にわたり', 'にわたる', 'にわたっ', 'をかけ', 'を経',
  '続', '後', '前後', 'ほど', 'ばかり', 'あまり',
];

/** 数字の直前に来ると概数＝期間を示唆する語。 */
const APPROX_PREFIXES = ['約', 'およそ', '数'];

/** 数字の直前に来ると「範囲の後半」を示す記号（1935〜36年 の 36）。 */
const RANGE_MARKS = ['〜', '～', '-', '–', '—', '‐'];

/**
 * 文中で「時点としての年」を指している数字だけを返す。
 * 「紀元前3000年」は -3000。数字の途中から拾わないよう直前が数字でないことを要求する。
 *
 * @param {string} text
 * @returns {number[]}
 */
export function citedYears(text) {
  const s = String(text ?? '');
  const out = [];
  for (const m of s.matchAll(/(?<![0-9])(前)?([0-9]{1,4})年/g)) {
    const start = m.index;
    const after = s.slice(start + m[0].length);
    const before = s.slice(0, start);

    if (DURATION_SUFFIXES.some((suffix) => after.startsWith(suffix))) continue;
    if (APPROX_PREFIXES.some((p) => before.endsWith(p))) continue;
    if (RANGE_MARKS.some((r) => before.endsWith(r))) continue;

    out.push(m[1] ? -Number(m[2]) : Number(m[2]));
  }
  return out;
}
