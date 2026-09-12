/**
 * 紀元前221年の断面を、紀元前300年の断面から合成する。
 *
 * なぜ必要か。上流 aourednik/historical-basemaps は紀元前300年の次が紀元前200年で、
 * 秦の統一帝国(前221-206)はその100年の空白に丸ごと落ちている。前210年を見ようとすると
 * 紀元前300年の地図が出て、そこには秦と戦国六国が並んでいる。六国は前221年までに
 * すべて滅んでいるので、この表示は事実に反する。中国史上初の統一王朝が、
 * 世界史の地図から欠落したままになる。
 *
 * どう作るか。紀元前300年の「秦」と「戦国六国」は境界を共有して隣接しているので、
 * その二つを結合して一つの「秦」にする。座標は上流のものをそのまま使い、
 * 新しい線は一本も引かない。
 *
 * 何が正確でないか。
 *  - 秦が前221年に得た版図は戦国七雄の領域を継承したもので、この結合はその近似。
 *    オルドス地方の獲得(前215年ごろ)や長城以北の変化は反映していない。
 *  - 百越(嶺南)への進出は前214年なので、この断面には含めない。「越」は
 *    上流のまま別の政体として残す。
 *  - 元になった紀元前300年の東アジアは紀元前323年と幾何形状が完全に同一で、
 *    上流のこの地域の解像度自体が粗い。
 *
 * 出力は data/eras/bc221.geojson。上流から取得するものではないので
 * build-data.sh の取得対象には入れず、この場で生成して commit する。
 */
import polygonClipping from 'polygon-clipping';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ERA = 'bc300';
const OUT_ERA = 'bc221';

/** 結合して一つの秦にする政体。境界を共有しているのが前提。 */
const MERGE_INTO_QIN = ['Qin', 'Zhow states'];
const QIN = 'Qin';

const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const nameOf = (f) => (typeof f.properties?.NAME === 'string' ? f.properties.NAME.trim() : null);

/** GeoJSON の座標を polygon-clipping の形へ。Polygon も MultiPolygon も同じ形に揃える。 */
const toMulti = (geometry) => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates);

const source = read(`data/eras/${SOURCE_ERA}.geojson`);

const merging = source.features.filter((f) => f.geometry && MERGE_INTO_QIN.includes(nameOf(f)));
if (merging.length !== MERGE_INTO_QIN.length) {
  throw new Error(`結合対象が揃っていない: ${merging.map(nameOf).join(', ')}`);
}

const united = polygonClipping.union(...merging.map((f) => toMulti(f.geometry)));
if (united.length !== 1) {
  throw new Error(`結合結果が一つの塊にならなかった: ${united.length} 個。隣接していない可能性がある`);
}

// 属性は秦のものを引き継ぐ。同じ NAME なので断面をまたいで色も変わらない。
const qin = merging.find((f) => nameOf(f) === QIN);
const mergedFeature = {
  type: 'Feature',
  geometry: { type: 'MultiPolygon', coordinates: united },
  properties: { ...qin.properties, NAME: QIN, SUBJECTO: QIN },
};

const kept = source.features.filter((f) => !MERGE_INTO_QIN.includes(nameOf(f)));
const out = {
  type: 'FeatureCollection',
  _derived: {
    from: `${SOURCE_ERA}.geojson`,
    by: 'scripts/build-bc221.mjs',
    note: '上流に紀元前221年の断面が無いため、紀元前300年の秦と戦国六国を結合した近似。'
      + '座標は上流のまま。百越(前214年)とオルドス(前215年ごろ)は含まない。',
  },
  features: [mergedFeature, ...kept],
};

writeFileSync(join(root, `data/eras/${OUT_ERA}.geojson`), `${JSON.stringify(out)}\n`);

const ringCount = united[0].length;
console.log(`${OUT_ERA}.geojson を書き出した`);
console.log(`  結合: ${MERGE_INTO_QIN.join(' + ')} -> ${QIN} (環 ${ringCount} 本)`);
console.log(`  そのまま引き継いだ feature: ${kept.length} 件`);
