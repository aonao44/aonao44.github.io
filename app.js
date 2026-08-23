// エントリ。map 初期化と UI 結線だけを担当し、ロジックは src/ の各モジュールに置く。

// MapLibre GL JS v6 は ESM のみ配布されており、UMD グローバル (window.maplibregl) も
// default export も無い。名前付き export をここで import する。
import {
  Map as MapLibreMap,
  NavigationControl,
} from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.5.0/dist/maplibre-gl.mjs';

import { ERA_COUNT, eraAt, labelAt, EraStore } from './src/eras.js';
import {
  addEraLayers, setEraData, addBorderLayer, setBordersVisible, ERA_FILL_LAYER,
} from './src/layers.js';
import { renderPanel, renderEmpty } from './src/panel.js';
import { Autoplay } from './src/slider.js';

const el = {
  map: document.getElementById('map'),
  panel: document.getElementById('panel-body'),
  slider: document.getElementById('era-slider'),
  year: document.getElementById('year-label'),
  play: document.getElementById('play'),
  loading: document.getElementById('loading'),
  borders: document.getElementById('borders-checkbox'),
  toast: document.getElementById('toast'),
  toastMsg: document.getElementById('toast-msg'),
  toastRetry: document.getElementById('toast-retry'),
};

el.slider.max = String(ERA_COUNT - 1);

const store = new EraStore({ basePath: 'data/eras' });
const dicts = { namesJa: {}, modern: {} };

/** 現在表示中の断面インデックス（ロード成功したもの）。 */
let shownIndex = -1;
/** ロード要求の世代。古い応答で新しい表示を上書きしないため。 */
let requestSeq = 0;

renderEmpty(el.panel);

// --- 地図 ---
const map = new MapLibreMap({
  container: 'map',
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  },
  center: [20, 25],
  zoom: 1.6,
  hash: false,
});
map.addControl(new NavigationControl({ showCompass: false }), 'top-left');

// --- トースト ---
let retryHandler = null;
function showToast(msg, onRetry) {
  el.toastMsg.textContent = msg;
  retryHandler = onRetry;
  el.toast.style.display = 'flex';
}
function hideToast() {
  el.toast.style.display = 'none';
  retryHandler = null;
}
el.toastRetry.addEventListener('click', () => {
  const fn = retryHandler;
  hideToast();
  if (fn) fn();
});

// --- 断面の表示 ---
/**
 * 指定インデックスの断面を表示する。
 * 失敗しても前の断面は表示したままにし、トーストで再試行を促す（spec）。
 */
async function showEra(index) {
  const era = eraAt(index);
  const seq = ++requestSeq;

  if (!store.has(era.id)) el.loading.textContent = '読込中…';

  try {
    const geojson = await store.load(era.id);
    if (seq !== requestSeq) return; // より新しい要求に追い越された
    setEraData(map, geojson);
    shownIndex = index;
    hideToast();
  } catch (err) {
    if (seq !== requestSeq) return;
    showToast(`${labelAt(index)}のデータを読み込めませんでした`, () => showEra(index));
    console.error('era load failed', era.id, err);
  } finally {
    if (seq === requestSeq) el.loading.textContent = '';
  }
}

// --- スライダー ---
function syncLabel(index) {
  el.year.textContent = labelAt(index);
}

// ドラッグ中はラベルだけ更新（spec）
el.slider.addEventListener('input', () => {
  syncLabel(Number(el.slider.value));
});

// 離した時に断面をロード（spec）
el.slider.addEventListener('change', () => {
  showEra(Number(el.slider.value));
});

// キーボード操作では change が input と同時に飛ぶため、上の 2 つで賄える。

/** スライダー・ラベル・地図をまとめて指定インデックスに移す。 */
function goTo(index) {
  el.slider.value = String(index);
  syncLabel(index);
  showEra(index);
}

// --- 自動再生 ---
const autoplay = new Autoplay({
  getIndex: () => Number(el.slider.value),
  onStep: (i) => goTo(i),
  onEnd: () => updatePlayButton(),
});

function updatePlayButton() {
  el.play.textContent = autoplay.playing ? '■' : '▶';
  el.play.title = autoplay.playing ? '停止' : '自動再生';
}

el.play.addEventListener('click', () => {
  autoplay.toggle();
  updatePlayButton();
});

// --- パネル ---
// 再生中はクリックで停止する（spec）。ポリゴン外（海など）をクリックしても
// 止まる必要があるので、レイヤー限定ではなく地図全体で受ける。
map.on('click', () => {
  if (!autoplay.playing) return;
  autoplay.stop();
  updatePlayButton();
});

map.on('click', ERA_FILL_LAYER, (e) => {
  const feature = e.features?.[0];
  if (!feature) return;
  renderPanel(el.panel, feature.properties, dicts);
});

map.on('mouseenter', ERA_FILL_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', ERA_FILL_LAYER, () => { map.getCanvas().style.cursor = ''; });

// --- 現代国境トグル ---
el.borders.addEventListener('change', () => {
  setBordersVisible(map, el.borders.checked);
});

// --- 起動 ---
/** 対訳・現在の国。取得できなくてもフォールバック表示で動く（spec）。 */
async function loadDicts() {
  const get = async (path) => {
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(String(res.status));
      return await res.json();
    } catch (err) {
      console.warn(`optional dictionary not loaded: ${path}`, err);
      return {};
    }
  };
  const [namesJa, modern] = await Promise.all([
    get('data/names.ja.json'),
    get('data/modern.json'),
  ]);
  dicts.namesJa = namesJa;
  dicts.modern = modern;
}

map.on('load', async () => {
  addEraLayers(map);

  // 現代国境は任意。失敗してもアプリ本体は動かす。
  fetch('data/modern-borders.geojson')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((geo) => addBorderLayer(map, geo, el.borders.checked))
    .catch((err) => console.warn('modern borders not loaded', err));

  await loadDicts();

  // ?era=<id or index> で初期断面を指定できる（スクリーンショット用）
  const params = new URLSearchParams(location.search);
  const raw = params.get('era');
  let start = 0;
  if (raw !== null) {
    const asIndex = Number(raw);
    if (Number.isInteger(asIndex) && asIndex >= 0 && asIndex < ERA_COUNT) {
      start = asIndex;
    } else {
      const { ERA_IDS } = await import('./src/eras.js');
      const i = ERA_IDS.indexOf(raw);
      if (i >= 0) start = i;
    }
  }
  goTo(start);
});

// テスト・デバッグ用のフック
window.imperia = {
  map,
  store,
  dicts,
  goTo,
  autoplay,
  get shownIndex() { return shownIndex; },
};
