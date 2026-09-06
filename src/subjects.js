/**
 * SUBJECTO の表記揺れを既存の NAME に寄せる。
 * 配列は複数主体による領有権主張のように、単一政体へ潰せない場合に使う。
 */
export function normalizeSubjects(subject, aliases = {}) {
  if (typeof subject !== 'string' || !subject.trim()) return [];
  const raw = subject.trim();
  const normalized = aliases[raw] ?? raw;
  return (Array.isArray(normalized) ? normalized : [normalized])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());
}
