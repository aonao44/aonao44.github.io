// 版図ポリゴン / 現代国境 / 出来事 レイヤーの追加・差し替えと、政体名から色を決める処理。

import { compileNonStateRule, isNonState, EMPTY_RULE } from './nonstate.js';
import { buildLabelFeatures } from './labelpoint.js';

/** MapLibre のソース/レイヤー ID。 */
export const ERA_SOURCE = 'era';
export const ERA_FILL_LAYER = 'era-fill';
export const ERA_OUTLINE_LAYER = 'era-outline';
export const ERA_SELECTED_LAYER = 'era-selected';
export const ERA_LABEL_LAYER = 'era-label';
export const ERA_LABEL_SOURCE = 'era-labels';

/** これより小さい政体には地図上のラベルを出さない(km^2)。狭い所の字潰れを防ぐ。 */
export const LABEL_MIN_AREA = 20000;
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

// 海に予約する色相帯。政体には一切割り当てない。
// 「青＝海」を地図上で一意に読ませるための取り決めで、ここを空けておかないと
// 青系の色を引いた政体が海と見分けられなくなる。
export const WATER_HUE_MIN = 190;
export const WATER_HUE_MAX = 250;
const WATER_HUE_SPAN = WATER_HUE_MAX - WATER_HUE_MIN + 1;
const POLITY_HUE_SPAN = 360 - WATER_HUE_SPAN;

// 黄金比の小数部。ハッシュに掛けて小数部を取ると、剰余より色相が均等に散る。
// 帯を空けて色相が 299 個に減った分の詰まりを、この分散で取り返している。
// (実測: 2548 政体で同色相の最大重複が 剰余 21 → 黄金比 16。帯を空ける前の
//  360 色相版が 15 なので、青を手放しても見分けやすさはほぼ落ちない)
const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

/**
 * NAME から色相を決める。同じ NAME なら断面をまたいで必ず同じ色相になる。
 * 海の色相帯 (WATER_HUE_MIN–WATER_HUE_MAX) は飛ばす。
 * @param {string|null|undefined} name
 * @returns {number} 0–359（海の帯を除く）
 */
export function hueForName(name) {
  if (!name) return 0;
  const spread = (hashString(String(name)) * GOLDEN_RATIO_CONJUGATE) % 1;
  const hue = Math.floor(spread * POLITY_HUE_SPAN);
  return hue < WATER_HUE_MIN ? hue : hue + WATER_HUE_SPAN;
}

// 彩度・明度は固定して色相だけを振る。こうすると隣り合う政体が
// 「同じ濃さの違う色」になり、境界が明度差ではなく色相差で読める。
const FILL_SAT = 68;
const FILL_LIGHT = 52;
const STROKE_SAT = 72;
const STROKE_LIGHT = 28;

// 非国家の文化圏は色相を持たせず無彩色にする。
// 薄塗り(NONSTATE_FILL_OPACITY)で描くと、シアン寄りの色相を引いた文化圏が
// 淡いミント色になり海と紛らわしかった。灰なら青と competing しない。
// 「色相が付いているもの = 政体」「無彩色 = 政体ではない」という読み方にもなる。
//
// colorForName に真偽値の第2引数を足さないこと。names.map(colorForName) が
// インデックスを渡してしまい、2件目以降が黙って非国家扱いになる。
export const NONSTATE_FILL = `hsl(0, 0%, ${FILL_LIGHT}%)`;
export const NONSTATE_STROKE = `hsl(0, 0%, ${STROKE_LIGHT}%)`;

/**
 * 政体名から塗り色を決める。非国家は NONSTATE_FILL を使う（decorateEra が振り分ける）。
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

const EARTH_R = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;

/** 球面上の環の面積(km^2)。符号は無視する。 */
function ringArea(ring) {
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    total += (toRad(x2) - toRad(x1)) * (2 + Math.sin(toRad(y1)) + Math.sin(toRad(y2)));
  }
  return Math.abs((total * EARTH_R * EARTH_R) / 2);
}

/**
 * ポリゴン/マルチポリゴンのおおよその面積(km^2)。
 * ラベルの文字サイズを決めるためだけに使うので、穴は外周から引く程度の精度でよい。
 * @param {object|null} geometry
 * @returns {number}
 */
export function geometryArea(geometry) {
  if (!geometry) return 0;
  const poly = (rings) => rings.reduce((s, r, i) => s + (i === 0 ? ringArea(r) : -ringArea(r)), 0);
  if (geometry.type === 'Polygon') return Math.max(0, poly(geometry.coordinates));
  if (geometry.type === 'MultiPolygon') {
    return Math.max(0, geometry.coordinates.reduce((s, p) => s + poly(p), 0));
  }
  return 0;
}

/**
 * 断面 GeoJSON の各 feature に描画用プロパティを焼き込む。
 * MapLibre の式ではハッシュも非国家判定も対訳引きもできないため、ここで前処理する。
 * 元データは変更せず、新しい FeatureCollection を返す。
 *
 * @param {object} geojson
 * @param {object} [nonStateRule] data/nonstate.json の中身
 * @param {Record<string,string>} [namesJa] 日本語対訳（地図上のラベルに使う）
 * @returns {object}
 */
