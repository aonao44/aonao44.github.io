// エントリ。map 初期化と UI 結線だけを担当し、ロジックは src/ の各モジュールに置く。

// MapLibre GL JS v6 は ESM のみ配布されており、UMD グローバル (window.maplibregl) も
// default export も無い。名前付き export をここで import する。
//
// CDN ではなく vendor/ に同梱している。学校などホワイトリスト運用のネットワークで
// jsDelivr が塞がれると、この import が失敗した時点で app.js 全体が死に、画面が
// 真っ白のまま何のエラーも出せない（実測で確認）。地図タイルは外部に頼らざるを
// 得ないが、少なくとも本体は自分で配れる。
import {
  Map as MapLibreMap,
  NavigationControl,
} from './vendor/maplibre-gl/maplibre-gl.mjs';

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
import { loadJson, JSON_VALIDATORS } from './src/loadjson.js';
import {
  syncEraControls as applyEraControls,
  rollbackEraControls,
  setYearInputInvalid as applyYearInputInvalid,
  clearYearInputState,
  setSheetContentHidden,
} from './src/ui-state.js';

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
  sheetContent: document.getElementById('sheet-content'),
  sheetClose: document.getElementById('sheet-close'),
  sheetHandle: document.getElementById('sheet-handle'),
  legend: document.getElementById('legend'),
  legendToggle: document.getElementById('legend-toggle'),
};

el.slider.max = String(ERA_COUNT - 1);

const store = new EraStore({ basePath: 'data/eras' });
const dicts = { namesJa: {}, modern: {}, subjectAliases: {} };
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
/** 地図レイヤーの準備ができたか。レイヤー追加前のスライダー操作を待たせるのに使う。 */
let layersReady = false;
/** 同じ準備完了を待てる約束。'load' を二度待ちして固まるのを避けるため。 */
let markLayersReady;
const layersReadyPromise = new Promise((resolve) => { markLayersReady = resolve; });
/** feature-state で強調中のポリゴン id。 */
let selectedId = null;
/** 強調中の政体名（断面をまたいで選択を持ち越すのに使う）。 */
let selectedPolityName = null;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// 何も選んでいない間はトピック一覧を出す（起動直後は断面未確定なので空）
el.panel.innerHTML = '';

// --- 地図 ---
/** 下地スタイル。ベクタなのでラベルの言語を差し替えられる。positron = 最も淡い */
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

/** 都市名など下地の細かいラベルを出し始めるズーム。世界表示では国名だけにする。 */
const BASEMAP_DETAIL_MIN_ZOOM = 4;

// 海の色。src/layers.js の WATER_HUE_MIN–WATER_HUE_MAX に収めてあり、
// この帯の色相は政体に割り当てられない。だから青は必ず海を意味する。
const WATER_FILL_COLOR = 'hsl(205, 62%, 78%)';
const WATER_LABEL_COLOR = 'hsl(212, 68%, 32%)';

/** 下地の海洋名レイヤー。positron の water_name をこの id で描き直す。 */
const SEA_LABEL_LAYER = 'imperia-sea-labels';

/** 海洋名として世界表示から出す water_name の class。湖・池はズームしてから。 */
const OPEN_WATER_CLASSES = ['ocean', 'sea'];

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

    // レイヤー追加前に呼ばれると描き込む先がまだ無い。これはロード失敗ではないので、
    // トーストを出さずに準備できるまで待ってから描く。
    // map.once('load') を待ってはいけない。既に発火済みなら二度と解決しない。
    if (!layersReady) {
      await layersReadyPromise;
      if (seq !== requestSeq) return;
    }

    clearSelection();
    setEraData(map, geojson, nonStateRule, dicts.namesJa);
    setEventData(map, eventsForEra(index, allEvents, typedYear));
    shownIndex = index;
    // ロード成功をもってスライダーと年表示を確定する。再試行から成功した場合も揃う。
    syncEraControls(index);

    // 登場断面ジャンプの直後は、同じ政体を選び直して詳細を出したままにする
    const carry = pendingSelectName;
    pendingSelectName = null;
    if (carry && reselectPolity(carry)) {
      hideToast();
      return true;
    }

    // それ以外は既定表示のトピック一覧に戻す
    showTopics();
    hideToast();
    return true;
  } catch (err) {
    if (seq !== requestSeq) return;
    // 先に動いたスライダー/ラベルを、最後に表示できた断面へ戻す。
    rollbackEraControls(el, shownIndex, labelAt);
    showToast(`${labelAt(index)}のデータを読み込めませんでした`, () => goTo(index));
    console.error('era load failed', era.id, err);
    return false;
  } finally {
    if (seq === requestSeq) el.loading.textContent = '';
  }
}

