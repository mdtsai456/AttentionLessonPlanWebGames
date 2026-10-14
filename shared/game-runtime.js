// 從 bfcache 返回並等待驗證時，暫停遊戲排程。計時扣除離開頁面與等待驗證的時間，並保留遊戲狀態。
(function (global) {
  const timeout = global.setTimeout.bind(global);
  const clear = global.clearTimeout.bind(global);
  const raf = global.requestAnimationFrame.bind(global);
  const cancelRaf = global.cancelAnimationFrame.bind(global);
  const wallNow = Date.now.bind(Date);
  const perfNow = global.performance.now.bind(global.performance);
  const tasks = new Map();
  const offsets = [];
  let serial = 0;
  let paused = false;
  // 暫停原因：每個暫停者各自掛一個，全部解除才真正恢復。
  // 例如離開確認框開著時，登入驗證完成的 resume() 不能讓遊戲繼續跑。
  const holds = new Set();
  let pausedAt = 0;
  let pausedPerf = 0;
  let wallOffset = 0;
  let perfOffset = 0;

  function arm(task) {
    if (paused) return;
    if (task.frame) {
      task.native = raf((time) => {
        if (!tasks.has(task.id) || paused) return;
        tasks.delete(task.id);
        task.callback(time - perfOffset);
      });
    } else {
      task.due = wallNow() + task.remaining;
      task.native = timeout(() => {
        if (!tasks.has(task.id) || paused) return;
        if (task.interval) { task.remaining = task.delay; arm(task); }
        else tasks.delete(task.id);
        task.callback(...task.args);
      }, task.remaining);
    }
  }
  function schedule(callback, delay, interval, args, frame = false) {
    const id = ++serial;
    const task = { id, callback, args, frame, interval, delay: Math.max(0, Number(delay) || 0), remaining: Math.max(0, Number(delay) || 0) };
    tasks.set(id, task); arm(task); return id;
  }
  function remove(id) {
    const task = tasks.get(id);
    if (!task) return;
    if (task.frame) cancelRaf(task.native); else clear(task.native);
    tasks.delete(id);
  }
  global.setTimeout = (fn, delay, ...args) => schedule(fn, delay, false, args);
  global.setInterval = (fn, delay, ...args) => schedule(fn, delay, true, args);
  global.clearTimeout = global.clearInterval = remove;
  global.requestAnimationFrame = (fn) => schedule(fn, 0, false, [], true);
  global.cancelAnimationFrame = remove;
  global.WebGameRuntime = {
    // 不受暫停影響的原生計時器：給網路請求的逾時用（例如確認離開後遊戲暫停、成績照常送出）。
    nativeSetTimeout: (fn, delay, ...args) => timeout(fn, delay, ...args),
    nativeClearTimeout: (id) => clear(id),
    now: () => (paused ? pausedAt : wallNow()) - wallOffset,
    toWallTime(value) {
      const offset = offsets.findLast((point) => value >= point.clock);
      return value + (offset ? offset.offset : 0);
    },
    performanceNow: () => (paused ? pausedPerf : perfNow()) - perfOffset,
    get paused() { return paused; },
    pause(reason = "default") {
      holds.add(reason);
      if (paused) return;
      paused = true; pausedAt = wallNow(); pausedPerf = perfNow();
      global.dispatchEvent(new Event("webgame:pause"));
      for (const task of tasks.values()) {
        if (task.frame) cancelRaf(task.native);
        else { clear(task.native); task.remaining = Math.max(0, task.due - pausedAt); }
      }
    },
    resume(reason = "default") {
      holds.delete(reason);
      if (!paused || holds.size) return;
      const clock = pausedAt - wallOffset;
      wallOffset += wallNow() - pausedAt;
      offsets.push({ clock, offset: wallOffset });
      perfOffset += perfNow() - pausedPerf;
      paused = false;
      for (const task of tasks.values()) arm(task);
    },
  };
})(window);
