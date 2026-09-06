/**
 * 起動が下地の到着に巻き込まれないことを、実ブラウザで確かめる。
 *
 * npm test は node だけで走るので app.js を一度も実行しない。そのため
 * 「OpenFreeMap のタイルが返ってこないと、エラーもトーストも出ないまま
 * 画面が真っ白のまま固まる」欠陥が本番まで出てしまった。原因は起動処理を
 * まるごと map.on('load') にぶら下げていたこと。'load' は下地のタイルが
 * 一枚描けるまで発火しない。
 *
 * 使い方:
 *   python3 -m http.server 8765 &
 *   node scripts/startup-check.mjs
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ORIGIN = process.env.IMPERIA_ORIGIN ?? 'http://127.0.0.1:8765';

/** 起動後の、判定に使う状態だけを抜き出す。 */
async function startupState(page, waitMs) {
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(waitMs);
  return page.evaluate(() => {
    const map = window.imperia?.map;
    return {
      shownIndex: window.imperia?.shownIndex,
      eraLayer: !!map?.getLayer('era-fill'),
      eraFeatures: map ? map.querySourceFeatures('era').length : 0,
      panelChars: document.getElementById('panel-body')?.textContent.trim().length ?? 0,
      toastShown: getComputedStyle(document.getElementById('toast')).display !== 'none',
      toastMsg: document.getElementById('toast-msg')?.textContent ?? '',
    };
  });
}

async function scenario(browser, { label, block, waitMs = 14000, check }) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 750 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (block) await page.route(block, () => { /* 応答を返さない */ });

  const state = await startupState(page, waitMs);
  console.log(`${label.padEnd(26)} ${JSON.stringify(state)}`);
  check(state);
  assert.deepEqual(errors, [], `${label}: JS エラーが出た`);
  await context.close();
}

const browser = await chromium.launch();
try {
  await scenario(browser, {
    label: '通常',
    check: (s) => {
      assert.equal(s.shownIndex, 0, '初期断面が出ていない');
      assert.ok(s.eraFeatures > 100, `版図が描かれていない: ${s.eraFeatures}`);
      assert.ok(s.panelChars > 100, 'パネルが空');
      assert.equal(s.toastShown, false, '正常時にトーストが出ている');
    },
  });

  // 下地のベクタタイルだけが来ない。下地は白いままでも、版図と解説は読めること。
  await scenario(browser, {
    label: '下地タイルが来ない',
    block: '**/*.pbf',
    check: (s) => {
      assert.equal(s.shownIndex, 0, '下地のタイト待ちで起動が止まっている');
      assert.ok(s.eraFeatures > 100, `版図が描かれていない: ${s.eraFeatures}`);
      assert.ok(s.panelChars > 100, 'パネルが空');
      assert.equal(s.toastShown, false, 'タイルが遅いだけでエラー扱いにしない');
    },
  });

  // スタイルごと来ない。何も描けないが、白い画面で放置せず再読み込みを促すこと。
  await scenario(browser, {
    label: 'スタイルも来ない',
    block: /tiles\.openfreemap\.org/,
    waitMs: 24000,
    check: (s) => {
      assert.equal(s.toastShown, true, '白い画面のまま何も知らせていない');
      assert.match(s.toastMsg, /読み込めません/, `想定外の文言: ${s.toastMsg}`);
    },
  });

  console.log('startup-check: OK');
} finally {
  await browser.close();
}
