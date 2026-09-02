// 47(実際は48)段階の離散スライダーと自動再生。
// 進行ロジックは DOM に依存させず、node:test から検証できるようにしてある。

import { ERA_COUNT, clampIndex } from './eras.js';

/** 自動再生の既定間隔（spec: 1断面 1.5 秒）。 */
export const AUTOPLAY_INTERVAL_MS = 1500;

/**
 * 次のインデックスを返す。末尾に達したら null（＝再生終了）。
 * @param {number} index
 * @param {number} [count]
 * @returns {number|null}
 */
export function nextIndex(index, count = ERA_COUNT) {
  const current = clampIndex(index);
  const next = current + 1;
  return next >= count ? null : next;
}

/**
 * 自動再生のタイマー制御。setInterval/clearInterval を差し替えられるので
 * テストでは偽タイマーを渡して進行を検証できる。
 */
export class Autoplay {
  /**
   * @param {{
   *   intervalMs?: number,
   *   getIndex: () => number,
   *   onStep: (index: number) => void,
   *   onEnd?: () => void,
   *   setTimer?: (fn: () => void, ms: number) => any,
   *   clearTimer?: (handle: any) => void,
   * }} options
   */
  constructor(options) {
    if (typeof options.getIndex !== 'function') throw new TypeError('getIndex is required');
    if (typeof options.onStep !== 'function') throw new TypeError('onStep is required');
    this.intervalMs = options.intervalMs ?? AUTOPLAY_INTERVAL_MS;
    this.getIndex = options.getIndex;
    this.onStep = options.onStep;
    this.onEnd = options.onEnd ?? (() => {});
    this.setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearInterval(h));
    this.handle = null;
  }

  /** 再生中か。 */
  get playing() {
    return this.handle !== null;
  }

  /** 再生開始。末尾にいる場合は先頭に巻き戻してから始める。 */
  start() {
    if (this.playing) return;
    if (nextIndex(this.getIndex()) === null) {
      this.onStep(0);
    }
    this.handle = this.setTimer(() => this.tick(), this.intervalMs);
  }

  /** 1 ステップ進める。末尾に達したら停止して onEnd を呼ぶ。 */
  tick() {
    const next = nextIndex(this.getIndex());
    if (next === null) {
      this.stop();
      this.onEnd();
      return;
    }
    this.onStep(next);
  }

  /** 停止（spec: 再生中にクリックで停止）。 */
  stop() {
    if (!this.playing) return;
    this.clearTimer(this.handle);
    this.handle = null;
  }

  /** 再生/停止のトグル。 */
  toggle() {
    if (this.playing) this.stop();
    else this.start();
  }
}
