#!/usr/bin/env node
// Playwright で 3 断面のスクリーンショットを撮り、最低限の描画アサートを行う。
//   node scripts/screenshot.mjs [baseUrl]
// 前提: 静的サーバが起動していること (python3 -m http.server 8765)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'output');
mkdirSync(outDir, { recursive: true });

const base = process.argv[2] ?? 'http://localhost:8765';
const ERAS = ['bc3000', '100', '2010'];

const results = [];
let failed = 0;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// 下地の OSM タイルは実際に取りに行く（「現代地図に重ねる」がこのサイトの主眼なので、
// スクリーンショットにタイルが写っていないと目視確認の意味が薄れる）。

for (const era of ERAS) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const url = `${base}/index.html?era=${era}`;
  await page.goto(url, { waitUntil: 'load' });

  // 版図ソースにデータが入り、地図が描き終わるまで待つ
  await page.waitForFunction(() => {
    const m = window.imperia?.map;
    if (!m || !m.isStyleLoaded?.()) return false;
    return window.imperia.shownIndex >= 0;
  }, null, { timeout: 30000 });
  await page.waitForFunction(() => window.imperia.map.areTilesLoaded?.() !== false, null, { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1200);

  // --- アサート1: ポリゴンが 1 つ以上描画されている ---
  const rendered = await page.evaluate(() => {
    const m = window.imperia.map;
    return m.queryRenderedFeatures({ layers: ['era-fill'] }).length;
  });

  // --- アサート2: ポリゴンをクリックするとパネルに NAME が出る ---
  // 名前つきポリゴンの画面座標を求めてクリックする
  const target = await page.evaluate(() => {
    const m = window.imperia.map;
    const translated = window.imperia.dicts.namesJa ?? {};
    const canvas = m.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const named = [];
    for (let gy = 1; gy < 20; gy += 1) {
      for (let gx = 1; gx < 32; gx += 1) {
        const pt = { x: (w * gx) / 32, y: (h * gy) / 20 };
        const hit = m.queryRenderedFeatures([pt.x, pt.y], { layers: ['era-fill'] })
          .find((f) => f.properties?.NAME);
        if (hit) named.push({ x: pt.x, y: pt.y, name: hit.properties.NAME });
      }
    }
    if (!named.length) return null;
    // 対訳のある主要政体を優先して選ぶ（パネルの日本語表示を実際に確認するため）
    return named.find((p) => p.name in translated) ?? named[0];
  });

  let panelName = null;
  if (target) {
    const box = await page.locator('#map').boundingBox();
    await page.mouse.click(box.x + target.x, box.y + target.y);
    await page.waitForSelector('[data-testid="panel-name"]', { timeout: 5000 }).catch(() => {});
    panelName = await page.locator('[data-testid="panel-name"]').textContent().catch(() => null);
  }

  const shot = join(outDir, `imperia-${era}.png`);
  await page.screenshot({ path: shot });

  const yearLabel = await page.locator('#year-label').textContent();

  const ok = rendered >= 1 && Boolean(panelName);
  if (!ok) failed += 1;
  results.push({ era, rendered, clicked: target?.name ?? null, panelName, yearLabel, shot, errors, ok });

  await page.close();
}

await browser.close();

console.log('\n=== screenshot assertions ===');
for (const r of results) {
  console.log(
    `${r.ok ? 'PASS' : 'FAIL'}  era=${r.era}  label=${r.yearLabel}  polygons=${r.rendered}  `
    + `clicked=${JSON.stringify(r.clicked)}  panel=${JSON.stringify(r.panelName)}`,
  );
  console.log(`      ${r.shot}`);
  if (r.errors.length) console.log(`      console errors: ${JSON.stringify(r.errors.slice(0, 3))}`);
}
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
