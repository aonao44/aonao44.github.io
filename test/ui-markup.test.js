import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
