// 政体名ラベルを置く「内側の代表点」の計算。
//
// なぜ必要か:
// ポリゴンに直接 symbol レイヤーを張ると、MapLibre はタイルごとにラベルを置くため、
// 大きな版図（北極圏の狩猟民など）が画面上で何度も同じ名前を繰り返してしまう。
// 政体ごとに Point を1つだけ作って別ソースに入れれば、ラベルは必ず1つになる。

/** 環の符号付き面積（平面近似。大小比較にしか使わない）。 */
function planarArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    s += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return Math.abs(s / 2);
}

/** 点が環の内側か（レイキャスティング）。 */
export function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** 外周に入っていて、かつどの穴にも入っていない。 */
function pointInPolygon(point, rings) {
  if (!rings.length || !pointInRing(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(point, rings[i])) return false;
  }
  return true;
}

/** 環の重心。 */
function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  for (const [px, py] of ring) { x += px; y += py; }
  return [x / ring.length, y / ring.length];
}

/**
 * 指定した緯度で水平に走査し、内側に入っている最も広い区間の中点を返す。
 * 重心が図形の外に落ちる三日月形・コの字形のための保険。
 */
function scanlineMidpoint(rings, y) {
  const xs = [];
  // 外周だけでなく穴の交点も境界候補にする。外周区間の単純な中点が
  // 大きな穴へ落ちる Madagascar などでも、穴の左右の内側区間を選べる。
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y)) {
        xs.push(xi + ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON));
      }
    }
  }
  xs.sort((a, b) => a - b);
  let best = null;
  let bestWidth = -1;
  // 穴があると「外周の交点を2個ずつ」では区間を表せない。
  // 隣り合う全交点間を調べ、実際にポリゴン内の区間だけを採る。
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const mid = (xs[i] + xs[i + 1]) / 2;
    const width = xs[i + 1] - xs[i];
    if (width > bestWidth && pointInPolygon([mid, y], rings)) {
      bestWidth = width;
      best = [mid, y];
    }
  }
  return best;
}

/**
 * 頂点と同じ緯度を避けた走査線を網羅し、最も広い内側区間の中点を返す。
 * 有効な面を持つポリゴンなら、隣接する頂点緯度の間のどこかに必ず内側区間がある。
 */
function exhaustiveScanlineMidpoint(rings) {
  const ys = [...new Set(rings.flat().map((point) => point[1]).filter(Number.isFinite))]
    .sort((a, b) => a - b);
  let best = null;
  let bestWidth = -1;
  for (let i = 0; i + 1 < ys.length; i += 1) {
    if (ys[i] === ys[i + 1]) continue;
    const y = (ys[i] + ys[i + 1]) / 2;
    const point = scanlineMidpoint(rings, y);
    if (!point) continue;

    // 同じ関数内で幅を再取得する代わりに、境界までの水平距離を比較する。
    // フォールバック用途なので、厳密な pole of inaccessibility より確実な内点を優先する。
    let nearest = Infinity;
    for (const ring of rings) {
      for (const [x] of ring) nearest = Math.min(nearest, Math.abs(point[0] - x));
    }
    if (nearest > bestWidth) {
      bestWidth = nearest;
      best = point;
    }
  }
  return best;
}

/**
 * ポリゴン/マルチポリゴンの内側にある代表点を返す。
 * 最大の多角形を選び、その重心を使う。重心が外に落ちる形なら走査線で拾い直す。
 *
 * @param {object|null} geometry
 * @returns {[number, number]|null}
 */
export function interiorPoint(geometry) {
  if (!geometry) return null;

  /** @type {Array<Array<Array<[number,number]>>>} */
  let polygons;
  if (geometry.type === 'Polygon') polygons = [geometry.coordinates];
  else if (geometry.type === 'MultiPolygon') polygons = geometry.coordinates;
  else return null;

  polygons = polygons.filter((rings) => rings?.[0]?.length >= 3);
  if (!polygons.length) return null;

  // 最大の多角形にラベルを置く（飛び地ではなく本体に出したい）
  let biggest = polygons[0];
  let biggestArea = planarArea(biggest[0]);
  for (const rings of polygons.slice(1)) {
    const a = planarArea(rings[0]);
    if (a > biggestArea) { biggestArea = a; biggest = rings; }
  }

  const centroid = ringCentroid(biggest[0]);
  if (pointInPolygon(centroid, biggest)) return centroid;

  const scanned = scanlineMidpoint(biggest, centroid[1]);
  if (scanned) return scanned;

  // 頂点を返すとラベルが版図の外へ見える。頂点緯度の間を網羅して必ず内点を探し、
  // 面積ゼロなどの壊れた geometry だけ null にする。
  return exhaustiveScanlineMidpoint(biggest);
}

/**
 * 装飾済みの断面 feature から、政体ごとに1点だけのラベル用 FeatureCollection を作る。
 * 同じ NAME が複数の feature に分かれている場合は、最も広いものにラベルを置く。
 *
 * @param {Array} features decorateEra 済みの features
 * @param {number} [minArea] これより小さい政体にはラベルを出さない(km^2)
 * @returns {object} FeatureCollection<Point>
 */
export function buildLabelFeatures(features = [], minArea = 0) {
  /** @type {Map<string, {area:number, feature:object}>} */
  const biggestByName = new Map();

  for (const f of features) {
    const label = f.properties?._label;
    if (!label) continue;
    const area = f.properties?._area ?? 0;
    if (area < minArea) continue;
    const prev = biggestByName.get(label);
    if (!prev || area > prev.area) biggestByName.set(label, { area, feature: f });
  }

  const out = [];
  for (const { area, feature } of biggestByName.values()) {
    const point = interiorPoint(feature.geometry);
    if (!point) continue;
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: point },
      properties: {
        _label: feature.properties._label,
        _nonstate: feature.properties._nonstate === true,
        _area: area,
        // 塗りと同じ色相の濃い色。ラベルを政体の色に揃えると、
        // 下地の現代地名（黒）と歴史側の政体名を一目で見分けられる
        _stroke: feature.properties._stroke ?? '#1a1a1c',
        NAME: feature.properties.NAME ?? null,
      },
    });
  }
  return { type: 'FeatureCollection', features: out };
}
