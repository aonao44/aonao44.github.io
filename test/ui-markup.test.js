import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

test('async year, loading, and error messages are announced to assistive technology', () => {
  assert.match(html, /id="year-input"[^>]+aria-invalid="false"/);
  assert.match(html, /id="year-hint"[^>]+aria-live="polite"/);
  assert.match(html, /id="loading"[^>]+aria-live="polite"/);
  assert.match(html, /id="toast"[^>]+role="alert"[^>]+aria-live="assertive"/);
});

test('the mobile sheet has a separate inertable content region', () => {
  assert.match(html, /aria-controls="sheet-content"/);
  assert.match(html, /<div id="sheet-content">/);
});

test('CSS disables sheet animation when reduced motion is requested', () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]+?#panel \{ transition: none; \}/);
});

// --- 共有カード ---
// これが欠けると SNS でもチャットでもただの青いリンクになる。地図サイトで
// 絵が出ないのは致命的なうえ、壊れても画面上は何も変わらないので気付けない。

test('the page carries the tags a shared link needs', () => {
  for (const tag of [
    /<meta name="description" content="[^"]{40,}">/,
    /<meta property="og:type" content="website">/,
    /<meta property="og:url" content="https:\/\/aonao44\.github\.io\/">/,
    /<meta property="og:title" content="[^"]+">/,
    /<meta property="og:description" content="[^"]{40,}">/,
    /<meta property="og:image" content="https:\/\/aonao44\.github\.io\/assets\/ogp\.png">/,
    /<meta property="og:image:alt" content="[^"]{20,}">/,
    /<meta name="twitter:card" content="summary_large_image">/,
    /<link rel="canonical" href="https:\/\/aonao44\.github\.io\/">/,
    /<link rel="icon" href="\.\/favicon\.svg"/,
  ]) {
    assert.match(html, tag, `共有用のタグが足りない: ${tag}`);
  }
});

test('every file the head points at is actually shipped', () => {
  const referenced = [...html.matchAll(/(?:href|content)="(?:https:\/\/aonao44\.github\.io\/)?(\.\/)?((?:assets|vendor)\/[^"]+|favicon\.svg)"/g)]
    .map((m) => m[2]);
  assert.ok(referenced.length >= 3, `head から参照されるファイルが少なすぎる: ${referenced}`);
  for (const rel of new Set(referenced)) {
    assert.ok(existsSync(join(root, rel)), `head が指すファイルが無い: ${rel}`);
  }
});

test('the declared og:image size matches the file on disk', () => {
  const png = readFileSync(join(root, 'assets/ogp.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG', 'og:image が PNG ではない');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.match(html, new RegExp(`<meta property="og:image:width" content="${width}">`), `実寸は ${width}px`);
  assert.match(html, new RegExp(`<meta property="og:image:height" content="${height}">`), `実寸は ${height}px`);
  // 大きすぎるカード画像は配信側で落とされることがある
  assert.ok(png.length < 5_000_000, `og:image が大きすぎる: ${png.length} bytes`);
});

test('the year notice and the format help never share the same band', () => {
  // どちらも入力欄の真上に absolute で出る。長い注記を出すようにしたとき、
  // 両方同時に見えて文字が重なった。注記が出ている間は案内を引っ込める。
  assert.match(
    html,
    /#bar:has\(#year-hint:not\(:empty\)\)\s*#year-format-hint\s*\{[^}]*opacity:\s*0/,
    '注記が出ている間に案内文を隠す規則が無い',
  );
});