export function decorateEra(geojson, nonStateRule = EMPTY_RULE, namesJa = {}) {
  const compiled = compileNonStateRule(nonStateRule);
  const features = (geojson?.features ?? []).map((f) => {
    // 元データには末尾に空白が付いた NAME が混ざっている ("Pomeranian culture ")。
    // 対訳表のキーは trim 済みなので、ここで正規化しないと対訳が引けない。
    const raw = f.properties?.NAME;
    const name = typeof raw === 'string' ? (raw.trim() || null) : (raw ?? null);
    const nonstate = isNonState(name, compiled);
    return {
      ...f,
      properties: {
        ...f.properties,
        NAME: name,
        _color: nonstate ? NONSTATE_FILL : colorForName(name),
        _stroke: nonstate ? NONSTATE_STROKE : strokeForName(name),
        _nonstate: nonstate,
        // 地図上に出す政体名。対訳が無ければ英語のまま（spec のフォールバック方針）
        _label: name ? (namesJa[name] ?? name) : '',
        _area: Math.round(geometryArea(f.geometry)),
      },
    };
  });
  return { type: 'FeatureCollection', features };
}

/**
 * 版図レイヤーを地図に追加する（初回のみ）。データは空で始める。
 * @param {import('maplibre-gl').Map} map
 * @param {string} [beforeId] このレイヤーの下に差し込む。
 *   下地の地名ラベルより下に入れることで、塗りが地名を覆い隠さないようにする。
 */
export function addEraLayers(map, beforeId) {
  if (map.getSource(ERA_SOURCE)) return;
  // beforeId が実在しない場合に addLayer が投げるのを避ける
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;

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
  }, before);

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
  }, before);

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
  }, before);
}

/**
 * 政体名を地図上に出す symbol レイヤー。
 *
 * 版図ポリゴンに直接張らず、専用の Point ソース(ERA_LABEL_SOURCE)に張る。
 * ポリゴンに張ると MapLibre がタイルごとにラベルを置くため、広い版図が
 * 画面上で同じ名前を何度も繰り返してしまう（北極圏の狩猟民が5回出た）。
 * 点は setEraData が政体ごとに1つだけ作る。
 *
 * 文字サイズは版図の面積で変える（大きな帝国ほど大きく）。日本語のグリフは
 * Map 側の localIdeographFontFamily でローカル描画するため、
 * text-font には下地スタイルが配っている欧文フォントを指定しておけばよい。
 *
 * @param {import('maplibre-gl').Map} map
 */
export function addEraLabelLayer(map) {
  if (map.getLayer(ERA_LABEL_LAYER)) return;
  if (!map.getSource(ERA_LABEL_SOURCE)) {
    map.addSource(ERA_LABEL_SOURCE, { type: 'geojson', data: EMPTY_FC });
  }
  map.addLayer({
    id: ERA_LABEL_LAYER,
    type: 'symbol',
    source: ERA_LABEL_SOURCE,
    layout: {
      'text-field': ['get', '_label'],
      // 太字。政体名がこの地図の主役なので、下地の現代地名より重く見せる
      'text-font': ['Noto Sans Bold'],
      // 面積(km^2)で字の大きさを変える。極端に差がつかないよう幅は抑える
      'text-size': [
        'interpolate', ['linear'], ['get', '_area'],
        50000, 12,
        500000, 14,
        3000000, 17,
        12000000, 22,
      ],
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-padding': 4,
      'text-max-width': 8,
      // 入りきらないラベルは出さない。大きい政体を優先する
      'symbol-sort-key': ['-', 0, ['get', '_area']],
    },
    paint: {
      // 政体名はその政体の色（濃いめ）で描く。下地の現代地名は黒なので、
      // 「今の国名」と「当時の政体名」がひと目で区別できる。
      // 非国家は控えめの灰色にして、国家名を先に読ませる。
      'text-color': ['case', ['get', '_nonstate'], '#78787d', ['coalesce', ['get', '_stroke'], '#1a1a1c']],
      'text-halo-color': 'rgba(255,255,255,0.95)',
      'text-halo-width': 1.8,
      'text-opacity': ['case', ['get', '_nonstate'], 0.8, 1],
    },
  });
}

/**
 * 表示中の断面データを差し替える。
 * @param {import('maplibre-gl').Map} map
 * @param {object} geojson 断面 GeoJSON（未加工）
 * @param {object} [nonStateRule]
 */
export function setEraData(map, geojson, nonStateRule = EMPTY_RULE, namesJa = {}) {
  const src = map.getSource(ERA_SOURCE);
  if (!src) throw new Error('era source is not added yet');
  const decorated = decorateEra(geojson, nonStateRule, namesJa);
  src.setData(decorated);

  // 政体ごとに1点だけのラベル。ポリゴンに直接 symbol を張るとタイルごとに
  // ラベルが複製されて同じ名前が画面に何度も出てしまうため、点を別に作る。
  const labels = map.getSource(ERA_LABEL_SOURCE);
  if (labels) labels.setData(buildLabelFeatures(decorated.features, LABEL_MIN_AREA));
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
