// 閒置自動登出：有操作就送 heartbeat 延長登入；本機到期時先問後端，真的到期才登出。
// session-timeout.js 與 require-student.js 都有到期計時，兩邊都要能被延長。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE_ROOT } from '../site.mjs';

const read = (file) => fs.readFileSync(`${SITE_ROOT}/${file}`, 'utf8');
const API_BASE = read('shared/api-base.js');
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * 載入 session-timeout.js。clock 可手動前進；計時器只記錄、由測試決定何時執行。
 * respond(path, token) 回傳 { status, body }、'offline'（連線失敗）或 'hang'（一直沒回應）。
 */
function loadTimeout({ storage = { token: 't1', user_role: 'teacher' }, respond } = {}) {
  const clock = { now: 1_000_000 };
  const timers = [], replaced = [], calls = [], listeners = {};
  const DateImpl = class extends Date { static now() { return clock.now; } };
  const sessionStorage = {
    getItem: (key) => (key in storage ? storage[key] : null),
    setItem: (key, value) => { storage[key] = String(value); },
    clear: () => Object.keys(storage).forEach((key) => delete storage[key]),
  };
  const window = {
    location: { href: 'https://example.test/Select/index.html', pathname: '/Select/index.html', hostname: 'example.test', origin: 'https://example.test', replace: (url) => replaced.push(url) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0,
  };
  const document = {
    currentScript: { src: 'https://example.test/shared/session-timeout.js' },
    addEventListener: (name, fn, options) => (listeners[name] ||= []).push({ fn, options }),
  };
  const fetch = async (url, options = {}) => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    const token = (options.headers?.Authorization || '').replace('Bearer ', '');
    calls.push({ path, token, method: options.method || 'GET' });
    const reply = respond ? respond(path, token) : { status: 204 };
    if (reply === 'offline') throw new TypeError('Failed to fetch');
    if (reply === 'hang') {
      // 一直沒回應；被 AbortController 取消時才 reject（和瀏覽器的 fetch 一樣）。
      return new Promise((_, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
      });
    }
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  };
  vm.runInNewContext(API_BASE, { window });
  window.API_BASE_URL = 'https://example.test/api';
  vm.runInNewContext(read('shared/session-timeout.js'), { window, document, sessionStorage, URL, Date: DateImpl, fetch, AbortController });
  return {
    window, storage, timers, replaced, calls, listeners, clock,
    act(name = 'keydown') { listeners[name].forEach(({ fn }) => fn({})); },
    expiresIn: () => Number(storage.login_expires_at) - clock.now,
  };
}

const ok = (expiresIn) => ({ status: 200, body: { role: 'teacher', expiresIn } });

// 規則

test('沒有登入回應的舊分頁，從開啟頁面起算 30 分鐘（原本 1 小時）', () => {
  const run = loadTimeout();
  assert.equal(run.window.WebGameSession.ttlMs, 30 * 60 * 1000);
  assert.equal(run.expiresIn(), 30 * 60 * 1000);
});

test('監聽鍵盤、滑鼠、觸控與捲動，用 capture 且 passive', () => {
  const run = loadTimeout();
  for (const name of ['keydown', 'pointerdown', 'pointermove', 'touchstart', 'wheel', 'scroll']) {
    assert.ok(run.listeners[name], `缺少 ${name}`);
    assert.deepEqual({ ...run.listeners[name][0].options }, { capture: true, passive: true });
  }
});

// heartbeat

test('有操作時送 heartbeat，依回應延長本機到期時間', async () => {
  const run = loadTimeout({ respond: () => ok(1800) });
  run.clock.now += 10 * 60 * 1000; // 過了 10 分鐘，剩 20 分鐘

  run.act();
  await settle();

  assert.deepEqual(run.calls.map((c) => [c.method, c.path]), [['POST', '/auth/heartbeat']]);
  assert.equal(run.expiresIn(), 1800 * 1000);
});

test('一分鐘內連續操作只送一次 heartbeat', async () => {
  const run = loadTimeout({ respond: () => ok(1800) });

  run.act('keydown');
  await settle();
  run.clock.now += 30 * 1000;
  run.act('pointermove');
  run.act('wheel');
  await settle();
  assert.equal(run.calls.length, 1);

  run.clock.now += 31 * 1000;
  run.act('touchstart');
  await settle();
  assert.equal(run.calls.length, 2);
});

test('沒有操作就不送 heartbeat（閒置才會到期）', async () => {
  const run = loadTimeout({ respond: () => ok(1800) });
  run.clock.now += 20 * 60 * 1000;
  await settle();
  assert.equal(run.calls.length, 0);
});

