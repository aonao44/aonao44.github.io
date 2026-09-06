// GeoJSON のうち、このアプリが版図として描画できる形かを判定する。

const isPosition = (value) => (
  Array.isArray(value)
  && value.length >= 2
  && Number.isFinite(value[0])
  && Number.isFinite(value[1])
);

/** GeoJSON LinearRing として最低限描画できるか。 */
function isDrawableRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isPosition)) return false;
  // 全点が一直線または同一点の環は面を持たず、MapLibre でも版図として描けない。
  let twiceArea = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    twiceArea += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return Math.abs(twiceArea) > Number.EPSILON;
}

/** Polygon の座標が少なくとも1つの有効な外周を持つか。 */
function isDrawablePolygon(coordinates) {
  return Array.isArray(coordinates) && isDrawableRing(coordinates[0]);
}

/**
 * 版図レイヤーが扱う Polygon / MultiPolygon の描画可能性を判定する。
 * geometry:null や空・面積ゼロの環は false。
 */
export function isDrawableGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return false;
  if (geometry.type === 'Polygon') return isDrawablePolygon(geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return Array.isArray(geometry.coordinates)
      && geometry.coordinates.some(isDrawablePolygon);
  }
  return false;
}

/** 最低限の FeatureCollection 形状か。 */
export function isFeatureCollection(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.type === 'FeatureCollection'
    && Array.isArray(value.features),
  );
}
