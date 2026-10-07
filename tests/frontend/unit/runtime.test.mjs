import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE_ROOT } from '../site.mjs';
test('凍結排程、保存剩餘 delay，恢復時排除離頁時間並維持 UTC timestamp', () => {
  let now = 1000, serial = 0;
  const native = new Map();
  const window = {
    setTimeout: (fn, delay) => { native.set(++serial, { fn, due: now + delay }); return serial; },
    clearTimeout: (id) => native.delete(id),
    requestAnimationFrame: (fn) => { native.set(++serial, { fn: () => fn(now), due: now + 16 }); return serial; },
    cancelAnimationFrame: (id) => native.delete(id),
    performance: { now: () => now }, dispatchEvent: () => {},
  };
  vm.runInNewContext(fs.readFileSync(`${SITE_ROOT}/shared/game-runtime.js`, 'utf8'), { window, Date: { now: () => now }, Event: class {} });
  const runtime = window.WebGameRuntime;
  let count = 0, frame = null;
  window.setTimeout(() => count++, 100);
  const canceled = window.setTimeout(() => { throw new Error('canceled callback ran'); }, 20);
  window.clearTimeout(canceled);
  window.requestAnimationFrame((time) => frame = time);
  now = 1010; runtime.pause();
  assert.equal(native.size, 0);
  now = 5000;
  assert.equal(runtime.now(), 1010);
  assert.equal(runtime.performanceNow(), 1010);
  assert.equal(count, 0);
  runtime.resume();
  assert.equal(runtime.now(), 1010);
  assert.equal(runtime.toWallTime(1000), 1000);
  assert.equal(runtime.toWallTime(1020), 5010);
  assert.ok([...native.values()].some((task) => task.due === 5090));
  now = 5016;
  for (const [id, task] of [...native]) if (task.due <= now) { native.delete(id); task.fn(); }
  assert.equal(frame, 1026);
  assert.equal(count, 0);
  now = 5090;
  for (const [id, task] of [...native]) if (task.due <= now) { native.delete(id); task.fn(); }
  assert.equal(count, 1);
});