test('heartbeat 卡住超過 15 秒就放棄，之後的操作可以再送', async () => {
  let hang = true;
  const run = loadTimeout({ respond: () => (hang ? 'hang' : ok(1800)) });

  run.act();
  const timeout = run.timers.find((t) => t.ms === 15 * 1000);
  assert.ok(timeout, '應該有 15 秒的請求逾時');
  timeout.fn();
  await settle();

  hang = false;
  run.clock.now += 61 * 1000;
  run.act();
  await settle();

  assert.deepEqual(run.calls.map((c) => c.path), ['/auth/heartbeat', '/auth/heartbeat']);
  assert.equal(run.expiresIn(), 1800 * 1000);
});

test('上一個 heartbeat 還沒回應時不重複送', async () => {
  const run = loadTimeout({ respond: () => 'hang' });

  run.act();
  run.clock.now += 61 * 1000; // 已超過間隔，但第一個還卡著
  run.act();
  await settle();

  assert.equal(run.calls.length, 1);
});

test('雙人模式兩個 token 都送 heartbeat，到期時間取較早者', async () => {
  const run = loadTimeout({
    storage: { user_role: 'student', token: 's1', student1_token: 's1', student2_token: 's2' },
    respond: (path, token) => ok(token === 's1' ? 1800 : 1200),
  });

  run.act();
  await settle();

  assert.deepEqual(run.calls.map((c) => c.token).sort(), ['s1', 's2']);
  assert.equal(run.expiresIn(), 1200 * 1000);
});

test('heartbeat 回 401（例如已達 8 小時上限）時登出並回 Home', async () => {
  const run = loadTimeout({ respond: (path) => (path === '/auth/heartbeat' ? { status: 401 } : { status: 204 }) });

  run.act();
  await settle();

  assert.equal(run.replaced.length, 1);
  assert.match(run.replaced[0], /Home\/index\.html/);
  assert.equal(run.storage.token, undefined);
});

test('heartbeat 連線失敗時不登出，也不改到期時間', async () => {
  const run = loadTimeout({ respond: () => 'offline' });
  const before = run.storage.login_expires_at;

  run.act();
  await settle();

  assert.deepEqual(run.replaced, []);
  assert.equal(run.storage.login_expires_at, before);
});

test('heartbeat 回應通知 require-student.js 重排計時（WebGameAuth.extend）', async () => {
  const run = loadTimeout({ respond: () => ok(1500) });
  const extended = [];
  run.window.WebGameAuth = { extend: (expires) => extended.push(expires) };

  run.act();
  await settle();

  assert.deepEqual(extended, [run.clock.now + 1500 * 1000]);
});

test('未登入時操作不送 heartbeat', async () => {
  const run = loadTimeout({ storage: {} });
  run.act();
  await settle();
  assert.equal(run.calls.length, 0);
});

// 本機到期

test('本機到期時先問後端；後端說還有效（別的分頁延長過）就不登出', async () => {
  const run = loadTimeout({ respond: (path) => (path === '/auth/me' ? ok(900) : { status: 204 }) });
  run.clock.now += 31 * 60 * 1000;

  run.timers.at(-1).fn();
  await settle();

  assert.deepEqual(run.calls.map((c) => c.path), ['/auth/me']);
  assert.deepEqual(run.replaced, []);
  assert.equal(run.expiresIn(), 900 * 1000);
});

test('本機到期、後端也說已失效（401）才登出', async () => {
  const run = loadTimeout({ respond: (path) => (path === '/auth/me' ? { status: 401 } : { status: 204 }) });
  run.clock.now += 31 * 60 * 1000;

  run.timers.at(-1).fn();
  await settle();

  assert.equal(run.replaced.length, 1);
  assert.ok(run.calls.some((c) => c.path === '/auth/logout'));
});

test('本機到期時連不上後端：不登出、不作廢 token，30 秒後再問一次', async () => {
  let online = false;
  const run = loadTimeout({
    respond: (path) => (path === '/auth/me' ? (online ? ok(900) : 'offline') : { status: 204 }),
  });
  run.clock.now += 31 * 60 * 1000;

  run.timers.at(-1).fn();
  await settle();

  assert.deepEqual(run.replaced, []);
  assert.ok(!run.calls.some((c) => c.path === '/auth/logout'));
  assert.equal(run.storage.token, 't1');
  const retry = run.timers.at(-1);
  assert.equal(retry.ms, 30 * 1000);

  online = true;
  retry.fn();
  await settle();

  assert.deepEqual(run.replaced, []);
  assert.equal(run.expiresIn(), 900 * 1000);
});

test('本機到期時連不上後端，之後後端說已失效（401）才登出', async () => {
  let online = false;
  const run = loadTimeout({
    respond: (path) => (path === '/auth/me' ? (online ? { status: 401 } : 'offline') : { status: 204 }),
  });
  run.clock.now += 31 * 60 * 1000;

  run.timers.at(-1).fn();
  await settle();
  online = true;
  run.timers.at(-1).fn();
  await settle();

  assert.equal(run.replaced.length, 1);
});

