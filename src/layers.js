// 版図ポリゴン / 現代国境 / 出来事 レイヤーの追加・差し替えと、政体名から色を決める処理。

import { compileNonStateRule, isNonState, EMPTY_RULE } from './nonstate.js';

/** MapLibre のソース/レイヤー ID。 */
export const ERA_SOURCE = 'era';
export const ERA_FILL_LAYER = 'era-fill';
export const ERA_OUTLINE_LAYER = 'era-outline';
export const ERA_SELECTED_LAYER = 'era-selected';
export const BORDERS_SOURCE = 'modern-borders';
export const BORDERS_LAYER = 'modern-borders-line';
export const EVENTS_SOURCE = 'events';
export const EVENTS_LAYER = 'events-point';

/** 国家ポリゴンの塗り透明度。 */
export const ERA_FILL_OPACITY = 0.55;
/** 非国家(狩猟採集民・遊牧民・考古学的文化)の塗り透明度。消さずに薄くする。 */
export const NONSTATE_FILL_OPACITY = 0.15;

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

/**
 * 文字列の安定ハッシュ（FNV-1a 32bit）。
 * 同じ NAME は断面をまたいでも必ず同じ値になる。
 * @param {string} str
 * @returns {number} 符号なし 32bit
 */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * NAME から色相を決める。同じ NAME なら断面をまたいで必ず同じ色相になる。
 * @param {string|null|undefined} name
 * @returns {number} 0–359
 */
export function hueForName(name) {
  if (!name) return 0;
  return hashString(String(name)) % 360;
}

// 彩度・明度は固定して色相だけを振る。こうすると隣り合う政体が
// 「同じ濃さの違う色」になり、境界が明度差ではなく色相差で読める。
const FILL_SAT = 68;
const FILL_LIGHT = 52;
const STROKE_SAT = 72;
const STROKE_LIGHT = 28;

/**
 * 政体名から塗り色を決める。
 * @param {string|null|undefined} name
 * @returns {string} hsl() 文字列
 */
export function colorForName(name) {
  if (!name) return `hsl(0, 0%, ${FILL_LIGHT}%)`;
  return `hsl(${hueForName(name)}, ${FILL_SAT}%, ${FILL_LIGHT}%)`;
}

/**
 * 塗り色と同じ色相の、より暗い輪郭色。
 * @param {string|null|undefined} name
 * @returns {string} hsl() 文字列
 */
export function strokeForName(name) {
  if (!name) return `hsl(0, 0%, ${STROKE_LIGHT}%)`;
  return `hsl(${hueForName(name)}, ${STROKE_SAT}%, ${STROKE_LIGHT}%)`;
}

/**
 * 断面 GeoJSON の各 feature に描画用プロパティを焼き込む。
 * MapLibre の式ではハッシュも非国家判定もできないため、ここで前処理する。
 * 元データは変更せず、新しい FeatureCollection を返す。
 * @param {object} geojson
 * @param {object} [nonStateRule] data/nonstate.json の中身
 * @returns {object}
 */
export function decorateEra(geojson, nonStateRule = EMPTY_RULE) {
  const compiled = compileNonStateRule(nonStateRule);
  const features = (geojson?.features ?? []).map((f) => {
    const name = f.properties?.NAME ?? null;
    return {
      ...f,
      properties: {
        ...f.properties,
        NAME: name,
        _color: colorForName(name),
        _stroke: strokeForName(name),
        _nonstate: isNonState(name, compiled),
      },
    };
  });
  return { type: 'FeatureCollection', features };
}

/**
 * 版図レイヤーを地図に追加する（初回のみ）。データは空で始める。
 * @param {import('maplibre-gl').Map} map
 */
