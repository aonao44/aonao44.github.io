#!/usr/bin/env node
// Playwright で断面のスクリーンショットを撮り、描画のアサートを行う。
//   node scripts/screenshot.mjs [baseUrl]
// 前提: 静的サーバが起動していること (python3 -m http.server 8765)

import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'output');
mkdirSync(outDir, { recursive: true });

const base = process.argv[2] ?? 'http://localhost:8765';
const ERAS = ['bc3000', 'bc1', '100', '1492', '2010'];

const results = [];
let failed = 0;
const fail = (r, msg) => { r.problems.push(msg); failed += 1; };

// 下地の OSM タイルは実際に取りに行く（「現代地図に重ねる」がこのサイトの主眼なので、
// スクリーンショットにタイルが写っていないと目視確認の意味が薄れる）。
const browser = await chromium.launch();

/** 版図と辞書がそろって描画完了するまで待つ。 */
async function waitReady(page) {
  await page.waitForFunction(() => {
    const m = window.imperia?.map;
    return Boolean(m && m.isStyleLoaded?.() && window.imperia.shownIndex >= 0);
  }, null, { timeout: 30000 });
  await page.waitForFunction(() => window.imperia.map.areTilesLoaded?.() !== false, null, { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
}

// ---------- デスクトップ: 4 断面 ----------
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

for (const era of ERAS) {
  const r = { era, problems: [], errors: [] };
  const page = await context.newPage();
  page.on('pageerror', (e) => r.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') r.errors.push(m.text()); });

  await page.goto(`${base}/index.html?era=${era}`, { waitUntil: 'load' });
  await waitReady(page);

  // --- アサート1: ポリゴンが 1 つ以上描画されている ---
  r.polygons = await page.evaluate(
    () => window.imperia.map.queryRenderedFeatures({ layers: ['era-fill'] }).length,
  );
  if (r.polygons < 1) fail(r, 'no polygons rendered');

  // --- アサート2: 非国家ルールが実際に適用されている ---
  const cls = await page.evaluate(() => {
    const isNS = (f) => f.properties?._nonstate === true || f.properties?._nonstate === 'true';
    const feats = window.imperia.map.queryRenderedFeatures({ layers: ['era-fill'] });
    const ns = feats.filter(isNS);
    const st = feats.filter((f) => f.properties?.NAME && !isNS(f));
    return {
      nonstate: ns.length,
      state: st.length,
      nonstateSample: [...new Set(ns.map((f) => f.properties.NAME))].slice(0, 3),
      ruleSize: (window.imperia.nonStateRule.patterns || []).length,
    };
  });
  Object.assign(r, cls);
  if (cls.ruleSize < 1) fail(r, 'non-state rule did not load');
  if (cls.state < 1) fail(r, 'no state polygons found');
  // bc3000 は非国家だらけ、2010 は逆にほぼゼロ。断面ごとに期待を変える
  if (era === 'bc3000' && cls.nonstate < 1) fail(r, 'bc3000 should contain non-state polygons');
  if (era === '2010' && cls.nonstate > cls.state) fail(r, '2010 should be dominated by states');

  // --- アサート3: 下地の地名が日本語になっている ---
  r.basemap = await page.evaluate(() => {
    const m = window.imperia.map;
    const symbolIds = m.getStyle().layers.filter((l) => l.type === 'symbol').map((l) => l.id);
    const feats = m.queryRenderedFeatures({ layers: symbolIds });
    const withJa = feats.filter((f) => f.properties && f.properties['name:ja']);
    const hasCjk = (t) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(t);
    // 下地ラベルが「脇役」に落ちているか: 灰色・小さい・都市名はズーム下限あり
    const someLabel = symbolIds.find((id) => id !== 'era-label');
    const colour = someLabel ? m.getPaintProperty(someLabel, 'text-color') : null;
    const size = someLabel ? m.getLayoutProperty(someLabel, 'text-size') : null;
    const cityLayer = symbolIds.find((id) => /city|town|village/.test(id));
    const cityMinZoom = cityLayer ? (m.getLayer(cityLayer).minzoom ?? 0) : null;
    // 政体ラベルの最小サイズ(interpolate の最初の出力)
    const polityStops = m.getLayoutProperty('era-label', 'text-size');
    const polityMinSize = Array.isArray(polityStops) ? polityStops[4] : polityStops;
    return {
      localisedLayers: window.imperia.localisedLayers,
      demoted: window.imperia.basemapLabelStats.demoted,
      cityLayers: window.imperia.basemapLabelStats.cityLayers,
      symbolLayers: symbolIds.length,
      renderedSymbols: feats.length,
      withNameJa: withJa.length,
      japaneseSample: [...new Set(withJa.map((f) => f.properties['name:ja']).filter(hasCjk))].slice(0, 6),
      sampleColour: colour,
      sampleSize: size,
      greyed: typeof colour === 'string' && /^#(8|9|a)/i.test(colour),
      cityMinZoom,
      polityMinSize,
      polityFont: m.getLayoutProperty('era-label', 'text-font'),
      smallerThanPolity: typeof size === 'number' && size < polityMinSize,
    };
  });
  if (r.basemap.localisedLayers < 1) fail(r, 'no basemap symbol layer was localised');
  if (r.basemap.demoted < r.basemap.localisedLayers) fail(r, 'some basemap labels were not demoted');
  if (r.basemap.cityLayers < 1) fail(r, 'no basemap detail layer got a zoom floor');
  if (!r.basemap.greyed) fail(r, `basemap label colour is ${r.basemap.sampleColour}, expected grey`);
  if (!r.basemap.smallerThanPolity) {
    fail(r, `basemap text ${r.basemap.sampleSize}px is not smaller than polity text ${r.basemap.polityMinSize}px`);
  }
  if (r.basemap.withNameJa < 1) fail(r, 'no rendered basemap feature carries name:ja');
  if (r.basemap.japaneseSample.length < 1) fail(r, 'no Japanese basemap label rendered');

  // --- アサート4: 政体名が日本語で地図上に出ており、重複していない ---
  r.eraLabels = await page.evaluate(() => {
    const feats = window.imperia.map.queryRenderedFeatures({ layers: ['era-label'] });
    const texts = feats.map((f) => f.properties._label);
    const counts = {};
    for (const t of texts) counts[t] = (counts[t] || 0) + 1;
    const hasCjk = (t) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(t);
    return {
      count: feats.length,
      duplicated: Object.entries(counts).filter(([, v]) => v > 1).map(([k, v]) => `${k}x${v}`),
      japanese: texts.filter(hasCjk).length,
      sample: [...new Set(texts)].slice(0, 6),
    };
  });
  if (r.eraLabels.count < 1) fail(r, 'no polity label rendered on the map');
  if (r.eraLabels.duplicated.length) {
    fail(r, `polity labels duplicated: ${r.eraLabels.duplicated.slice(0, 3).join(', ')}`);
  }
  if (r.eraLabels.japanese < 1) fail(r, 'no polity label rendered in Japanese');
  if (!String(r.basemap.polityFont).includes('Bold')) {
    fail(r, `polity labels should be bold, got ${JSON.stringify(r.basemap.polityFont)}`);
  }
  if (r.basemap.cityMinZoom !== null && r.basemap.cityMinZoom < 4) {
    fail(r, `basemap city labels show from zoom ${r.basemap.cityMinZoom}, expected >= 4`);
  }

  // --- 凡例と年入力ヒント ---
  r.legend = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById('legend')).display !== 'none',
    items: document.querySelectorAll('#legend-body li').length,
    hint: (document.getElementById('year-format-hint')?.textContent ?? '').trim(),
  }));
  if (!r.legend.visible) fail(r, 'the legend is not visible');
  if (r.legend.items < 4) fail(r, `legend has ${r.legend.items} entries, expected 4`);
  if (!r.legend.hint.includes('紀元前0年')) fail(r, 'the year-format hint is missing');

  // --- トピック一覧（何も選んでいない既定表示） ---
  r.topics = await page.evaluate(() => ({
    header: document.querySelector('[data-testid="topics-era"]')?.textContent ?? '',
    heading: document.querySelector('.topics-title')?.textContent ?? '',
    count: document.querySelectorAll('[data-testid="topics-list"] .topic').length,
    linked: document.querySelectorAll('.topic-btn[data-polity]').length,
    first: document.querySelector('.topic-title')?.textContent ?? '',
  }));
  if (r.topics.count < 4) fail(r, `only ${r.topics.count} topics shown for this era`);

  // --- この時代の世界（概説）---
  r.overview = await page.evaluate(() => {
    const node = document.querySelector('[data-testid="era-overview"]');
    if (!node) return { present: false };
    const body = node.querySelector('.overview-body')?.textContent ?? '';
    return {
      present: true,
      chars: Array.from(body).length,
      aboveTopics: (() => {
        const list = document.querySelector('[data-testid="topics-list"]');
        return list ? Boolean(node.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
      })(),
      head: body.slice(0, 28),
    };
  });
  if (!r.overview.present) fail(r, 'no era overview shown');
  else {
    if (r.overview.chars < 150 || r.overview.chars > 350) {
      fail(r, `overview is ${r.overview.chars} characters`);
    }
    if (!r.overview.aboveTopics) fail(r, 'the overview is not above the topic list');
  }
  // 見出しは「年」のカマシ + 「この時代のトピック」の小見出しに分かれている
  if (!r.topics.header.includes('年')) fail(r, `era kicker missing: ${r.topics.header}`);
  if (!r.topics.heading.includes('トピック')) fail(r, `topics heading missing: ${r.topics.heading}`);

  // --- アサート5: 出来事が描画されている ---
  r.events = await page.evaluate(() => ({
    rendered: window.imperia.map.queryRenderedFeatures({ layers: ['events-point'] }).length,
    selected: window.imperia.eventsForEra(
      Number(document.getElementById('era-slider').value),
      window.imperia.events,
    ).length,
    total: window.imperia.events.length,
  }));
  if (r.events.total < 100) fail(r, `events.json only has ${r.events.total} events`);
  if (r.events.selected > 0 && r.events.rendered < 1) {
    fail(r, 'events selected for this era but none rendered');
  }

  // --- アサート6: ポリゴンをクリックするとパネルに NAME が出る ---
  const target = await page.evaluate(() => {
    const m = window.imperia.map;
    const translated = window.imperia.dicts.namesJa ?? {};
    const c = m.getCanvas();
    const named = [];
    for (let gy = 1; gy < 20; gy += 1) {
      for (let gx = 1; gx < 32; gx += 1) {
        const pt = { x: (c.clientWidth * gx) / 32, y: (c.clientHeight * gy) / 20 };
        const hit = m.queryRenderedFeatures([pt.x, pt.y], { layers: ['era-fill'] })
          .find((f) => f.properties?.NAME);
        if (hit) named.push({ x: pt.x, y: pt.y, name: hit.properties.NAME });
      }
    }
    if (!named.length) return null;
    // 対訳のある主要政体を優先（パネルの日本語表示を実際に確認するため）
    return named.find((p) => p.name in translated) ?? named[0];
  });

  if (!target) {
    fail(r, 'found no named polygon to click');
  } else {
    const box = await page.locator('#map').boundingBox();
    await page.mouse.click(box.x + target.x, box.y + target.y);
    await page.waitForSelector('[data-testid="panel-name"]', { timeout: 5000 }).catch(() => {});
    r.clicked = target.name;
    r.panelName = await page.locator('[data-testid="panel-name"]').textContent().catch(() => null);
    r.panelModern = await page.locator('[data-testid="panel-modern"]').textContent().catch(() => null);
    if (!r.panelName) fail(r, 'clicking a polygon did not show a NAME in the panel');

    // --- アサート7: クリックしたポリゴンが強調される ---
    r.selectedId = await page.evaluate(() => window.imperia.selectedId);
    if (r.selectedId === null || r.selectedId === undefined) {
      fail(r, 'clicked polygon was not highlighted (no feature-state set)');
    }
  }

  // --- 政体の来歴と登場断面ジャンプ（100年で確認）---
  if (era === '100') {
    await page.evaluate(() => window.imperia.focusPolity('Roman Empire'));
    await page.waitForTimeout(1800);
    r.polity = await page.evaluate(() => ({
      name: document.querySelector('[data-testid="panel-name"]')?.textContent ?? null,
      period: document.querySelector('[data-testid="polity-period"]')?.textContent ?? null,
      summary: (document.querySelector('[data-testid="polity-summary"]')?.textContent ?? ''),
      jump: document.querySelector('[data-testid="era-jump-label"]')?.textContent ?? null,
      buttons: [...document.querySelectorAll('.era-jump-btn')]
        .map((b) => ({ action: b.dataset.eraJump, target: b.dataset.eraTarget, disabled: b.disabled })),
    }));
    if (r.polity.name !== 'ローマ帝国') fail(r, `expected ローマ帝国, got ${r.polity.name}`);
    if (!r.polity.period) fail(r, 'no period shown for the polity');
    if (Array.from(r.polity.summary).length < 40) fail(r, 'polity summary missing or too short');
    if (!r.polity.jump || !/断面）/.test(r.polity.jump)) fail(r, `era-jump label missing: ${r.polity.jump}`);
    if (r.polity.buttons.length !== 4) fail(r, `expected 4 era-jump buttons, got ${r.polity.buttons.length}`);

    // ▶ 最後 を押すと断面が移り、政体は選択されたまま
    const before = await page.evaluate(() => window.imperia.shownIndex);
    await page.locator('.era-jump-btn[data-era-jump="last"]').click();
    await page.waitForTimeout(2200);
    r.jumped = await page.evaluate(() => ({
      index: window.imperia.shownIndex,
      label: document.getElementById('year-label').textContent,
      name: document.querySelector('[data-testid="panel-name"]')?.textContent ?? null,
      selected: window.imperia.selectedId,
    }));
    if (r.jumped.index === before) fail(r, 'the era-jump button did not change the era');
    if (r.jumped.name !== 'ローマ帝国') fail(r, 'the polity was not kept selected across the jump');
    if (r.jumped.selected === null || r.jumped.selected === undefined) {
      fail(r, 'the polity was not highlighted after the jump');
    }

    // 元の断面に戻してスクリーンショットを撮る
    await page.evaluate(() => {
      window.imperia.map.jumpTo({ center: [20, 25], zoom: 1.6 });
      window.imperia.goTo(12);
    });
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.imperia.focusPolity('Roman Empire'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.imperia.map.jumpTo({ center: [20, 25], zoom: 1.6 }));
    await page.waitForTimeout(1200);
  }

  // --- トピックから政体へ、そして戻れること（bc1 で確認）---
  if (era === 'bc1') {
    await page.evaluate(() => window.imperia.showTopics());
    await page.waitForTimeout(300);
    const btn = page.locator('.topic-btn[data-polity]').first();
    r.topicClicked = (await btn.textContent()).trim();
    await btn.click();
    await page.waitForTimeout(1800);
    r.topicPanelName = await page.locator('[data-testid="panel-name"]').textContent().catch(() => null);
    r.topicSelectedId = await page.evaluate(() => window.imperia.selectedId);
    if (!r.topicPanelName) fail(r, 'clicking a topic did not open the polity detail');
    if (r.topicSelectedId === null || r.topicSelectedId === undefined) {
      fail(r, 'clicking a topic did not highlight the polity on the map');
    }
    const backs = await page.locator('[data-testid="panel-back"]').count();
    if (backs !== 1) fail(r, 'no back link on the polity detail');
    await page.locator('[data-testid="panel-back"]').click();
    await page.waitForTimeout(400);
    const backCount = await page.locator('[data-testid="topics-list"] .topic').count();
    if (backCount < 4) fail(r, 'the back link did not restore the topics list');
    // スクリーンショットはトピック一覧・世界表示の状態で撮る。
    // 直前のトピッククリックで地図が寄っているので、視点を初期位置に戻す。
    await page.evaluate(() => {
      window.imperia.map.jumpTo({ center: [20, 25], zoom: 1.6 });
      window.imperia.showTopics();
    });
    await page.waitForTimeout(1800);
  }

  r.yearLabel = await page.locator('#year-label').textContent();
  r.shot = join(outDir, `imperia-${era}.png`);
  await page.screenshot({ path: r.shot });
  if (r.errors.length) fail(r, `console errors: ${r.errors.slice(0, 2).join(' | ')}`);

  results.push(r);
  await page.close();
}

