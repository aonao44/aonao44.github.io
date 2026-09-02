// 版図ポリゴン / 現代国境 レイヤーの追加・差し替えと、政体名から色を決める処理。

/** MapLibre のソース/レイヤー ID。 */
export const ERA_SOURCE = 'era';
export const ERA_FILL_LAYER = 'era-fill';
export const ERA_OUTLINE_LAYER = 'era-outline';
export const BORDERS_SOURCE = 'modern-borders';
export const BORDERS_LAYER = 'modern-borders-line';

/** 版図ポリゴンの塗り透明度（spec: 40%）。 */
export const ERA_FILL_OPACITY = 0.4;

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
 * 政体名から塗り色を決める。NAME が同じなら断面をまたいで必ず同じ色になる。
 * 彩度・明度は固定し、色相だけをハッシュから散らすことで
 * 下地の地図の上でも読みやすい明るさに揃える。
 * @param {string|null|undefined} name
 * @returns {string} hsl() 文字列
 */
export function colorForName(name) {
  if (!name) return 'hsl(0, 0%, 60%)';
  const h = hashString(String(name));
  const hue = h % 360;
  const sat = 55 + ((h >>> 9) % 25); // 55–79%
  const light = 45 + ((h >>> 17) % 15); // 45–59%
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/**
 * 断面 GeoJSON の各 feature に描画用プロパティ（色）を焼き込む。
 * MapLibre の式でハッシュは計算できないため、ここで前処理する。
 * 元データは変更せず、新しい FeatureCollection を返す。
 * @param {object} geojson
 * @returns {object}
 */
export function decorateEra(geojson) {
  const features = (geojson?.features ?? []).map((f) => {
    const name = f.properties?.NAME ?? null;
    return {
      ...f,
      properties: {
        ...f.properties,
        NAME: name,
        _color: colorForName(name),
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

  map.addSource(ERA_SOURCE, { type: 'geojson', data: EMPTY_FC });

  map.addLayer({
    id: ERA_FILL_LAYER,
    type: 'fill',
    source: ERA_SOURCE,
    paint: {
      'fill-color': ['coalesce', ['get', '_color'], 'hsl(0, 0%, 60%)'],
      // BORDERPRECISION が低い(=境界が曖昧)ほど薄くして「にじみ」を表す
      'fill-opacity': [
        'case',
        ['==', ['get', 'BORDERPRECISION'], 1], ERA_FILL_OPACITY * 0.7,
        ERA_FILL_OPACITY,
      ],
    },
  });

  map.addLayer({
    id: ERA_OUTLINE_LAYER,
    type: 'line',
    source: ERA_SOURCE,
    paint: {
      // 境界はぼかす方向に。細く・薄く・同系色でふちどる
      'line-color': ['coalesce', ['get', '_color'], 'hsl(0, 0%, 45%)'],
      'line-width': 1,
      'line-opacity': 0.55,
      'line-blur': 1.5,
    },
  });
}

/**
 * 表示中の断面データを差し替える。
 * @param {import('maplibre-gl').Map} map
 * @param {object} geojson 断面 GeoJSON（未加工）
 */
export function setEraData(map, geojson) {
  const src = map.getSource(ERA_SOURCE);
  if (!src) throw new Error('era source is not added yet');
  src.setData(decorateEra(geojson));
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
      'line-color': '#2b2b2b',
      'line-width': 0.8,
      'line-opacity': 0.75,
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
