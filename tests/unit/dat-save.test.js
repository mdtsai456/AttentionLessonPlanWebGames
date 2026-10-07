import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function setup(fetch) {
  const context = vm.createContext({ window: {}, fetch, AbortController, setTimeout, clearTimeout });
  vm.runInContext(await readFile(new URL('../../shared/dat-save.js', import.meta.url), 'utf8'), context);
  return context.window.DatSave;
}

test('同一關卡並行／成功後呼叫僅送一次，成功後才標記儲存', async () => {
  let finish;
  let calls = 0;
  const api = await setup(() => { calls++; return new Promise((resolve) => { finish = resolve; }); });
  const saver = api.create({ url: '/sessions' });
  const first = saver.save(6, { score: 4 });
  const second = saver.save(6, { score: 5 });
  assert.equal(saver.savedStage, 0);
  assert.equal(saver.canRestart(), false);
  finish({ ok: true, json: async () => ({ sessionId: 'test' }) });
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(await saver.save(6, {}), true);
  assert.equal(calls, 1);
  assert.equal(saver.savedStage, 6);
  assert.equal(saver.canRestart(), true);
});

test('HTTP 失敗人工重試保留原始payload，連按不並行', async () => {
  const bodies = [];
  let finish;
  const api = await setup((url, options) => {
    bodies.push(options.body);
    if (bodies.length === 1) return Promise.resolve({ ok: false });
    return new Promise((resolve) => { finish = resolve; });
  });
  const saver = api.create({ url: '/sessions' });
  const payload = { score: 3 };
  assert.equal(await saver.save(6, payload), false);
  payload.score = 99;
  assert.equal(saver.status, 'failed');
  assert.equal(saver.canRestart(), false);
  assert.equal(await saver.save(6, {}), false, '不自動重試');
  const first = saver.retry();
  const second = saver.retry();
  finish({ ok: true, json: async () => ({ sessionId: 'test' }) });
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(bodies, ['{"score":3}', '{"score":3}']);
});

test('連線中斷／回應不明／body逾時不可重送，保留未知狀態', async () => {
  for (const fetch of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: true, json: async () => ({}) }),
    async () => ({ ok: true, json: () => new Promise(() => {}) }),
  ]) {
    let calls = 0;
    const api = await setup((...args) => { calls++; return fetch(...args); });
    const saver = api.create({ url: '/sessions', timeoutMs: 10 });
    assert.equal(await saver.save(6, {}), false);
    assert.equal(saver.status, 'unknown');
    assert.equal(await saver.retry(), false);
    assert.equal(calls, 1);
    assert.equal(saver.savedStage, 0);
    assert.equal(saver.canRestart(), false);
  }
});

test('代理逾時不能當成明確拒絕而提供重試', async () => {
  for (const status of [408, 502, 503, 504]) {
    const api = await setup(async () => ({ ok: false, status }));
    const saver = api.create({ url: '/sessions' });
    assert.equal(await saver.save(6, {}), false);
    assert.equal(saver.status, 'unknown');
    assert.equal(await saver.retry(), false);
  }
});
