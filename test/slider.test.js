import test from 'node:test';
import assert from 'node:assert/strict';

import { Autoplay, nextIndex, AUTOPLAY_INTERVAL_MS } from '../src/slider.js';
import { ERA_COUNT } from '../src/eras.js';

/** 手動で進められる偽タイマー。 */
function fakeTimer() {
  const state = { fn: null, ms: null, cleared: 0 };
  return {
    state,
    set: (fn, ms) => { state.fn = fn; state.ms = ms; return { id: 1 }; },
    clear: () => { state.cleared += 1; state.fn = null; },
    /** 1 ステップ進める。 */
    tick(n = 1) {
      for (let i = 0; i < n; i += 1) {
        if (!state.fn) return;
        state.fn();
      }
    },
  };
}

/** インデックスを保持する簡易モデル + Autoplay を組み立てる。 */
function makeAutoplay(startIndex = 0, opts = {}) {
  const timer = fakeTimer();
  const steps = [];
  let index = startIndex;
  let ended = 0;
  const autoplay = new Autoplay({
    getIndex: () => index,
    onStep: (i) => { index = i; steps.push(i); },
    onEnd: () => { ended += 1; },
    setTimer: timer.set,
    clearTimer: timer.clear,
    ...opts,
  });
  return {
    autoplay, timer, steps,
    get index() { return index; },
    get ended() { return ended; },
  };
}

test('nextIndex advances by one and stops at the end', () => {
  assert.equal(nextIndex(0), 1);
  assert.equal(nextIndex(5), 6);
  assert.equal(nextIndex(ERA_COUNT - 2), ERA_COUNT - 1);
  assert.equal(nextIndex(ERA_COUNT - 1), null, 'last era has no next');
});

test('nextIndex clamps out-of-range input', () => {
  assert.equal(nextIndex(-3), 1);
  assert.equal(nextIndex(ERA_COUNT + 5), null);
});

test('default interval is 1.5s per era', () => {
  assert.equal(AUTOPLAY_INTERVAL_MS, 1500);
  const h = makeAutoplay(0);
  h.autoplay.start();
  assert.equal(h.timer.state.ms, 1500);
});

test('autoplay advances one era per tick', () => {
  const h = makeAutoplay(0);
  h.autoplay.start();
  assert.equal(h.autoplay.playing, true);

  h.timer.tick();
  assert.equal(h.index, 1);
  h.timer.tick();
  assert.equal(h.index, 2);
  h.timer.tick(3);
  assert.equal(h.index, 5);
  assert.deepEqual(h.steps, [1, 2, 3, 4, 5]);
});

test('autoplay stops itself at the last era and reports the end', () => {
  const h = makeAutoplay(ERA_COUNT - 3);
  h.autoplay.start();
  h.timer.tick();
  assert.equal(h.index, ERA_COUNT - 2);
  h.timer.tick();
  assert.equal(h.index, ERA_COUNT - 1);
  assert.equal(h.autoplay.playing, true, 'still playing at the last era');

  h.timer.tick(); // 末尾からさらに進もうとする
  assert.equal(h.index, ERA_COUNT - 1, 'index must not go past the end');
  assert.equal(h.autoplay.playing, false, 'autoplay stops at the end');
  assert.equal(h.ended, 1, 'onEnd fires exactly once');
  assert.equal(h.timer.state.cleared, 1);
});

test('starting from the last era rewinds to the beginning', () => {
  const h = makeAutoplay(ERA_COUNT - 1);
  h.autoplay.start();
  assert.equal(h.index, 0, 'rewound before playing');
  h.timer.tick();
  assert.equal(h.index, 1);
});

test('stop halts progression (spec: click stops playback)', () => {
  const h = makeAutoplay(0);
  h.autoplay.start();
  h.timer.tick(2);
  assert.equal(h.index, 2);

  h.autoplay.stop();
  assert.equal(h.autoplay.playing, false);
  assert.equal(h.timer.state.cleared, 1);

  h.timer.tick(5);
  assert.equal(h.index, 2, 'no further steps after stop');
  assert.deepEqual(h.steps, [1, 2]);
});

test('start is idempotent and does not create a second timer', () => {
  let timers = 0;
  const h = makeAutoplay(0, {
    setTimer: (fn) => { timers += 1; return fn; },
    clearTimer: () => {},
  });
  h.autoplay.start();
  h.autoplay.start();
  h.autoplay.start();
  assert.equal(timers, 1);
});

test('stop is safe when not playing', () => {
  const h = makeAutoplay(0);
  h.autoplay.stop();
  assert.equal(h.autoplay.playing, false);
  assert.equal(h.timer.state.cleared, 0, 'no timer to clear');
});

test('toggle flips between playing and stopped', () => {
  const h = makeAutoplay(0);
  h.autoplay.toggle();
  assert.equal(h.autoplay.playing, true);
  h.autoplay.toggle();
  assert.equal(h.autoplay.playing, false);
  h.autoplay.toggle();
  assert.equal(h.autoplay.playing, true);
});

test('a full run visits every era exactly once in order', () => {
  const h = makeAutoplay(0);
  h.autoplay.start();
  h.timer.tick(ERA_COUNT + 5); // 末尾で自動停止するので余分に叩いても安全
  assert.equal(h.index, ERA_COUNT - 1);
  assert.deepEqual(
    h.steps,
    Array.from({ length: ERA_COUNT - 1 }, (_, i) => i + 1),
  );
  assert.equal(h.ended, 1);
});

test('autoplay respects a custom interval', () => {
  const h = makeAutoplay(0, { intervalMs: 250 });
  h.autoplay.start();
  assert.equal(h.timer.state.ms, 250);
});

test('Autoplay requires getIndex and onStep', () => {
  assert.throws(() => new Autoplay({ onStep: () => {} }), TypeError);
  assert.throws(() => new Autoplay({ getIndex: () => 0 }), TypeError);
});
