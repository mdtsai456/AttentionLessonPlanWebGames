import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// uuid：模擬 shared/api.js 的 WebGameApi.uuid()；不給時代表沒有 submissionId（舊行為）。
async function setup(fetch, { uuid } = {}) {
  const window = uuid ? { WebGameApi: { uuid } } : {};
  const context = vm.createContext({ window, fetch, AbortController, setTimeout, clearTimeout });
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
  // 失敗不會自己重送；只有玩家的動作（重試、離開時再存一次）才重送，而且送原始成績
  assert.deepEqual(bodies, ['{"score":3}']);
  const first = saver.retry();
  const second = saver.retry();
  const third = saver.save(6, { score: 100 });
  finish({ ok: true, json: async () => ({ sessionId: 'test' }) });
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(await third, true);
  assert.deepEqual(bodies, ['{"score":3}', '{"score":3}']);
});

test('沒有 submissionId 時，連線中斷／回應不明／body逾時不可重送，保留未知狀態', async () => {
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

test('中場紀錄未確認後，六關成績仍送出新的一筆並顯示最新狀態（#24）', async () => {
  const bodies = [];
  const changes = [];
  const api = await setup((url, options) => {
    bodies.push(JSON.parse(options.body));
    // 第一筆（第 3 關中場）斷線，結果不明；第二筆（第 6 關）正常寫入
    if (bodies.length === 1) return Promise.reject(new Error('offline'));
    return Promise.resolve({ ok: true, json: async () => ({ sessionId: 'final' }) });
  });
  const saver = api.create({ url: '/sessions', onChange: (state) => changes.push(state) });
  assert.equal(await saver.save(3, { stage: 3 }), false);
  assert.equal(saver.status, 'unknown');
  assert.equal(await saver.retry(), false, '未知紀錄不可人工重送');
  assert.equal(await saver.save(3, { stage: 3 }), false, '同一關不重送');
  assert.equal(bodies.length, 1);

  assert.equal(await saver.save(6, { stage: 6 }), true, '不同關卡的最終成績要送出');
  assert.deepEqual(bodies.map((body) => body.stage), [3, 6]);
  assert.equal(saver.status, 'saved');
  assert.equal(changes.at(-1).message, '成績已儲存', '結算畫面顯示最終成績狀態，而不是中場的舊訊息');
  assert.equal(saver.savedStage, 6);
  assert.equal(saver.canRestart(), true, '最終成績已儲存即可重玩');
  assert.equal(await saver.save(6, {}), true);
  assert.equal(bodies.length, 2);
});

test('中場紀錄未確認後，最終成績 HTTP 失敗仍可人工重試最終成績（#24）', async () => {
  const bodies = [];
  const api = await setup((url, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) return Promise.reject(new Error('offline'));
    if (bodies.length === 2) return Promise.resolve({ ok: false, status: 500 });
    return Promise.resolve({ ok: true, json: async () => ({ sessionId: 'final' }) });
  });
  const saver = api.create({ url: '/sessions' });
  assert.equal(await saver.save(3, { stage: 3 }), false);
  assert.equal(await saver.save(6, { stage: 6 }), false);
  assert.equal(saver.status, 'failed');
  assert.equal(await saver.retry(), true);
  assert.deepEqual(bodies.map((body) => body.stage), [3, 6, 6], '只重試最終成績，不重送未知的中場紀錄');
  assert.equal(saver.canRestart(), true);
});

// R2：較高關卡（例如第 6 關最終成績）已送出後，不可再送較低關卡的檢查點。
// 雙人版玩家 A 第 6 關逾時（伺服器可能已寫入）、玩家 B 還在第 4 關按離開時，
// 離開流程會替兩人都存第 3 關檢查點；A 不能因此多一筆第 3 關。
test('沒有 submissionId 時，較高關卡結果不明，較低關卡檢查點不送出並維持未確認狀態（R2）', async () => {
  const bodies = [];
  const changes = [];
  const api = await setup((url, options) => {
    bodies.push(JSON.parse(options.body));
    return Promise.reject(new Error('offline'));
  });
  const saver = api.create({ url: '/sessions', onChange: (state) => changes.push(state) });
  assert.equal(await saver.save(6, { stage: 6 }), false);
  assert.equal(saver.status, 'unknown');
  assert.equal(await saver.save(3, { stage: 3 }), false, '第 6 關結果不明時不送第 3 關');
  assert.deepEqual(bodies.map((body) => body.stage), [6]);
  assert.equal(saver.status, 'unknown', '畫面仍顯示最終成績未確認');
  assert.equal(changes.at(-1).status, 'unknown');
  assert.equal(changes.at(-1).retryable, false);
  assert.equal(saver.canRestart(), false);
});

test('較高關卡已儲存時，較低關卡檢查點直接視為完成、不送出（R2）', async () => {
  const bodies = [];
  const api = await setup((url, options) => {
    bodies.push(JSON.parse(options.body));
    return Promise.resolve({ ok: true, json: async () => ({ sessionId: 'final' }) });
  });
  const saver = api.create({ url: '/sessions' });
  assert.equal(await saver.save(6, { stage: 6 }), true);
  assert.equal(await saver.save(3, { stage: 3 }), true);
  assert.deepEqual(bodies.map((body) => body.stage), [6]);
  assert.equal(saver.status, 'saved');
});

test('較高關卡明確失敗時，較低關卡不送出，改重送較高關卡（R2、#42）', async () => {
  const bodies = [];
  const api = await setup((url, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) return Promise.resolve({ ok: false, status: 500 });
    return Promise.resolve({ ok: true, json: async () => ({ sessionId: 'final' }) });
  });
  const saver = api.create({ url: '/sessions' });
  assert.equal(await saver.save(6, { stage: 6 }), false);
  assert.equal(saver.status, 'failed');
  assert.equal(await saver.save(3, { stage: 3 }), true, '第 6 關還沒存好時重送第 6 關，不改送第 3 關');
  assert.equal(await saver.retry(), true);
  assert.deepEqual(bodies.map((body) => body.stage), [6, 6]);
});

