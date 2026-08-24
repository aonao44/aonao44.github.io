// エントリ。map 初期化と UI 結線だけを担当し、ロジックは src/ の各モジュールに置く。

// MapLibre GL JS v6 は ESM のみ配布されており、UMD グローバル (window.maplibregl) も
// default export も無い。名前付き export をここで import する。
import {
  Map as MapLibreMap,
  NavigationControl,
} from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.5.0/dist/maplibre-gl.mjs';

import {
  ERA_COUNT, ERA_IDS, eraAt, labelAt, formatYear, indexOfEra, EraStore,
} from './src/eras.js';
import {
  addEraLayers, setEraData, addBorderLayer, setBordersVisible,
  addEventLayer, setEventData, addEraLabelLayer,
  ERA_FILL_LAYER, ERA_SOURCE, EVENTS_LAYER,
} from './src/layers.js';
import {
  renderPanel, renderEventPanel, renderTopics, prependBackLink, buildEraJumpModel,
} from './src/panel.js';
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
  sheetHandle: document.getElementById('sheet-handle'),
  legend: document.getElementById('legend'),
  legendToggle: document.getElementById('legend-toggle'),
};

el.slider.max = String(ERA_COUNT - 1);

const store = new EraStore({ basePath: 'data/eras' });
const dicts = { namesJa: {}, modern: {} };
let nonStateRule = { patterns: [], exceptions: [], explicit: [] };
let allEvents = [];
let allTopics = {};
let allOverviews = {};
let polityInfo = {};
let nameEras = {};
/** 断面を移った直後に選び直したい政体名（登場断面ジャンプ用）。 */
let pendingSelectName = null;
/** 下地ラベルの日本語化・格下げの結果（テスト用）。 */
let basemapLabelStats = { localised: 0, demoted: 0, cityLayers: 0 };

/** 現在表示中の断面インデックス（ロード成功したもの）。 */
let shownIndex = -1;
/** ロード要求の世代。古い応答で新しい表示を上書きしないため。 */
let requestSeq = 0;
/** 地図レイヤーの準備ができたか。'load' 前のスライダー操作を待たせるのに使う。 */
let layersReady = false;
/** feature-state で強調中のポリゴン id。 */
let selectedId = null;
/** 強調中の政体名（断面をまたいで選択を持ち越すのに使う）。 */
let selectedPolityName = null;

// 何も選んでいない間はトピック一覧を出す（起動直後は断面未確定なので空）
el.panel.innerHTML = '';

// --- 地図 ---
/** 下地スタイル。ベクタなのでラベルの言語を差し替えられる。positron = 最も淡い */
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

/** 都市名など下地の細かいラベルを出し始めるズーム。世界表示では国名だけにする。 */
const BASEMAP_DETAIL_MIN_ZOOM = 4;

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
  selectedPolityName = null;
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

    // 登場断面ジャンプの直後は、同じ政体を選び直して詳細を出したままにする
    const carry = pendingSelectName;
    pendingSelectName = null;
    if (carry && reselectPolity(carry)) {
      hideToast();
      return;
    }

    // それ以外は既定表示のトピック一覧に戻す
    showTopics();
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
  el.sheetHandle.setAttribute('aria-expanded', 'true');
}

/** 現在の断面のトピック一覧をパネルに出す（既定表示）。 */
function showTopics() {
  const era = eraAt(shownIndex < 0 ? Number(el.slider.value) : shownIndex);
  renderTopics(
    el.panel,
    formatYear(era.year),
    allTopics[era.id] ?? [],
    dicts.namesJa,
    allOverviews[era.id] ?? '',
  );
}

/** 断面 ID -> 年。 */
const yearOfEra = (id) => {
  const i = indexOfEra(id);
  return i >= 0 ? eraAt(i).year : 0;
};

/** 政体の詳細を出す。トピック一覧へ戻れるようにする。 */
function showPolity(properties) {
  const name = typeof properties?.NAME === 'string' ? properties.NAME.trim() : null;
  const currentEraId = shownIndex >= 0 ? eraAt(shownIndex).id : null;
  const eraJump = buildEraJumpModel(name, nameEras, currentEraId, yearOfEra, formatYear);
  selectedPolityName = name;
  renderPanel(el.panel, properties, { ...dicts, polityInfo, eraJump });
  const back = prependBackLink(el.panel);
  back.addEventListener('click', () => {
    clearSelection();
    showTopics();
  });
}

