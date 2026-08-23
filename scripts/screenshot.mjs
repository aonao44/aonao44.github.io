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
const ERAS = ['bc3000', '100', '1492', '2010'];

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
    return {
      localisedLayers: window.imperia.localisedLayers,
      symbolLayers: symbolIds.length,
      renderedSymbols: feats.length,
      withNameJa: withJa.length,
      japaneseSample: [...new Set(withJa.map((f) => f.properties['name:ja']).filter(hasCjk))].slice(0, 6),
    };
  });
  if (r.basemap.localisedLayers < 1) fail(r, 'no basemap symbol layer was localised');
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

  r.yearLabel = await page.locator('#year-label').textContent();
  r.shot = join(outDir, `imperia-${era}.png`);
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

  // シートは選択するまで閉じている
  const sheetHidden = await page.evaluate(
    () => document.getElementById('panel').getBoundingClientRect().top >= window.innerHeight - 1,
  );
  if (!sheetHidden) fail(r, 'bottom sheet should start closed on mobile');

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
    console.log(`      nonstate sample=${JSON.stringify(r.nonstateSample)}`);
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