// --- スライダー ---
function syncLabel(index) {
  el.year.textContent = labelAt(index);
}

function syncEraControls(index) {
  applyEraControls(el, index, labelAt);
}

function setYearInputInvalid(invalid) {
  applyYearInputInvalid(el.yearInput, invalid);
}

// 読者が年を打ち込んだ時だけ入る。断面は指定年以前へ寄るので、これが無いと
// 「その年にはもう起きている出来事」が一つ先の断面に隠れる（例: 紀元前220年と
// 打つと紀元前300年の地図が出るが、秦の中国統一(前221)は見えない）。
let typedYear = null;

function clearTypedYear() {
  clearYearInputState(el.yearInput, el.yearHint);
  lastAppliedYearInput = null;
  typedYear = null;
}

// ドラッグ中はラベルだけ更新（spec）
el.slider.addEventListener('input', () => {
  pendingSelectName = null;
  clearTypedYear();
  syncLabel(Number(el.slider.value));
});

// 離した時に断面をロード（spec）
el.slider.addEventListener('change', () => {
  // スライダーで動かしたら、年入力に対する「寄せました」表示は用済み
  clearTypedYear();
  showEra(Number(el.slider.value));
});

/** スライダー・ラベル・地図をまとめて指定インデックスに移す。 */
function goTo(index, options = {}) {
  if (options.clearTypedYear) clearTypedYear();
  syncEraControls(index);
  return showEra(index);
}

// --- 年を打ち込んで飛ぶ ---
/**
 * 入力された年の断面へ移動する。
 * 断面は48しかないので、打った年ちょうどの断面はまず無い。
 * その年に有効だった最後の断面へ寄せ、寄せた場合はその旨を小さく出す。
 */
let lastAppliedYearInput = null;

/**
 * 打った年そのものの地図は無い、と伝える。
 *
 * 「→ 紀元前300年の断面を表示」だけだと、どれだけ離れた年を見せられているのか
 * 読み取れない。紀元前300年と紀元前200年の間には断面が無いので、紀元前220年と
 * 打つと 80年前が出る。そこに秦帝国(前221-206)は無く、居るのは戦国七雄の秦。
 * これを黙って出すと「サイトが壊れている」に見えるので、ずれ幅を必ず添える。
 *
 * @param {{year: number, index: number, era: {year: number}}} result resolveYearInput の結果
 * @returns {string}
 */
function snapNotice(result) {
  const gap = Math.abs(result.year - result.era.year);
  const side = result.era.year < result.year ? '前' : '後';
  return `${formatYear(result.year)}の地図はありません → ${labelAt(result.index)}を表示（${gap}年${side}）`;
}

async function jumpToTypedYear() {
  pendingSelectName = null;
  const raw = el.yearInput.value;
  const result = resolveYearInput(raw);

  if (!result.ok) {
    setYearInputInvalid(result.reason === 'unparsable');
    el.yearHint.textContent = result.reason === 'unparsable'
      ? '年を読み取れません（例: 117 / 紀元前500 / BC500）'
      : '';
    return;
  }

  setYearInputInvalid(false);
  el.yearHint.textContent = '';
  lastAppliedYearInput = raw;
  typedYear = result.year;
  const loaded = await goTo(result.index);
  if (loaded) {
    el.yearHint.textContent = result.snapped ? snapNotice(result) : '';
  }
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
  syncSheetInteractivity();
}

/**
 * 指定年が断面より後のとき、その間に起きたことをまとめる。
 *
 * 地図は断面のまま止まっているので、指定年の時点で既に起きたことは地図と
 * 食い違う。紀元前220年を求めた読者に紀元前300年の分裂した中国を見せて、
 * 秦の統一に一言も触れないのは、事実として誤った印象を与える。
 *
 * @returns {{askedLabel:string, events:Array, formatYear:Function}|null}
 */
