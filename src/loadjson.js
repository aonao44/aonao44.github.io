import { isFeatureCollection } from './geojson.js';

const isRecord = (value) => Boolean(
  value && typeof value === 'object' && !Array.isArray(value),
);
const isString = (value) => typeof value === 'string';
const isStringArray = (value) => Array.isArray(value) && value.every(isString);

/** optional JSON ごとの最低限の実行時型検証。 */
export const JSON_VALIDATORS = Object.freeze({
  featureCollection: isFeatureCollection,
  names: (value) => isRecord(value) && Object.values(value).every(isString),
  modern: (value) => isRecord(value) && Object.values(value)
    .every((entry) => isString(entry) || isStringArray(entry)),
  nonStateRule: (value) => isRecord(value)
    && ['patterns', 'exceptions', 'explicit'].every((key) => isStringArray(value[key])),
  events: (value) => Array.isArray(value) && value.every((entry) => (
    isRecord(entry)
    && Number.isFinite(entry.year)
    && Number.isFinite(entry.lat)
    && Number.isFinite(entry.lng)
    && isString(entry.title_ja)
    && isString(entry.summary_ja)
    && isString(entry.source_url)
  )),
  topics: (value) => isRecord(value) && Object.values(value).every(Array.isArray),
  overviews: (value) => isRecord(value) && Object.values(value).every(isString),
  polityInfo: (value) => isRecord(value) && Object.values(value).every(isRecord),
  nameEras: (value) => isRecord(value) && Object.values(value).every(isStringArray),
  subjectAliases: (value) => isRecord(value) && Object.values(value)
    .every((entry) => isString(entry) || isStringArray(entry)),
});

/**
 * 任意JSONをタイムアウト付きで読み、期待型でなければフォールバックする。
 * @param {string} path
 * @param {*} fallback
 * @param {{validate?:(value:*)=>boolean, timeoutMs?:number, fetchImpl?:typeof fetch}} [options]
 */
export async function loadJson(path, fallback, options = {}) {
  const {
    validate = () => true,
    timeoutMs = 10000,
    fetchImpl = (...args) => globalThis.fetch(...args),
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);

  try {
    const res = await fetchImpl(path, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText || ''}`.trim());
    const value = await res.json();
    if (!validate(value)) throw new TypeError(`unexpected JSON shape: ${path}`);
    return value;
  } catch (err) {
    console.warn(`optional data not loaded: ${path}`, err);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