test('較高關卡送出中排隊的較低關卡，等結果出來再判斷，不明就不送，也不立刻重送剛逾時的那筆（R2、#42）', async () => {
  for (const uuid of [undefined, () => crypto.randomUUID()]) {
    const bodies = [];
    let fail;
    const api = await setup((url, options) => {
      bodies.push(JSON.parse(options.body));
      return new Promise((resolve, reject) => { fail = reject; });
    }, { uuid });
    const saver = api.create({ url: '/sessions' });
    const final = saver.save(6, { data: { stage: 6 } });
    const checkpoint = saver.save(3, { data: { stage: 3 } });
    fail(new Error('offline'));
    assert.equal(await final, false);
    assert.equal(await checkpoint, false);
    assert.deepEqual(bodies.map((body) => body.data.stage), [6], '等到的結果就是答案，不重送、不改送第 3 關');
    assert.equal(saver.status, 'unknown');
  }
});

// R3：確認離開後遊戲時鐘維持暫停（被包裝的 setTimeout 不會觸發），存檔逾時要用原生計時器。
test('請求逾時使用 WebGameRuntime.nativeSetTimeout，遊戲暫停時仍會逾時（R3）', async () => {
  const native = [];
  const cleared = [];
  const context = vm.createContext({
    window: {
      WebGameRuntime: {
        nativeSetTimeout: (fn, ms) => { native.push({ fn, ms }); return native.length; },
        nativeClearTimeout: (id) => { cleared.push(id); },
      },
    },
    fetch: () => new Promise(() => {}),
    AbortController,
    // 被暫停的遊戲計時器：永遠不觸發
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
  vm.runInContext(await readFile(new URL('../../shared/dat-save.js', import.meta.url), 'utf8'), context);
  const saver = context.window.DatSave.create({ url: '/sessions', timeoutMs: 1234 });
  const result = saver.save(3, { stage: 3 });
  assert.equal(native.length, 1, '逾時計時器要用原生計時器');
  assert.equal(native[0].ms, 1234);
  native[0].fn();
  assert.equal(await result, false);
  assert.equal(saver.status, 'unknown');
  assert.deepEqual(cleared, [1], '結束後清掉原生計時器');
});

// #42：每筆成績帶 submissionId（UUID v4），重送沿用，後端遇到同一個 submissionId 回同一個 sessionId，
// 所以結果不明的成績可以安全重送，學生不會被卡住。
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const realUuid = () => crypto.randomUUID();
const ok = (id = 'ok') => Promise.resolve({ ok: true, json: async () => ({ sessionId: id }) });
const offline = () => Promise.reject(new Error('offline'));
const payload = (stage) => ({ lessonId: '1140908_DAT', data: { caseId: 'S03', stage } });

test('送出的成績帶 data.submissionId（UUID v4），不改到呼叫端的 payload（#42）', async () => {
  const bodies = [];
  const api = await setup((url, options) => { bodies.push(JSON.parse(options.body)); return ok(); }, { uuid: realUuid });
  const saver = api.create({ url: '/sessions' });
  const original = payload(6);
  assert.equal(await saver.save(6, original), true);
  assert.match(bodies[0].data.submissionId, V4);
  assert.equal(bodies[0].data.caseId, 'S03');
  assert.equal(original.data.submissionId, undefined, '不修改呼叫端物件');
});

test('結果不明後再存同一關（例如按離開）會用同一個 submissionId 重送並成功（#42）', async () => {
  const bodies = [];
  const changes = [];
  const api = await setup((url, options) => {
    bodies.push(options.body);
    return bodies.length === 1 ? offline() : ok();
  }, { uuid: realUuid });
  const saver = api.create({ url: '/sessions', onChange: (state) => changes.push(state) });
  assert.equal(await saver.save(3, payload(3)), false);
  assert.equal(saver.status, 'unknown');
  assert.equal(changes.at(-1).retryable, true, '有 submissionId 的未知結果可以重試');
  assert.match(changes.at(-1).message, /^存檔結果未確認/);
  assert.equal(await saver.save(3, payload(99)), true, '離開時再存一次就重送原本那筆');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1], bodies[0], '重送的 body（含 submissionId）完全相同');
  assert.equal(saver.status, 'saved');
  assert.equal(saver.savedStage, 3);
});