// トピックをクリック → その政体を強調して寄る
el.panel.addEventListener('click', (e) => {
  const btn = e.target.closest?.('.topic-btn');
  if (!btn) return;
  const name = btn.dataset.polity;
  if (!name) return;
  focusPolity(name);
});

// 登場する断面へジャンプ（政体は選んだまま持ち越す）
el.panel.addEventListener('click', (e) => {
  const btn = e.target.closest?.('.era-jump-btn');
  if (!btn || btn.disabled) return;
  const target = btn.dataset.eraTarget;
  if (!target) return;
  const index = indexOfEra(target);
  if (index < 0) return;
  // 今表示している政体名を覚えておき、移動先で選び直す
  pendingSelectName = selectedPolityName;
  goTo(index);
});

/**
 * 名前で政体を探し、強調して地図を寄せる。
 * 同名の feature が複数あるときは最も広いものに寄る。
 */
function focusPolity(name) {
  const feats = map.querySourceFeatures(ERA_SOURCE, {
    filter: ['==', ['get', 'NAME'], name],
  });
  if (!feats.length) return false;

  // querySourceFeatures はタイル単位で同じ feature を複数返すことがある。
  // 面積が最大のものを代表として選ぶ。
  let best = feats[0];
  for (const f of feats) {
    if ((f.properties?._area ?? 0) > (best.properties?._area ?? 0)) best = f;
  }

  const bbox = boundsOfFeatures(feats.filter((f) => f.properties?.NAME === name));
  if (bbox) map.fitBounds(bbox, { padding: 80, maxZoom: 5, duration: 800 });

  // 描画中の feature から id を取って強調する（feature-state には id が要る）
  const rendered = map.queryRenderedFeatures({ layers: [ERA_FILL_LAYER] })
    .filter((f) => f.properties?.NAME === name);
  if (rendered.length) select(rendered[0].id);

  showPolity(best.properties);
  openSheet();
  return true;
}

/**
 * 断面を移った直後に、同じ名前の政体を選び直して詳細を出す。
 * その断面に居なければ false を返す（呼び出し側がトピック一覧に戻す）。
 * @param {string} name
 * @returns {boolean}
 */
function reselectPolity(name) {
  const feats = map.querySourceFeatures(ERA_SOURCE).filter((f) => f.properties?.NAME === name);
  if (!feats.length) return false;

  let best = feats[0];
  for (const f of feats) {
    if ((f.properties?._area ?? 0) > (best.properties?._area ?? 0)) best = f;
  }

  // 強調は描画済み feature の id が要る。まだ描かれていなければ次の idle で拾う
  const highlight = () => {
    const rendered = map.queryRenderedFeatures({ layers: [ERA_FILL_LAYER] })
      .filter((f) => f.properties?.NAME === name);
    if (rendered.length) select(rendered[0].id);
  };
  highlight();
  map.once('idle', highlight);

  showPolity(best.properties);
  return true;
}

/** feature 群を覆う [[w,s],[e,n]]。 */
function boundsOfFeatures(features) {
  let w = Infinity;
  let s2 = Infinity;
  let e2 = -Infinity;
  let n = -Infinity;
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < w) w = x;
      if (x > e2) e2 = x;
      if (y < s2) s2 = y;
      if (y > n) n = y;
      return;
    }
    for (const c of coords) visit(c);
  };
  for (const f of features) {
    if (f.geometry?.coordinates) visit(f.geometry.coordinates);
  }
  return Number.isFinite(w) ? [[w, s2], [e2, n]] : null;
}

// 出来事の点を版図より優先して拾う（点の方が小さく、狙ってクリックされるため）
map.on('click', EVENTS_LAYER, (e) => {
  const f = e.features?.[0];
  if (!f) return;
  clearSelection();
  renderEventPanel(el.panel, f.properties, formatYear);
  prependBackLink(el.panel).addEventListener('click', showTopics);
  openSheet();
});

