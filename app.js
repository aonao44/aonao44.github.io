// エントリ。map 初期化と UI 結線だけを担当し、ロジックは src/ の各モジュールに置く。

// MapLibre GL JS v6 は ESM のみ配布されており、UMD グローバル (window.maplibregl) も
// default export も無い。名前付き export をここで import する。
import {
  Map as MapLibreMap,
  NavigationControl,
} from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.5.0/dist/maplibre-gl.mjs';

import {
  ERA_COUNT, eraAt, labelAt, formatYear, EraStore,
} from './src/eras.js';
import {
  addEraLayers, setEraData, addBorderLayer, setBordersVisible,
  addEventLayer, setEventData, addEraLabelLayer,
  ERA_FILL_LAYER, ERA_SOURCE, EVENTS_LAYER,
} from './src/layers.js';
import { renderPanel, renderEmpty, renderEventPanel } from './src/panel.js';
import { resolveYearInput } from './src/yearinput.js';
import { eventsForEra } from './src/events.js';

const el = {
  map: document.getElementById('map'),
  panel: document.getElementById('panel-body'),
  slider: document.getElementById('era-slider'),
  year: document.getElementById('year-label'),
  yearInput: document.getElementById('year-input'),
  yearHint: document.getElementById('year-hint'),
  loading: document.getElementById('loading'),
  borders: document.getElementById('borders-checkbox'),
  toast: document.getElementById('toast'),
  toastMsg: document.getElementById('toast-msg'),
  toastRetry: document.getElementById('toast-retry'),
  sheet: document.getElementById('panel'),
  sheetClose: document.getElementById('sheet-close'),
};

el.slider.max = String(ERA_COUNT - 1);

const store = new EraStore({ basePath: 'data/eras' });
const dicts = { namesJa: {}, modern: {} };
let nonStateRule = { patterns: [], exceptions: [], explicit: [] };
let allEvents = [];
/** 日本語化した下地ラベルレイヤー数（テスト用）。 */
let localisedLayers = 0;

/** 現在表示中の断面インデックス（ロード成功したもの）。 */
let shownIndex = -1;
/** ロード要求の世代。古い応答で新しい表示を上書きしないため。 */
let requestSeq = 0;
/** 地図レイヤーの準備ができたか。'load' 前のスライダー操作を待たせるのに使う。 */
let layersReady = false;
/** feature-state で強調中のポリゴン id。 */
let selectedId = null;

renderEmpty(el.panel);

// --- 地図 ---
/** 下地スタイル。ベクタなのでラベルの言語を差し替えられる。positron = 最も淡い */
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

const map = new MapLibreMap({
  container: 'map',
  style: BASEMAP_STYLE,
  center: [20, 25],
  zoom: 1.6,
  hash: false,
  // 漢字・ひらがな・カタカナはグリフを取りに行かずローカルフォントで描く。
  // 下地の配るフォントスタックに CJK が入っているとは限らず、
  // 入っていないと豆腐(□)になるため。
  localIdeographFontFamily: "'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif",
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

// --- 選択の強調 ---
function clearSelection() {
  if (selectedId === null) return;
  map.setFeatureState({ source: ERA_SOURCE, id: selectedId }, { selected: false });
  selectedId = null;
}
function select(id) {
  clearSelection();
  if (id === undefined || id === null) return;
  selectedId = id;
  map.setFeatureState({ source: ERA_SOURCE, id }, { selected: true });
}

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

    // 地図の 'load' 前に呼ばれるとレイヤーがまだ無い。これはロード失敗ではないので、
    // トーストを出さずに準備できるまで待ってから描く。
    if (!layersReady) {
      await new Promise((resolve) => { map.once('load', resolve); });
      if (seq !== requestSeq) return;
    }

    clearSelection();
    setEraData(map, geojson, nonStateRule, dicts.namesJa);
    setEventData(map, eventsForEra(index, allEvents));
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
  // スライダーで動かしたら、年入力に対する「寄せました」表示は用済み
  el.yearHint.textContent = '';
  el.yearInput.classList.remove('is-invalid');
  showEra(Number(el.slider.value));
});

/** スライダー・ラベル・地図をまとめて指定インデックスに移す。 */
function goTo(index) {
  el.slider.value = String(index);
  syncLabel(index);
  return showEra(index);
}

// --- 年を打ち込んで飛ぶ ---
/**
 * 入力された年の断面へ移動する。
 * 断面は48しかないので、打った年ちょうどの断面はまず無い。
 * その年に有効だった最後の断面へ寄せ、寄せた場合はその旨を小さく出す。
 */
let lastAppliedYearInput = null;

