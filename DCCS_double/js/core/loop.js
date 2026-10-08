// 固定時間步迴圈（SPEC 4.2）。MAX_FRAME_DT 避免分頁切回前景時暴衝。

import { CONFIG } from '../config.js';

export function createLoop({ update, render }) {
  let running = false;
  let rafId = null;
  let lastTime = null;
  let accumulator = 0;

  function frame(now) {
    if (!running) return;

    if (lastTime === null) {
      lastTime = now;
    }

    let frameDt = (now - lastTime) / 1000;
    lastTime = now;

    if (frameDt > CONFIG.MAX_FRAME_DT) {
      frameDt = CONFIG.MAX_FRAME_DT;
    }

    accumulator += frameDt;

    while (accumulator >= CONFIG.FIXED_DT) {
      update(CONFIG.FIXED_DT);
      accumulator -= CONFIG.FIXED_DT;
    }

    const alpha = accumulator / CONFIG.FIXED_DT;
    render(alpha);

    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastTime = null;
      accumulator = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
    isRunning() {
      return running;
    },
  };
}
