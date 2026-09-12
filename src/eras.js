// 断面(era)一覧・年ラベル整形・遅延ロード + メモリキャッシュ。
// DOM に依存しないので node:test からそのまま import できる。

/** 断面 ID 一覧（時系列昇順）。data/eras/<id>.geojson に対応する。 */
export const ERA_IDS = [
  'bc3000', 'bc2000', 'bc1500', 'bc1000', 'bc700', 'bc500', 'bc400', 'bc323',
  // bc221 だけは上流に断面が無く、scripts/build-bc221.mjs が bc300 から合成している。
  // 秦の統一(前221-206)が bc300 と bc200 の間に丸ごと落ちてしまうため。
  'bc300', 'bc221', 'bc200', 'bc100', 'bc1',
  '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000',
  '1100', '1200', '1279', '1300', '1400', '1492', '1500', '1530', '1600', '1650',
  '1700', '1715', '1783', '1800', '1815', '1880', '1900', '1914', '1920', '1930',
  '1938', '1945', '1960', '1994', '2000', '2010',
];

/**
 * 断面 ID を符号付きの年に変換する。'bc3000' -> -3000, '117' -> 117。
 * @param {string} id
 * @returns {number}
 */
export function eraIdToYear(id) {
  if (typeof id !== 'string') throw new TypeError(`era id must be a string: ${id}`);
  const m = /^(bc)?(\d+)$/.exec(id);
  if (!m) throw new Error(`invalid era id: ${id}`);
  const n = Number(m[2]);
  return m[1] ? -n : n;
}

/** 断面一覧（ID と年の組）。 */
export const ERAS = ERA_IDS.map((id) => ({ id, year: eraIdToYear(id) }));

/** 断面の総数。スライダーの段階数と一致する。 */
export const ERA_COUNT = ERAS.length;

/**
 * 年を日本語ラベルにする。負の年は「紀元前N年」、正の年は「N年」。
 * @param {number} year
 * @returns {string}
 */
export function formatYear(year) {
  if (!Number.isFinite(year)) throw new TypeError(`year must be finite: ${year}`);
  return year < 0 ? `紀元前${Math.abs(year)}年` : `${year}年`;
}

/**
 * スライダー位置を有効なインデックスに丸める。
 * @param {number} index
 * @returns {number} 0 <= n < ERA_COUNT
 */
export function clampIndex(index) {
  const n = Math.round(Number(index));
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n >= ERA_COUNT) return ERA_COUNT - 1;
  return n;
}

/**
 * インデックスから断面を取り出す（範囲外は丸める）。
 * @param {number} index
 * @returns {{id: string, year: number}}
 */
export function eraAt(index) {
  return ERAS[clampIndex(index)];
}

/**
 * インデックスに対応する年ラベル。
 * @param {number} index
 * @returns {string}
 */
export function labelAt(index) {
  return formatYear(eraAt(index).year);
}

/**
 * 断面 ID からインデックスを引く。見つからなければ -1。
 * @param {string} id
 * @returns {number}
 */
export function indexOfEra(id) {
  return ERA_IDS.indexOf(id);
}

/**
 * 断面 GeoJSON のローダ。ロード済みはメモリにキャッシュし、
 * 同一断面への同時リクエストは 1 本の Promise に束ねる。
 */
export class EraStore {
  /**
   * @param {{basePath?: string, fetchImpl?: typeof fetch}} [options]
   */
  constructor(options = {}) {
    this.basePath = options.basePath ?? 'data/eras';
    this.fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    /** @type {Map<string, object>} */
    this.cache = new Map();
    /** @type {Map<string, Promise<object>>} */
    this.inflight = new Map();
  }

  /** ロード済みか。 */
  has(id) {
    return this.cache.has(id);
  }

  /** キャッシュ済みの GeoJSON（未ロードなら undefined）。 */
  peek(id) {
    return this.cache.get(id);
  }

  /**
   * 断面を取得する。失敗時は reject（呼び出し側で前の断面を保持したままトースト表示する）。
   * @param {string} id
   * @returns {Promise<object>}
   */
  load(id) {
    if (this.cache.has(id)) return Promise.resolve(this.cache.get(id));
    const pending = this.inflight.get(id);
    if (pending) return pending;

    const url = `${this.basePath}/${id}.geojson`;
    const promise = this.fetchImpl(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText || ''} for ${url}`.trim());
        return res.json();
      })
      .then((geojson) => {
        this.cache.set(id, geojson);
        this.inflight.delete(id);
        return geojson;
      })
      .catch((err) => {
        this.inflight.delete(id);
        throw err;
      });

    this.inflight.set(id, promise);
    return promise;
  }
}