function jumpToTypedYear() {
  const raw = el.yearInput.value;
  const result = resolveYearInput(raw);

  if (!result.ok) {
    el.yearInput.classList.toggle('is-invalid', result.reason === 'unparsable');
    el.yearHint.textContent = result.reason === 'unparsable'
      ? '年を読み取れません（例: 117 / 紀元前500 / BC500）'
      : '';
    return;
  }

  el.yearInput.classList.remove('is-invalid');
  el.yearHint.textContent = result.snapped
    ? `→ ${labelAt(result.index)}の断面を表示`
    : '';
  lastAppliedYearInput = raw;
  goTo(result.index);
}

el.yearInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  jumpToTypedYear();
});

// フォーカスを外した時も反映する。ただし内容が前回と同じなら何もしない
// （入力欄をクリックして離れただけで、スライダーで選び直した断面が
//   打ち込んだ年に引き戻されるのを防ぐ）。
el.yearInput.addEventListener('blur', () => {
  if (el.yearInput.value === lastAppliedYearInput) return;
  jumpToTypedYear();
});

// --- パネル ---
/** モバイルではパネルが下からのシートなので、選択時に開く。 */
function openSheet() {
  el.sheet.classList.add('is-open');
}

// 出来事の点を版図より優先して拾う（点の方が小さく、狙ってクリックされるため）
map.on('click', EVENTS_LAYER, (e) => {
  const f = e.features?.[0];
  if (!f) return;
  clearSelection();
  renderEventPanel(el.panel, f.properties, formatYear);
  openSheet();
});

map.on('click', ERA_FILL_LAYER, (e) => {
  // 出来事の点の上なら、そちらのハンドラに任せる
  if (map.queryRenderedFeatures(e.point, { layers: [EVENTS_LAYER] }).length) return;

  const feature = e.features?.[0];
  if (!feature) return;
  select(feature.id);
  renderPanel(el.panel, feature.properties, dicts);
  openSheet();
});

for (const layer of [ERA_FILL_LAYER, EVENTS_LAYER]) {
  map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
}

// --- 現代国境トグル ---
el.borders.addEventListener('change', () => {
  setBordersVisible(map, el.borders.checked);
});

// --- モバイル: シートを閉じる ---
el.sheetClose.addEventListener('click', () => {
  el.sheet.classList.remove('is-open');
});

// --- 起動 ---
/** 任意データ。取得できなくてもフォールバックで動く（spec）。 */
async function loadJson(path, fallback) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch (err) {
    console.warn(`optional data not loaded: ${path}`, err);
    return fallback;
  }
}

/**
 * 下地の地名ラベルを日本語にする。
 * OpenMapTiles の place/poi などは name:ja を持っているので、
 * 全 symbol レイヤーの text-field を name:ja 優先に差し替える。
 * name:ja が無い地物は name:latin → name の順にフォールバックする。
 * @returns {number} 差し替えたレイヤー数
 */
function localiseBasemapLabels() {
  let changed = 0;
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'symbol') continue;
    if (!layer.layout || layer.layout['text-field'] === undefined) continue;
    map.setLayoutProperty(layer.id, 'text-field', [
      'coalesce',
      ['get', 'name:ja'],
      ['get', 'name:latin'],
      ['get', 'name'],
    ]);
    changed += 1;
  }
  return changed;
}

/** 下地の最初の symbol(ラベル)レイヤー ID。版図の塗りをこの下に入れる。 */
function firstSymbolLayerId() {
  const found = map.getStyle().layers.find((l) => l.type === 'symbol');
  return found?.id;
}

map.on('load', async () => {
  localisedLayers = localiseBasemapLabels();

  // 版図の塗りは下地のラベルより下に入れる。上に載せると
  // 不透明度 0.55 の塗りが地名を覆って読めなくなる。
  addEraLayers(map, firstSymbolLayerId());
  // 政体名と出来事は最前面（下地のラベルより上）
  addEraLabelLayer(map);
  addEventLayer(map);
  layersReady = true;

  // 現代国境は任意。失敗してもアプリ本体は動かす。
  loadJson('data/modern-borders.geojson', null).then((geo) => {
    if (geo) addBorderLayer(map, geo, el.borders.checked);
  });

  const [namesJa, modern, rule, events] = await Promise.all([
    loadJson('data/names.ja.json', {}),
    loadJson('data/modern.json', {}),
    loadJson('data/nonstate.json', { patterns: [], exceptions: [], explicit: [] }),
    loadJson('data/events.json', []),
  ]);
  dicts.namesJa = namesJa;
  dicts.modern = modern;
  nonStateRule = rule;
  allEvents = events;

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
  eventsForEra,
  jumpToTypedYear,
  get events() { return allEvents; },
  get nonStateRule() { return nonStateRule; },
  get shownIndex() { return shownIndex; },
  get selectedId() { return selectedId; },
  get localisedLayers() { return localisedLayers; },
};
