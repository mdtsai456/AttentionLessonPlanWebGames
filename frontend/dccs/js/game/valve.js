// 單向環狀選項輪盤（SPEC 4.8）。step() 排入整格動作，update() 負責動畫；
// slots() 僅計算單側顯示位置，答案始終由 centerIndex() 決定。

import { CONFIG } from '../config.js';

function wrapUnsigned(v, n) {
  return ((v % n) + n) % n;
}

export class Valve {
  /**
   * @param {{items: Array<object>, direction: -1|1, z: number, kind: 'shape'|'object'}} opts
   */
  constructor({ items, direction, z, kind }) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Valve: items must be a non-empty array');
    }
    if (direction !== -1 && direction !== 1) {
      throw new Error('Valve: direction must be -1 or 1');
    }
    this.items = items;
    this.direction = direction;
    this.z = z;
    this.kind = kind;

    // 累計完成格數保持整數，避免 theta 停靠時產生浮點殘差。
    this._settledSteps = 0;
    this._pendingSteps = 0;
    this._progress = 0;
  }

  get theta() {
    return this.direction * (this._settledSteps + this._progress);
  }

  get isMoving() {
    return this._pendingSteps > 0;
  }

  get pendingSteps() {
    return this._pendingSteps;
  }

  /** 排入 count 格；動畫進行中可繼續累積。 */
  step(count = 1) {
    if (!Number.isFinite(count) || count <= 0) return;
    this._pendingSteps += Math.floor(count);
  }

  /** 推進動畫；單幀可跨越多格，但不超過已排入的格數。 */
  update(dt) {
    let remaining = dt;
    while (remaining > 0 && this._pendingSteps > 0) {
      const remainingInStep = (1 - this._progress) * CONFIG.ROT_SEC_PER_SLOT;
      if (remaining >= remainingInStep) {
        this._settledSteps += 1;
        this._pendingSteps -= 1;
        this._progress = 0;
        remaining -= remainingInStep;
      } else {
        this._progress += remaining / CONFIG.ROT_SEC_PER_SLOT;
        remaining = 0;
      }
    }
  }

  centerIndex() {
    const n = this.items.length;
    const idx = Math.round(this.theta);
    return wrapUnsigned(idx, n);
  }

  answer() {
    return this.items[this.centerIndex()];
  }

  /** 回傳單側佇列中仍在繪製範圍內的選項。 */
  slots() {
    const n = this.items.length;
    const theta = this.theta;
    const direction = this.direction;
    const result = [];
    for (let i = 0; i < n; i++) {
      const off = wrapUnsigned(direction * (i - theta) + 0.5, n) - 0.5;
      const lane = -direction * off * CONFIG.SLOT_LANE_SPACING;
      if (Math.abs(lane) <= CONFIG.SLOT_RENDER_LIMIT) {
        result.push({ item: this.items[i], lane });
      }
    }
    return result;
  }
}