map.on('click', ERA_FILL_LAYER, (e) => {
  // 出来事の点の上なら、そちらのハンドラに任せる
  if (map.queryRenderedFeatures(e.point, { layers: [EVENTS_LAYER] }).length) return;

  const feature = e.features?.[0];
  if (!feature) return;
  select(feature.id);
  showPolity(feature.properties);
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

// --- モバイル: シートの開閉 ---
el.sheetClose.addEventListener('click', () => {
  el.sheet.classList.remove('is-open');
  el.sheetHandle.setAttribute('aria-expanded', 'false');
});

// ハンドル（「この時代のトピック」）でシートを開閉する
el.sheetHandle.addEventListener('click', () => {
  const open = el.sheet.classList.toggle('is-open');
  el.sheetHandle.setAttribute('aria-expanded', String(open));
});

// --- 凡例（モバイルでは既定で畳まれ、トグルで開く） ---
// 開閉は is-expanded で表す。デスクトップでは CSS 側で常に開いた見た目になる。
el.legendToggle.addEventListener('click', () => {
  const expanded = el.legend.classList.toggle('is-expanded');
  el.legendToggle.setAttribute('aria-expanded', String(expanded));
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
 * 下地の地名ラベルを日本語にし、かつ「脇役」に落とす。
 *
 * このサイトの主役は歴史上の政体名であって現代の地名ではない。
 * 下地のラベルを黒・通常サイズのまま残すと、政体名と同じ重さで competing してしまう。
 * そこで日本語化と同時に、小さく・薄い灰色・細い縁取りにして後ろへ下げる。
 * さらに都市名は世界表示では邪魔なだけなので、ズーム4以上でしか出さない。
 *
 * @returns {{localised: number, demoted: number, cityLayers: number}}
 */
function localiseBasemapLabels() {
  let localised = 0;
  let demoted = 0;
  let cityLayers = 0;

  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'symbol') continue;
    if (!layer.layout || layer.layout['text-field'] === undefined) continue;

    map.setLayoutProperty(layer.id, 'text-field', [
      'coalesce',
      ['get', 'name:ja'],
      ['get', 'name:latin'],
      ['get', 'name'],
    ]);
    localised += 1;

    // 国名は少し大きめ、それ以外は小さく
    const isCountry = /country/.test(layer.id);
    map.setLayoutProperty(layer.id, 'text-size', isCountry ? 11 : 9.5);
    map.setPaintProperty(layer.id, 'text-color', '#8a8a8a');
    map.setPaintProperty(layer.id, 'text-halo-color', 'rgba(255,255,255,0.7)');
    map.setPaintProperty(layer.id, 'text-halo-width', 0.8);
    demoted += 1;

    // 都市・町・村・水域名・道路名は世界表示では出さない
    if (/city|town|village|water_name|waterway|highway|poi|label_other/.test(layer.id)) {
      const minzoom = Math.max(BASEMAP_DETAIL_MIN_ZOOM, layer.minzoom ?? 0);
      map.setLayerZoomRange(layer.id, minzoom, layer.maxzoom ?? 24);
      cityLayers += 1;
    }
  }
  return { localised, demoted, cityLayers };
}

/** 下地の最初の symbol(ラベル)レイヤー ID。版図の塗りをこの下に入れる。 */
function firstSymbolLayerId() {
  const found = map.getStyle().layers.find((l) => l.type === 'symbol');
  return found?.id;
}

map.on('load', async () => {
  basemapLabelStats = localiseBasemapLabels();

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

  const [namesJa, modern, rule, events, topics, overviews, info, eras] = await Promise.all([
    loadJson('data/names.ja.json', {}),
    loadJson('data/modern.json', {}),
    loadJson('data/nonstate.json', { patterns: [], exceptions: [], explicit: [] }),
    loadJson('data/events.json', []),
    loadJson('data/topics.json', {}),
    loadJson('data/overviews.json', {}),
    loadJson('data/polity-info.json', {}),
    loadJson('data/name-eras.json', {}),
  ]);
  allOverviews = overviews;
  polityInfo = info;
  nameEras = eras;
  dicts.namesJa = namesJa;
  dicts.modern = modern;
  nonStateRule = rule;
  allEvents = events;
  allTopics = topics;

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
  focusPolity,
  showTopics,
  get topics() { return allTopics; },
  get shownIndex() { return shownIndex; },
  get selectedId() { return selectedId; },
  get localisedLayers() { return basemapLabelStats.localised; },
  get basemapLabelStats() { return basemapLabelStats; },
};