function changesSinceShownEra() {
  if (typedYear === null) return null;
  const era = eraAt(shownIndex < 0 ? Number(el.slider.value) : shownIndex);
  if (typedYear <= era.year) return null;
  const events = eventsForEra(shownIndex, allEvents, typedYear)
    .filter((e) => e.year > era.year);
  if (!events.length) return null;
  return { askedLabel: formatYear(typedYear), events, formatYear };
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
    changesSinceShownEra(),
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
  goTo(index, { clearTypedYear: true });
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
  if (bbox) map.fitBounds(bbox, {
    padding: 80,
    maxZoom: 5,
    duration: reducedMotion.matches ? 0 : 800,
  });

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
const mobileSheet = window.matchMedia('(max-width: 767px)');

function syncSheetInteractivity() {
  const closed = mobileSheet.matches && !el.sheet.classList.contains('is-open');
  setSheetContentHidden(el.sheetContent, closed);
}

function closeSheet() {
  const returnFocus = el.sheetContent.contains(document.activeElement);
  el.sheet.classList.remove('is-open');
  el.sheetHandle.setAttribute('aria-expanded', 'false');
  syncSheetInteractivity();
  if (returnFocus) el.sheetHandle.focus();
}

el.sheetClose.addEventListener('click', closeSheet);

// ハンドル（「この時代のトピック」）でシートを開閉する
el.sheetHandle.addEventListener('click', () => {
  const open = el.sheet.classList.toggle('is-open');
  el.sheetHandle.setAttribute('aria-expanded', String(open));
  syncSheetInteractivity();
});
mobileSheet.addEventListener('change', syncSheetInteractivity);
syncSheetInteractivity();

// --- 凡例 ---
// 既定は畳んだ状態。幅は問わない。左下は版図そのものを見たい場所で、
// 凡例は一度読めば用が済むので、開いたまま居座らせない。
// 畳んでも見出しの「凡例」は残るので、必要になったら開き直せる。

/** 凡例の開閉を、見た目と支援技術の両方へ反映する。 */
function setLegendExpanded(expanded) {
  el.legend.classList.toggle('is-expanded', expanded);
  el.legendToggle.setAttribute('aria-expanded', String(expanded));
}

setLegendExpanded(false);

el.legendToggle.addEventListener('click', () => {
  setLegendExpanded(!el.legend.classList.contains('is-expanded'));
});

// --- 起動 ---
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

    // 海洋名は専用レイヤー(SEA_LABEL_LAYER)で世界表示から出す。下地側の
    // water_name からは外しておかないと、ズーム4以上で二重に描かれる。
    if (layer['source-layer'] === 'water_name') {
      map.setFilter(layer.id, [
        'all',
        layer.filter ?? true,
        ['match', ['get', 'class'], OPEN_WATER_CLASSES, false, true],
      ]);
    }

    // 都市・町・村・水域名・道路名は世界表示では出さない
    if (/city|town|village|water_name|waterway|highway|poi|label_other/.test(layer.id)) {
      const minzoom = Math.max(BASEMAP_DETAIL_MIN_ZOOM, layer.minzoom ?? 0);
      map.setLayerZoomRange(layer.id, minzoom, layer.maxzoom ?? 24);
      cityLayers += 1;
    }
  }
  return { localised, demoted, cityLayers };
}

/**
 * 海・湖を、政体に絶対に使われない青へ塗り替える。
 *
 * positron の既定の水面は rgb(194,200,202) というほぼ灰色で、淡い政体の塗りと
 * 見分けがつかない。hueForName が WATER_HUE_MIN–WATER_HUE_MAX を飛ばすので、
 * この帯の青は地図上で「水」しか意味しない。
 *
 * @returns {number} 塗り替えたレイヤー数
 */
function colourWater() {
  let painted = 0;
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'fill' && layer['source-layer'] === 'water') {
      map.setPaintProperty(layer.id, 'fill-color', WATER_FILL_COLOR);
      painted += 1;
    } else if (layer.type === 'line' && layer['source-layer'] === 'waterway') {
      map.setPaintProperty(layer.id, 'line-color', WATER_FILL_COLOR);
      painted += 1;
    }
  }
  return painted;
}

/**
 * 海の名前を世界表示から出す。
 *
 * positron は water_name に海洋名を持っているが、このサイトでは都市名と一緒に
 * ズーム4以上へ落としていたため、世界表示では海が名無しの面でしかなかった。
 * 政体名(Bold)・現代地名(Regular)と書体でも区別できるよう斜体にし、
 * 政体名より後に追加して衝突時は政体名を優先させる。
 *
 * @returns {boolean} レイヤーを追加したか（下地に water_name が無ければ false）
 */