test('未知結果用重試鈕重送；重送失敗留在失敗狀態，之後再重試成功，全程同一個 submissionId（#42）', async () => {
  const bodies = [];
  const api = await setup((url, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) return offline();
    if (bodies.length === 2) return Promise.resolve({ ok: false, status: 500 });
    return ok();
  }, { uuid: realUuid });
  const saver = api.create({ url: '/sessions' });
  assert.equal(await saver.save(6, payload(6)), false);
  assert.equal(saver.status, 'unknown');
  assert.equal(await saver.retry(), false);
  assert.equal(saver.status, 'failed');
  assert.equal(saver.canRestart(), false);
  assert.equal(await saver.retry(), true);
  assert.equal(saver.canRestart(), true);
  assert.equal(new Set(bodies.map((body) => body.data.submissionId)).size, 1);
  assert.equal(bodies.length, 3);
});

test('逾時的未知結果也能重送（同一個 submissionId）（#42）', async () => {
  const bodies = [];
  const api = await setup((url, options) => {
    bodies.push(options.body);
    return bodies.length === 1 ? new Promise(() => {}) : ok();
  }, { uuid: realUuid });
  const saver = api.create({ url: '/sessions', timeoutMs: 10 });
  assert.equal(await saver.save(6, payload(6)), false);
  assert.equal(saver.status, 'unknown');
  assert.equal(await saver.retry(), true);
  assert.equal(bodies[1], bodies[0]);
});

test('同一局的第 3 關與第 6 關共用 submissionId（後端以較高關卡更新同一列）；新的一局（新 saver）是新的 submissionId（#42）', async () => {
  const bodies = [];
  const api = await setup((url, options) => { bodies.push(JSON.parse(options.body)); return ok(); }, { uuid: realUuid });
  const first = api.create({ url: '/sessions' });
  assert.equal(await first.save(3, payload(3)), true);
  assert.equal(await first.save(6, payload(6)), true);
  const second = api.create({ url: '/sessions' });
  assert.equal(await second.save(6, payload(6)), true);
  const ids = bodies.map((body) => body.data.submissionId);
  assert.equal(ids.length, 3);
  for (const id of ids) assert.match(id, V4);
  assert.equal(ids[1], ids[0], '同一局的中場與最終成績是同一場');
  assert.notEqual(ids[2], ids[0], '新的一局不能蓋掉上一局');
});

test('較高關卡結果不明時，存較低關卡改成重送較高那筆（同一個 submissionId），成功就算完成（R2、#42）', async () => {
  const bodies = [];
  const api = await setup((url, options) => {
    bodies.push(JSON.parse(options.body));
    return bodies.length <= 2 ? offline() : ok();
  }, { uuid: realUuid });
  const saver = api.create({ url: '/sessions' });
  assert.equal(await saver.save(6, payload(6)), false);
  assert.equal(await saver.save(3, payload(3)), false, '重送第 6 關仍不明');
  assert.equal(saver.status, 'unknown');
  assert.equal(await saver.save(3, payload(3)), true, '再試一次第 6 關成功');
  assert.deepEqual(bodies.map((body) => body.data.stage), [6, 6, 6], '從不送第 3 關');
  assert.equal(new Set(bodies.map((body) => body.data.submissionId)).size, 1);
  assert.equal(saver.savedStage, 6);
});