test('本機到期、雙人其中一位已失效就登出', async () => {
  const run = loadTimeout({
    storage: { user_role: 'student', token: 's1', student1_token: 's1', student2_token: 's2' },
    respond: (path, token) => (path === '/auth/me' ? (token === 's2' ? { status: 401 } : ok(900)) : { status: 204 }),
  });
  run.clock.now += 31 * 60 * 1000;

  run.timers.at(-1).fn();
  await settle();

  assert.equal(run.replaced.length, 1);
});

test('功能頁（有 require-student.js）到期時交給 WebGameAuth.revalidate，自己不問後端、不導頁', async () => {
  const run = loadTimeout({ respond: () => ok(900) });
  let revalidated = 0;
  run.window.WebGameAuth = {
    revalidate: async () => {
      revalidated += 1;
      run.storage.login_expires_at = String(run.clock.now + 900 * 1000); // 驗證通過，寫入新的到期時間
    },
  };
  run.clock.now += 31 * 60 * 1000;
  const before = run.timers.length;

  run.timers.at(-1).fn();
  await settle();

  assert.equal(revalidated, 1);
  assert.equal(run.calls.length, 0);
  assert.deepEqual(run.replaced, []);
  assert.equal(run.timers.length, before + 1); // 依新的到期時間重新排程
  assert.equal(run.timers.at(-1).ms, 900 * 1000);
});

test('計時器提早觸發（還沒到期）時只重新排程，不問後端', async () => {
  const run = loadTimeout({ respond: () => ok(900) });
  run.clock.now += 5 * 60 * 1000;

  run.timers.at(-1).fn();
  await settle();

  assert.equal(run.calls.length, 0);
  assert.deepEqual(run.replaced, []);
});

// require-student.js

async function loadGuard({ responses }) {
  const storage = { user_role: 'student', game_mode: 'single', token: 't1', grade: 'G1', caseId: 'S01', school: 'A' };
  const replaced = [], timers = [], urls = [];
  let reply = 0;
  const document = {
    currentScript: { src: 'https://example.test/shared/require-student.js', dataset: { mode: 'select', role: 'student' } },
    documentElement: { style: {}, inert: false }, readyState: 'complete', querySelectorAll: () => [],
  };
  const sessionStorage = {
    getItem: (key) => storage[key] || null,
    setItem: (key, value) => { storage[key] = String(value); },
    clear: () => Object.keys(storage).forEach((key) => delete storage[key]),
  };
  const window = {
    location: { href: 'https://example.test/Select/index.html', hostname: 'example.test', pathname: '/Select/index.html', origin: 'https://example.test', replace: (url) => replaced.push(url) },
    addEventListener: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
  };
  const fetch = async (url) => {
    urls.push(url);
    const r = responses[Math.min(reply++, responses.length - 1)];
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  vm.runInNewContext(API_BASE, { window });
  vm.runInNewContext(read('shared/require-student.js'), { window, document, sessionStorage, URL, Date, AbortController, fetch });
  await settle();
  return { window, storage, replaced, timers, urls };
}

const me = (expiresIn) => ({ status: 200, body: { role: 'student', grade: 'G1', caseId: 'S01', school: 'A', studentKey: 'G1_S01', expiresIn } });

test('require-student：到期計時觸發時重新向後端驗證；仍有效就留在頁面', async () => {
  const run = await loadGuard({ responses: [me(1), me(1800)] });
  assert.equal(run.urls.length, 1);
  const expiry = run.timers.filter((t) => t.ms !== 5000).at(-1);

  await new Promise((resolve) => setTimeout(resolve, 1100)); // 讓第一次的 1 秒效期真的過去
  expiry.fn();
  await settle();

  assert.equal(run.urls.length, 2);
  assert.deepEqual(run.replaced, []);
  assert.equal(run.window.WebGameAuth.active, true);
});

test('require-student：到期後重新驗證回 401 才登出（auth=expired）', async () => {
  const run = await loadGuard({ responses: [me(1), { status: 401, body: {} }] });
  const expiry = run.timers.filter((t) => t.ms !== 5000).at(-1);

  await new Promise((resolve) => setTimeout(resolve, 1100));
  expiry.fn();
  await settle();

  assert.match(run.replaced[0], /auth=expired/);
  assert.equal(run.storage.user_role, undefined);
});

test('require-student：extend() 更新 login_expires_at 並重排計時', async () => {
  const run = await loadGuard({ responses: [me(600)] });
  const before = run.timers.length;
  const later = Date.now() + 1800 * 1000;

  run.window.WebGameAuth.extend(later);

  assert.equal(Number(run.storage.login_expires_at), later);
  assert.equal(run.timers.length, before + 1);
  assert.ok(Math.abs(run.timers.at(-1).ms - 1800 * 1000) < 1000);
});

test('require-student：extend() 收到無效時間時不動作', async () => {
  const run = await loadGuard({ responses: [me(600)] });
  const before = { ...run.storage };

  run.window.WebGameAuth.extend(NaN);

  assert.deepEqual({ ...run.storage }, before);
});
