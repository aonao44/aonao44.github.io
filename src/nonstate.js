// 非国家(狩猟採集民・遊牧民・民族集団・考古学的文化)の判定。
//
// なぜ名前で判定するのか:
// 元データ (historical-basemaps) には `type` 属性が一応あるが、サンプルした 7 断面
// 3844 feature のうち値が入っているのは 16 件だけで、分類には全く使えない。
// SUBJECTO / PARTOF は宗主関係であって国家性とは無関係。
// したがって NAME の語形から判定するしかない。規則は data/nonstate.json に置く。
//
// 方針: 迷ったら国家扱い(過小分類)にする。実在の帝国を薄く塗ってしまう方が、
// 狩猟採集民を濃く塗るより誤りとして重い。

/** 空の規則（規則ファイルが読めなかった場合のフォールバック）。 */
export const EMPTY_RULE = { patterns: [], exceptions: [], explicit: [] };

/**
 * 規則を高速判定用に正規化する。
 * @param {{patterns?: string[], exceptions?: string[], explicit?: string[]}} rule
 */
export function compileNonStateRule(rule = EMPTY_RULE) {
  return {
    patterns: (rule.patterns ?? []).map((p) => p.toLowerCase()),
    exceptions: new Set(rule.exceptions ?? []),
    explicit: new Set(rule.explicit ?? []),
  };
}

/**
 * NAME が非国家を指すか。
 * @param {string|null|undefined} name
 * @param {ReturnType<typeof compileNonStateRule>} compiled
 * @returns {boolean}
 */
export function isNonState(name, compiled) {
  if (!name || !compiled) return false;
  if (compiled.exceptions.has(name)) return false;
  if (compiled.explicit.has(name)) return true;
  const lower = String(name).toLowerCase();
  return compiled.patterns.some((p) => lower.includes(p));
}