export function addEraLayers(map) {
  if (map.getSource(ERA_SOURCE)) return;

  // generateId: クリックしたポリゴンだけを強調するのに feature-state を使うため。
  // 元データに id が無いので MapLibre に振らせる。
  map.addSource(ERA_SOURCE, { type: 'geojson', data: EMPTY_FC, generateId: true });

  map.addLayer({
    id: ERA_FILL_LAYER,
    type: 'fill',
    source: ERA_SOURCE,
    paint: {
      'fill-color': ['coalesce', ['get', '_color'], `hsl(0, 0%, ${FILL_LIGHT}%)`],
      'fill-opacity': [
        'case',
        // 非国家は消さずに薄く（狩猟採集民・遊牧民・考古学的文化）
        ['get', '_nonstate'], NONSTATE_FILL_OPACITY,
        // BORDERPRECISION が低い(=境界が曖昧)ほど薄くして「にじみ」を残す
        ['==', ['get', 'BORDERPRECISION'], 1], ERA_FILL_OPACITY * 0.8,
        ERA_FILL_OPACITY,
      ],
    },
  });

  map.addLayer({
    id: ERA_OUTLINE_LAYER,
    type: 'line',
    source: ERA_SOURCE,
    paint: {
      // 塗りと同じ色相の濃い線。政体どうしの境目がはっきり読める
      'line-color': ['coalesce', ['get', '_stroke'], `hsl(0, 0%, ${STROKE_LIGHT}%)`],
      'line-width': ['case', ['get', '_nonstate'], 0.5, 1],
      'line-opacity': ['case', ['get', '_nonstate'], 0.35, 0.9],
      // 境界の曖昧さはぼかしで表現する（にじんだ境界を残す）
      'line-blur': ['case', ['==', ['get', 'BORDERPRECISION'], 1], 2, 0.3],
    },
  });

  // クリックしたポリゴンだけ太い輪郭で強調する。
  // 注意: feature-state は layer の filter では使えない
  // ("feature-state data expressions are not supported with filters")。
  // 選択されていない間は線幅・不透明度を 0 にして消す。
  map.addLayer({
    id: ERA_SELECTED_LAYER,
    type: 'line',
    source: ERA_SOURCE,
    paint: {
      'line-color': ['coalesce', ['get', '_stroke'], '#1c1c1e'],
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 0],
      'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0],
    },
  });
}

/**
 * 表示中の断面データを差し替える。
 * @param {import('maplibre-gl').Map} map
 * @param {object} geojson 断面 GeoJSON（未加工）
 * @param {object} [nonStateRule]
 */
export function setEraData(map, geojson, nonStateRule = EMPTY_RULE) {
  const src = map.getSource(ERA_SOURCE);
  if (!src) throw new Error('era source is not added yet');
  src.setData(decorateEra(geojson, nonStateRule));
}

/**
 * 現代国境レイヤーを追加する。
 * @param {import('maplibre-gl').Map} map
 * @param {object} geojson Natural Earth 110m 国境線
 * @param {boolean} visible
 */
export function addBorderLayer(map, geojson, visible = true) {
  if (map.getSource(BORDERS_SOURCE)) return;
  map.addSource(BORDERS_SOURCE, { type: 'geojson', data: geojson });
  map.addLayer({
    id: BORDERS_LAYER,
    type: 'line',
    source: BORDERS_SOURCE,
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'line-color': '#2b2b2e',
      'line-width': 0.7,
      'line-opacity': 0.6,
    },
  });
}

/**
 * 現代国境の表示切替。
 * @param {import('maplibre-gl').Map} map
 * @param {boolean} visible
 */
export function setBordersVisible(map, visible) {
  if (!map.getLayer(BORDERS_LAYER)) return;
  map.setLayoutProperty(BORDERS_LAYER, 'visibility', visible ? 'visible' : 'none');
}

/**
 * 出来事レイヤーを追加する（データは空で始める）。
 * @param {import('maplibre-gl').Map} map
 */
export function addEventLayer(map) {
  if (map.getSource(EVENTS_SOURCE)) return;
  map.addSource(EVENTS_SOURCE, { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: EVENTS_LAYER,
    type: 'circle',
    source: EVENTS_SOURCE,
    paint: {
      'circle-radius': 5,
      'circle-color': '#fdf6e3',
      'circle-stroke-color': '#1c1c1e',
      'circle-stroke-width': 2,
      'circle-opacity': 0.95,
    },
  });
}

/**
 * 出来事を GeoJSON の点に変換する。
 * @param {Array<{year:number,lat:number,lng:number}>} events
 * @returns {object}
 */
export function eventsToGeoJSON(events = []) {
  return {
    type: 'FeatureCollection',
    features: events.map((e) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
      properties: { ...e },
    })),
  };
}

/**
 * 表示中の出来事を差し替える。
 * @param {import('maplibre-gl').Map} map
 * @param {Array} events
 */
export function setEventData(map, events) {
  const src = map.getSource(EVENTS_SOURCE);
  if (!src) return;
  src.setData(eventsToGeoJSON(events));
}
