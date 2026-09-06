import test from 'node:test';
import assert from 'node:assert/strict';

import { loadJson, JSON_VALIDATORS } from '../src/loadjson.js';

async function withoutWarnings(run) {
  const original = console.warn;
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.warn = original;
  }
}

test('loadJson returns JSON only when it passes the requested type validator', async () => {
  const value = { Rome: 'ローマ' };
  const result = await loadJson('/names.json', {}, {
    validate: JSON_VALIDATORS.names,
    fetchImpl: async () => ({ ok: true, json: async () => value }),
  });
  assert.equal(result, value);
});

test('loadJson rejects a successful response with the wrong JSON shape', async () => {
  const fallback = {};
  const result = await withoutWarnings(() => loadJson('/topics.json', fallback, {
    validate: JSON_VALIDATORS.topics,
    fetchImpl: async () => ({ ok: true, json: async () => [] }),
  }));
  assert.equal(result, fallback);
});

test('loadJson aborts a request at the timeout and returns its fallback', async () => {
  let signal;
  const fallback = [];
  const fetchImpl = (_path, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
  const result = await withoutWarnings(() => loadJson('/events.json', fallback, {
    validate: JSON_VALIDATORS.events,
    timeoutMs: 5,
    fetchImpl,
  }));
  assert.equal(result, fallback);
  assert.equal(signal.aborted, true);
});

test('loadJson validates GeoJSON as a FeatureCollection', async () => {
  const valid = { type: 'FeatureCollection', features: [] };
  const invalid = { type: 'Feature', geometry: null, properties: {} };
  assert.equal(JSON_VALIDATORS.featureCollection(valid), true);
  assert.equal(JSON_VALIDATORS.featureCollection(invalid), false);
});