// ---------- 無名の政体にも来歴が出るか ----------
// 有名どころだけ書いて終わっていないことの確認。断面をまたいで3つ抜き取る。
{
  const r = { era: 'minor-polities', problems: [], errors: [] };
  const page = await context.newPage();
  page.on('pageerror', (e) => r.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') r.errors.push(m.text()); });

  await page.goto(`${base}/index.html?era=bc500`, { waitUntil: 'load' });
  await waitReady(page);

  r.checked = [];
  for (const eraId of ['bc500', '800', '1600']) {
    await page.evaluate((id) => {
      const i = window.imperia.eraIndexOf(id);
      return window.imperia.goTo(i);
    }, eraId);
    await page.waitForFunction((id) => window.imperia.currentEraId() === id, eraId, { timeout: 20000 });
    await page.waitForTimeout(1200);

    // その断面に居る政体のうち、有名でないものを1つ選ぶ（面積が中位のもの）
    const target = await page.evaluate(() => {
      const feats = window.imperia.map.querySourceFeatures('era')
        .filter((f) => f.properties?.NAME)
        .sort((a, b) => (b.properties._area ?? 0) - (a.properties._area ?? 0));
      const names = [...new Set(feats.map((f) => f.properties.NAME))];
      // 上位10は有名どころなので避け、中ほどから採る
      return names[Math.min(names.length - 1, Math.floor(names.length * 0.6))] ?? null;
    });
    if (!target) { fail(r, `no polity found in era ${eraId}`); continue; }

    const shown = await page.evaluate((name) => {
      window.imperia.focusPolity(name);
      return name;
    }, target);
    await page.waitForTimeout(900);

    const got = await page.evaluate(() => ({
      name: document.querySelector('[data-testid="panel-name"]')?.textContent ?? null,
      summary: document.querySelector('[data-testid="polity-summary"]')?.textContent ?? null,
      jump: document.querySelector('[data-testid="era-jump-label"]')?.textContent ?? null,
    }));
    r.checked.push({ eraId, name: shown, ja: got.name, chars: got.summary ? Array.from(got.summary).length : 0 });

    if (!got.name) fail(r, `${eraId}/${shown}: no name in the panel`);
    if (!got.summary) fail(r, `${eraId}/${shown}: minor polity has no history shown`);
    else if (Array.from(got.summary).length < 25) {
      fail(r, `${eraId}/${shown}: history is only ${Array.from(got.summary).length} characters`);
    }
    if (!got.jump) fail(r, `${eraId}/${shown}: no era-jump control`);
  }

  r.shot = join(outDir, 'imperia-minor-polity.png');
  await page.screenshot({ path: r.shot });
  if (r.errors.length) fail(r, `console errors: ${r.errors.slice(0, 2).join(' | ')}`);
  results.push(r);
  await page.close();
}

// ---------- 年を打ち込んで飛ぶ ----------
{
  const r = { era: 'year-input', problems: [], errors: [] };
  const page = await context.newPage();
  page.on('pageerror', (e) => r.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') r.errors.push(m.text()); });

  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await waitReady(page);

  // 自動再生ボタンは撤去済み
  if (await page.locator('#play').count() > 0) fail(r, 'the autoplay button is still present');

  const jump = async (text) => {
    await page.fill('#year-input', '');
    await page.fill('#year-input', text);
    await page.press('#year-input', 'Enter');
    await page.waitForTimeout(1200);
    return {
      label: await page.textContent('#year-label'),
      hint: (await page.textContent('#year-hint')).trim(),
      shown: await page.evaluate(() => window.imperia.shownIndex),
      slider: await page.evaluate(() => Number(document.getElementById('era-slider').value)),
      invalid: await page.evaluate(() => document.getElementById('year-input').classList.contains('is-invalid')),
    };
  };

  // 117 -> 100年の断面へ寄る
  const snapped = await jump('117');
  r.snapped = snapped;
  if (snapped.label !== '100年') fail(r, `117 should show 100年, got ${snapped.label}`);
  if (snapped.shown !== snapped.slider) fail(r, 'slider and map disagree after a year jump');
  if (!snapped.hint) fail(r, 'no hint shown when the year was snapped');

  // 紀元前500 -> ちょうど断面があるのでヒントは出ない
  const exact = await jump('紀元前500');
  r.exact = exact;
  if (exact.label !== '紀元前500年') fail(r, `紀元前500 should show 紀元前500年, got ${exact.label}`);
  if (exact.hint) fail(r, `hint should be empty on an exact hit, got ${exact.hint}`);

  // BC500 / 500BC / 前500 も同じ断面
  for (const form of ['BC500', '500BC', '前500', '-500']) {
    const got = await jump(form);
    if (got.shown !== exact.shown) fail(r, `${form} landed on era ${got.shown}, expected ${exact.shown}`);
  }

  // 読めない入力は動かさずに知らせる
  const before = exact.shown;
  const bad = await jump('ローマ');
  r.bad = bad;
  if (!bad.invalid) fail(r, 'unreadable input was not flagged');
  if (bad.shown !== before) fail(r, 'unreadable input moved the map');

  r.shot = join(outDir, 'imperia-year-input.png');
  await page.fill('#year-input', '117');
  await page.press('#year-input', 'Enter');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: r.shot });
  if (r.errors.length) fail(r, `console errors: ${r.errors.slice(0, 2).join(' | ')}`);
  results.push(r);
  await page.close();
}