function addSeaLabels() {
  if (map.getLayer(SEA_LABEL_LAYER)) return false;

  const donor = map.getStyle().layers
    .find((l) => l.type === 'symbol' && l['source-layer'] === 'water_name');
  if (!donor) return false;

  map.addLayer({
    id: SEA_LABEL_LAYER,
    type: 'symbol',
    source: donor.source,
    'source-layer': 'water_name',
    filter: ['match', ['get', 'class'], OPEN_WATER_CLASSES, true, false],
    layout: {
      'text-field': [
        'coalesce',
        ['get', 'name:ja'],
        ['get', 'name:latin'],
        ['get', 'name'],
      ],
      'text-font': ['Noto Sans Italic'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 0, 10, 3, 13, 6, 15],
      'text-max-width': 7,
      'text-letter-spacing': 0.12,
      'text-padding': 6,
    },
    paint: {
      'text-color': WATER_LABEL_COLOR,
      'text-halo-color': 'rgba(255,255,255,0.85)',
      'text-halo-width': 1.4,
    },
  });
  return true;
}

/** 下地の最初の symbol(ラベル)レイヤー ID。版図の塗りをこの下に入れる。 */
function firstSymbolLayerId() {
  const found = map.getStyle().layers.find((l) => l.type === 'symbol');
  return found?.id;
}

/**
 * レイヤーを載せられるようになったら解決する。
 *
 * 以前は起動処理を丸ごと map.on('load') にぶら下げていた。'load' は下地の
 * タイルが最初の一枚描けるまで発火しないので、OpenFreeMap のタイルが
 * 返ってこないと、エラーもトーストも出ないまま画面が白いままになる
 * （実際に発生。version polygon もパネルも一切出ない）。
 * レイヤー追加に要るのはスタイルだけなので 'style.load' で足りる。
 * タイルが来なくても、下地が白いまま版図と政体名は読める。
 */
const styleReady = new Promise((resolve) => {
  if (map.isStyleLoaded()) resolve();
  else map.once('style.load', resolve);
});

/** スタイルすら来ない時に、白い画面のまま放置せず再読み込みを促すまでの猶予。 */
const STYLE_TIMEOUT_MS = 20000;
setTimeout(() => {
  if (layersReady) return;
  showToast('地図の下地を読み込めませんでした', () => location.reload());
}, STYLE_TIMEOUT_MS);

styleReady.then(async () => {
  basemapLabelStats = localiseBasemapLabels();
  colourWater();

  // 版図の塗りは下地のラベルより下に入れる。上に載せると
  // 不透明度 0.55 の塗りが地名を覆って読めなくなる。
  addEraLayers(map, firstSymbolLayerId());
  // 政体名と出来事は最前面（下地のラベルより上）
  addEraLabelLayer(map);
  // 海洋名は政体名の後。衝突したら政体名が残る（このサイトの主役は政体名）
  addSeaLabels();
  addEventLayer(map);
  layersReady = true;
  markLayersReady();

  // 現代国境は任意。失敗してもアプリ本体は動かす。
  loadJson('data/modern-borders.geojson', null, { validate: JSON_VALIDATORS.featureCollection }).then((geo) => {
    if (geo) addBorderLayer(map, geo, el.borders.checked);
  });

  const [namesJa, modern, subjectAliases, rule, events, topics, overviews, info, eras] = await Promise.all([
    loadJson('data/names.ja.json', {}, { validate: JSON_VALIDATORS.names }),
    loadJson('data/modern.json', {}, { validate: JSON_VALIDATORS.modern }),
    loadJson('data/subject-aliases.json', {}, { validate: JSON_VALIDATORS.subjectAliases }),
    loadJson('data/nonstate.json', { patterns: [], exceptions: [], explicit: [] }, { validate: JSON_VALIDATORS.nonStateRule }),
    loadJson('data/events.json', [], { validate: JSON_VALIDATORS.events }),
    loadJson('data/topics.json', {}, { validate: JSON_VALIDATORS.topics }),
    loadJson('data/overviews.json', {}, { validate: JSON_VALIDATORS.overviews }),
    loadJson('data/polity-info.json', {}, { validate: JSON_VALIDATORS.polityInfo }),
    loadJson('data/name-eras.json', {}, { validate: JSON_VALIDATORS.nameEras }),
  ]);
  allOverviews = overviews;
  polityInfo = info;
  nameEras = eras;
  dicts.namesJa = namesJa;
  dicts.modern = modern;
  dicts.subjectAliases = subjectAliases;
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
  eraIndexOf: indexOfEra,
  currentEraId: () => (shownIndex >= 0 ? eraAt(shownIndex).id : null),
  get topics() { return allTopics; },
  get shownIndex() { return shownIndex; },
  get selectedId() { return selectedId; },
  get localisedLayers() { return basemapLabelStats.localised; },
  get basemapLabelStats() { return basemapLabelStats; },
};
