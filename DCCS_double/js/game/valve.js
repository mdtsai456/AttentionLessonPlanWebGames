// 單向環狀選項輪盤（SPEC 4.8）。step() 將整格轉動加入佇列。update() 更新動畫。
// slots() 僅計算單側顯示位置。centerIndex() 決定答案。

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

    // 完成的累計格數保持為整數，避免 theta 停止轉動時產生浮點誤差。
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

  /** 將 count 格轉動加入佇列。動畫進行期間可繼續累加。 */
  step(count = 1) {
    if (!Number.isFinite(count) || count <= 0) return;
    this._pendingSteps += Math.floor(count);
  }

  /** 更新動畫。單幀可轉動多格，但不超過佇列中的格數。 */
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
    // 先使用已完成轉動的選項。轉動至中點且兩側距離相同時，維持原選項，
    // 避免 Math.round 在負向閥門提早切換，將仍在中央的正確答案判為錯誤。
    let best = wrapUnsigned(this.direction * this._settledSteps, n);
    let bestAbs = Infinity;
    const theta = this.theta;
    for (let i = 0; i < n; i++) {
      const off = wrapUnsigned(this.direction * (i - theta) + 0.5, n) - 0.5;
      const abs = Math.abs(off);
      if (abs < bestAbs - 1e-6) {
        bestAbs = abs;
        best = i;
      }
    }
    return best;
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