await context.close();

// ---------- モバイル: ボトムシート + タッチでのスライダー操作 ----------
const mobile = await browser.newContext({ ...devices['iPhone 13'] });
{
  const r = { era: 'mobile(100)', problems: [], errors: [] };
  const page = await mobile.newPage();
  page.on('pageerror', (e) => r.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') r.errors.push(m.text()); });

  await page.goto(`${base}/index.html?era=100`, { waitUntil: 'load' });
  await waitReady(page);
  r.viewport = page.viewportSize();

  // シートは畳まれていて、「この時代のトピック」ハンドルだけが見えている
  r.sheet = await page.evaluate(() => {
    const panel = document.getElementById('panel');
    const handle = document.getElementById('sheet-handle');
    const hb = handle.getBoundingClientRect();
    return {
      open: panel.classList.contains('is-open'),
      handleVisible: getComputedStyle(handle).display !== 'none'
        && hb.top < window.innerHeight && hb.bottom > 0,
      handleText: handle.textContent.trim(),
      bodyMostlyHidden: panel.getBoundingClientRect().top > window.innerHeight * 0.7,
    };
  });
  if (r.sheet.open) fail(r, 'bottom sheet should start collapsed on mobile');
  if (!r.sheet.handleVisible) fail(r, 'the topics handle is not visible on mobile');
  if (!r.sheet.handleText.includes('トピック')) fail(r, `handle reads "${r.sheet.handleText}"`);
  if (!r.sheet.bodyMostlyHidden) fail(r, 'collapsed sheet is taking up the screen');

  // ハンドルをタップすると開いてトピックが読める
  await page.locator('#sheet-handle').tap();
  await page.waitForTimeout(500);
  r.sheetOpened = await page.evaluate(() => ({
    open: document.getElementById('panel').classList.contains('is-open'),
    topics: document.querySelectorAll('[data-testid="topics-list"] .topic').length,
  }));
  if (!r.sheetOpened.open) fail(r, 'tapping the handle did not open the sheet');
  if (r.sheetOpened.topics < 4) fail(r, `sheet opened with ${r.sheetOpened.topics} topics`);

  // 凡例のチェックは、報告された既定状態＝シートが畳まれている状態で行う。
  // シートを開けば下半分は覆われるが、それはボトムシートとして当然の挙動。
  await page.locator('#sheet-close').tap();
  await page.waitForTimeout(400);

  // 凡例はモバイルでは既定で畳まれ、開いてもシートのハンドルに被らない
  const legendState = () => page.evaluate(() => {
    const legend = document.getElementById('legend');
    const toggle = document.getElementById('legend-toggle');
    const handle = document.getElementById('sheet-handle');
    const lb = legend.getBoundingClientRect();
    const hb = handle.getBoundingClientRect();
    // 矩形が重なっているか
    const intersects = lb.left < hb.right && lb.right > hb.left
      && lb.top < hb.bottom && lb.bottom > hb.top;
    return {
      toggleVisible: getComputedStyle(toggle).display !== 'none',
      bodyVisible: getComputedStyle(document.getElementById('legend-body')).display !== 'none',
      expanded: legend.classList.contains('is-expanded'),
      intersects,
      onScreen: lb.top >= 0 && lb.bottom <= window.innerHeight,
      legendBottom: Math.round(lb.bottom),
      handleTop: Math.round(hb.top),
      gap: Math.round(hb.top - lb.bottom),
    };
  });

  r.legendCollapsed = await legendState();
  if (!r.legendCollapsed.toggleVisible) fail(r, 'the legend has no collapse control on mobile');
  if (r.legendCollapsed.bodyVisible) fail(r, 'the legend should start collapsed on mobile');
  if (r.legendCollapsed.intersects) fail(r, 'collapsed legend overlaps the sheet handle');

  // 開いた状態でもハンドルと重ならず、画面内に収まっていること
  await page.locator('#legend-toggle').tap();
  await page.waitForTimeout(350);
  r.legendExpanded = await legendState();
  if (!r.legendExpanded.bodyVisible) fail(r, 'tapping 凡例 did not expand it');
  if (r.legendExpanded.intersects) {
    fail(r, `expanded legend overlaps the sheet handle (legend bottom ${r.legendExpanded.legendBottom}, handle top ${r.legendExpanded.handleTop})`);
  }
  if (!r.legendExpanded.onScreen) {
    fail(r, `expanded legend runs off screen (bottom ${r.legendExpanded.legendBottom})`);
  }
  await page.locator('#legend-toggle').tap();
  await page.waitForTimeout(250);

  // 版図をタップするとシートが開く
  const target = await page.evaluate(() => {
    const m = window.imperia.map;
    const c = m.getCanvas();
    for (let gy = 1; gy < 16; gy += 1) {
      for (let gx = 1; gx < 12; gx += 1) {
        const pt = { x: (c.clientWidth * gx) / 12, y: (c.clientHeight * gy) / 16 };
        const hit = m.queryRenderedFeatures([pt.x, pt.y], { layers: ['era-fill'] })
          .find((f) => f.properties?.NAME);
        if (hit) return { x: pt.x, y: pt.y, name: hit.properties.NAME };
      }
    }
    return null;
  });

  if (!target) {
    fail(r, 'no named polygon to tap on mobile');
  } else {
    const box = await page.locator('#map').boundingBox();
    await page.touchscreen.tap(box.x + target.x, box.y + target.y);
    await page.waitForTimeout(600);
    r.clicked = target.name;
    r.panelName = await page.locator('[data-testid="panel-name"]').textContent().catch(() => null);
    if (!r.panelName) fail(r, 'tap did not populate the panel');
    const opened = await page.evaluate(
      () => document.getElementById('panel').classList.contains('is-open'),
    );
    if (!opened) fail(r, 'bottom sheet did not open on tap');
    const onScreen = await page.evaluate(() => {
      const p = document.getElementById('panel').getBoundingClientRect();
      return p.top < window.innerHeight - 40;
    });
    if (!onScreen) fail(r, 'bottom sheet is open but not visible on screen');
  }

  // --- タッチでスライダーを動かす ---
  const before = await page.evaluate(() => window.imperia.shownIndex);
  const sb = await page.locator('#era-slider').boundingBox();
  if (!sb) {
    fail(r, 'slider is not visible on mobile');
  } else {
    r.sliderBox = { w: Math.round(sb.width), h: Math.round(sb.height) };
    if (sb.height < 24) fail(r, `slider is only ${Math.round(sb.height)}px tall — too small for touch`);
    // つまみを掴んで右へドラッグし、離した時にロードされることを見る
    await page.touchscreen.tap(sb.x + sb.width * 0.75, sb.y + sb.height / 2);
    await page.waitForTimeout(2000);
    r.afterDrag = await page.evaluate(() => ({
      index: Number(document.getElementById('era-slider').value),
      shown: window.imperia.shownIndex,
      label: document.getElementById('year-label').textContent,
    }));
    if (r.afterDrag.index === before) fail(r, 'touch on the slider did not change the era');
    if (r.afterDrag.shown !== r.afterDrag.index) {
      fail(r, `slider moved to ${r.afterDrag.index} but map shows ${r.afterDrag.shown}`);
    }
  }

  r.shot = join(outDir, 'imperia-mobile.png');
  await page.screenshot({ path: r.shot });
  if (r.errors.length) fail(r, `console errors: ${r.errors.slice(0, 2).join(' | ')}`);
  results.push(r);
  await page.close();
}
await mobile.close();
await browser.close();

console.log('\n=== screenshot assertions ===');
for (const r of results) {
  console.log(`${r.problems.length === 0 ? 'PASS' : 'FAIL'}  ${r.era}`);
  if (r.polygons !== undefined) {
    console.log(`      label=${r.yearLabel} polygons=${r.polygons} state=${r.state} nonstate=${r.nonstate}`);
    console.log(`      events rendered=${r.events.rendered} selected=${r.events.selected} total=${r.events.total}`);
    console.log(`      basemap ja: localised=${r.basemap.localisedLayers} layers, ${r.basemap.withNameJa} features w/ name:ja, e.g. ${JSON.stringify(r.basemap.japaneseSample.slice(0, 4))}`);
    console.log(`      polity labels: ${r.eraLabels.count} rendered, ${r.eraLabels.japanese} japanese, dupes=${r.eraLabels.duplicated.length}, e.g. ${JSON.stringify(r.eraLabels.sample.slice(0, 4))}`);
    console.log(`      hierarchy: basemap ${r.basemap.sampleSize}px ${r.basemap.sampleColour} vs polity ${r.basemap.polityMinSize}px ${JSON.stringify(r.basemap.polityFont)}, city labels from zoom ${r.basemap.cityMinZoom}`);
    console.log(`      legend: ${r.legend.items} entries visible=${r.legend.visible} | topics: ${r.topics.count} (${r.topics.linked} linked) "${r.topics.first}"`);
    if (r.overview?.present) console.log(`      overview: ${r.overview.chars} chars, above topics=${r.overview.aboveTopics} — "${r.overview.head}…"`);
    if (r.polity) console.log(`      polity: ${r.polity.name} | ${r.polity.period} | ${r.polity.jump} | buttons=${r.polity.buttons.map((b) => b.action + (b.disabled ? '(off)' : '')).join(',')}`);
    if (r.jumped) console.log(`      era jump -> index ${r.jumped.index} (${r.jumped.label}), still selected: ${r.jumped.name} id=${r.jumped.selected}`);
    if (r.topicClicked) console.log(`      topic click "${r.topicClicked}" -> panel ${JSON.stringify(r.topicPanelName)}, highlighted id=${r.topicSelectedId}, back link OK`);
    console.log(`      nonstate sample=${JSON.stringify(r.nonstateSample)}`);
  }
  if (r.checked) {
    for (const c of r.checked) {
      console.log(`      ${c.eraId}: ${c.name} -> ${c.ja} (${c.chars} chars of history)`);
    }
  }
  if (r.snapped) {
    console.log(`      117 -> ${r.snapped.label} (hint: ${r.snapped.hint}) | 紀元前500 -> ${r.exact.label} (hint empty: ${!r.exact.hint}) | bad input flagged: ${r.bad.invalid}, map unmoved: ${r.bad.shown === r.exact.shown}`);
  }
  if (r.sheet) {
    console.log(`      sheet collapsed=${!r.sheet.open} handle="${r.sheet.handleText}" -> tap opens with ${r.sheetOpened.topics} topics`);
    console.log(`      legend: starts collapsed=${!r.legendCollapsed.bodyVisible}, expanded overlaps handle=${r.legendExpanded.intersects}, gap=${r.legendExpanded.gap}px, on screen=${r.legendExpanded.onScreen}`);
  }
  if (r.afterDrag) {
    console.log(`      touch slider -> index=${r.afterDrag.index} label=${r.afterDrag.label} box=${JSON.stringify(r.sliderBox)}`);
  }
  console.log(`      clicked=${JSON.stringify(r.clicked)} panel=${JSON.stringify(r.panelName)}`
    + `${r.panelModern ? ` modern=${JSON.stringify(r.panelModern)}` : ''}`);
  console.log(`      ${r.shot}`);
  for (const p of r.problems) console.log(`      PROBLEM: ${p}`);
}
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} PROBLEM(S)`);
process.exit(failed === 0 ? 0 : 1);
