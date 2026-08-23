// 右パネル: 政体名（日本語/英語）・宗主・現在の国 を描画する。
// 対訳や modern.json が未登録でもエラーにせずフォールバック表示する（spec）。

/** modern.json に未登録の政体の表示。 */
export const MODERN_FALLBACK = '（未登録）';

/**
 * 対訳表から日本語名を引く。未登録なら英語名をそのまま返す。
 * @param {string|null|undefined} name
 * @param {Record<string,string>} namesJa
 * @returns {string|null}
 */
export function japaneseName(name, namesJa = {}) {
  if (!name) return null;
  return namesJa[name] ?? name;
}

/**
 * 「現在の国」を文字列にする。未登録は「（未登録）」。
 * @param {string|null|undefined} name
 * @param {Record<string, string[]|string>} modern
 * @returns {string}
 */
export function modernCountries(name, modern = {}) {
  if (!name) return MODERN_FALLBACK;
  const v = modern[name];
  if (!v) return MODERN_FALLBACK;
  const list = Array.isArray(v) ? v : [v];
  const cleaned = list.filter(Boolean);
  return cleaned.length ? cleaned.join('、') : MODERN_FALLBACK;
}

/**
 * クリックされた feature からパネル表示用のモデルを作る。
 * @param {object|null} properties feature.properties
 * @param {{namesJa?: object, modern?: object}} [dicts]
 */
export function buildPanelModel(properties, dicts = {}) {
  const namesJa = dicts.namesJa ?? {};
  const modern = dicts.modern ?? {};
  const nameEn = properties?.NAME ?? null;
  const subjectRaw = properties?.SUBJECTO ?? null;
  // SUBJECTO は自分自身を指していることが多いので、その場合は宗主なしとみなす
  const subjectEn = subjectRaw && subjectRaw !== nameEn ? subjectRaw : null;

  return {
    nameEn,
    nameJa: japaneseName(nameEn, namesJa),
    hasTranslation: Boolean(nameEn && namesJa[nameEn]),
    subjectEn,
    subjectJa: japaneseName(subjectEn, namesJa),
    modern: modernCountries(nameEn, modern),
  };
}

/** 空表示（何も選択していない状態）。 */
export function renderEmpty(el) {
  el.innerHTML = '<p class="panel-hint">地図上の政体をクリックすると詳細が出ます。</p>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * パネルを描画する。
 * @param {HTMLElement} el
 * @param {object|null} properties
 * @param {{namesJa?: object, modern?: object}} [dicts]
 */
export function renderPanel(el, properties, dicts = {}) {
  const m = buildPanelModel(properties, dicts);

  if (!m.nameEn) {
    el.innerHTML = '<p class="panel-hint">この領域には政体名が登録されていません。</p>';
    return m;
  }

  const parts = [];
  parts.push(`<h2 class="panel-name" data-testid="panel-name">${escapeHtml(m.nameJa)}</h2>`);
  if (m.hasTranslation) {
    parts.push(`<p class="panel-name-en">${escapeHtml(m.nameEn)}</p>`);
  }
  parts.push(
    `<dl class="panel-facts">`
    + `<dt>現在の国</dt><dd data-testid="panel-modern">${escapeHtml(m.modern)}</dd>`,
  );
  if (m.subjectEn) {
    parts.push(`<dt>宗主</dt><dd data-testid="panel-subject">${escapeHtml(m.subjectJa)}</dd>`);
  }
  parts.push('</dl>');

  el.innerHTML = parts.join('');
  return m;
}

/**
 * 出来事をパネルに描画する。
 * @param {HTMLElement} el
 * @param {{year:number,title_ja:string,summary_ja:string,source_url:string}} ev
 * @param {(year:number)=>string} formatYear 年ラベル整形
 */
export function renderEventPanel(el, ev, formatYear) {
  if (!ev) return null;
  const parts = [
    `<p class="panel-kicker" data-testid="panel-event-year">${escapeHtml(formatYear(ev.year))}</p>`,
    `<h2 class="panel-name" data-testid="panel-event-title">${escapeHtml(ev.title_ja ?? '')}</h2>`,
  ];
  if (ev.summary_ja) {
    parts.push(`<p class="panel-summary">${escapeHtml(ev.summary_ja)}</p>`);
  }
  if (ev.source_url) {
    parts.push(
      '<p class="panel-source">'
      + `<a href="${escapeHtml(ev.source_url)}" target="_blank" rel="noopener noreferrer">Wikipedia で読む</a>`
      + '</p>',
    );
  }
  el.innerHTML = parts.join('');
  return ev;
}
