import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE_ROOT } from '../site.mjs';

const MAX_TIMEOUT = 2 ** 31 - 1;

// 載入 shared/session-timeout.js；計時器只記錄不執行，裝置時鐘可偏移 skewMs。
function load({ storage = { token: 't1', user_role: 'student' }, skewMs = 0, apiBaseUrl } = {}) {
  const timers = [], replaced = [], fetched = [];
  const DateImpl = class extends Date { static now() { return Date.now() + skewMs; } };
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
  const document = { currentScript: { src: 'https://example.test/shared/session-timeout.js' }, addEventListener: () => {} };
  vm.runInNewContext(fs.readFileSync(`${SITE_ROOT}/shared/session-timeout.js`, 'utf8'), {
    window, document, sessionStorage, URL, Date: DateImpl, fetch: async (url) => { fetched.push(url); return {}; },
  });
  if (apiBaseUrl) window.API_BASE_URL = apiBaseUrl;
  return { session: window.WebGameSession, storage, timers, replaced, fetched, DateImpl };
}

test('登入回應帶 expiresIn：以本機時間加剩餘秒數，不受裝置時鐘快慢影響', () => {
  const run = load({ skewMs: 2 * 3600000 });
  run.session.stampLoginExpiry({ expiresAt: new Date(Date.now() + 1800000).toISOString(), expiresIn: 1800 });
  const remaining = Number(run.storage.login_expires_at) - run.DateImpl.now();
  assert.ok(Math.abs(remaining - 1800000) < 1000, `remaining=${remaining}`);
  assert.deepEqual(run.replaced, []);
});

test('雙人登入取兩人中較早到期者', () => {
  const run = load({ skewMs: -3600000 });
  run.session.stampLoginExpiry([
    { expiresAt: new Date(Date.now() + 3600000).toISOString(), expiresIn: 3600 },
    { expiresAt: new Date(Date.now() + 3000000).toISOString(), expiresIn: 3000 },
  ]);
  const remaining = Number(run.storage.login_expires_at) - run.DateImpl.now();
  assert.ok(Math.abs(remaining - 3000000) < 1000, `remaining=${remaining}`);
});

test('沒有 expiresIn 時沿用 expiresAt 字串（相容舊後端）', () => {
  const run = load();
  const expiresAt = Date.now() + 1200000;
  run.session.stampLoginExpiry({ expiresAt: new Date(expiresAt).toISOString() });
  assert.equal(Number(run.storage.login_expires_at), expiresAt);
  run.session.stampLoginExpiry(new Date(expiresAt).toISOString());
  assert.equal(Number(run.storage.login_expires_at), expiresAt);
});

test('到期時間超過 setTimeout 上限時分段等待，不會溢位而立刻登出', () => {
  const run = load();
  run.session.stampLoginExpiry('2099-01-01T00:00:00.000Z');
  const last = run.timers.at(-1);
  assert.ok(last.ms <= MAX_TIMEOUT, `delay=${last.ms}`);
  last.fn(); // 第一段時間到，尚未真正到期：應重新排程而不是登出
  assert.deepEqual(run.replaced, []);
  assert.equal(run.storage.token, 't1');
  assert.ok(run.timers.at(-1).ms <= MAX_TIMEOUT);
});

test('API_BASE_URL 結尾有斜線時，到期登出不會打到 //auth/logout', () => {
  const run = load({ apiBaseUrl: 'https://host.test/api/' });
  run.session.expireSession(true);
  assert.deepEqual(run.fetched, ['https://host.test/api/auth/logout']);
});
