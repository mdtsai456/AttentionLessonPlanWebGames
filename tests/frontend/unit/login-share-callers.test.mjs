// 呼叫 login-share.js 的地方：登入失效／到期時要刪除共用副本，連線逾時不刪；
// storedTokens() 要包含共用副本的 token。用假的 WebGameLogin 記錄呼叫。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE_ROOT } from '../site.mjs';

const read = (file) => fs.readFileSync(`${SITE_ROOT}/${file}`, 'utf8');
const API_BASE = read('shared/api-base.js');

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    clear: () => Object.keys(data).forEach((key) => delete data[key]),
  };
}

/** 假的 WebGameLogin：記錄 forget 被呼叫時，sessionStorage 是否還沒清空。 */
function fakeLogin(sessionStorage, tokens = []) {
  const calls = [];
  return {
    calls,
    forget: (options) => calls.push({ options, idStillThere: sessionStorage.getItem('login_share_id') }),
    sharedTokens: () => tokens,
  };
}

const STUDENT = {
  user_role: 'student', game_mode: 'single', token: 't1',
  grade: 'G1', caseId: 'S01', school: 'A', login_share_id: 'id-1',
};
const ME = { role: 'student', grade: 'G1', caseId: 'S01', school: 'A', studentKey: 'G1_S01', expiresIn: 3600 };

async function runGuard({ status = 200, offline = false, response = ME } = {}) {
  const sessionStorage = memoryStorage(STUDENT);
  const login = fakeLogin(sessionStorage);
  const replaced = [];
  const window = {
    WebGameLogin: login,
    location: { href: 'https://example.test/Select/index.html', hostname: 'example.test', pathname: '/Select/index.html', origin: 'https://example.test', replace: (url) => replaced.push(url) },
    addEventListener: () => {},
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    clearTimeout,
  };
  const document = {
    currentScript: { src: 'https://example.test/shared/require-student.js', dataset: { role: 'student', mode: 'select' } },
    documentElement: { style: {}, inert: false }, readyState: 'complete', querySelectorAll: () => [],
  };
  const fetch = async () => {
    if (offline) throw new Error('offline');
    return { ok: status === 200, status, json: async () => response };
  };
  vm.runInNewContext(API_BASE, { window });
  vm.runInNewContext(read('shared/require-student.js'), { window, document, sessionStorage, URL, Date, AbortController, fetch });
  await new Promise((resolve) => setImmediate(resolve));
  return { login, sessionStorage, replaced };
}

test('require-student：登入失效（401）時刪除共用副本，且在清空 sessionStorage 之前', async () => {
  const run = await runGuard({ status: 401 });

  assert.equal(run.login.calls.length, 1);
  assert.equal(run.login.calls[0].idStillThere, 'id-1');
  assert.equal(run.sessionStorage.getItem('user_role'), null);
  assert.match(run.replaced[0], /auth=expired/);
});

test('require-student：連線失敗（retry）不刪共用副本，其他分頁不受影響', async () => {
  const run = await runGuard({ offline: true });

  assert.equal(run.login.calls.length, 0);
  assert.match(run.replaced[0], /auth=retry/);
});

test('require-student：驗證成功不刪共用副本', async () => {
  const run = await runGuard();

  assert.equal(run.login.calls.length, 0);
  assert.deepEqual(run.replaced, []);
});

test('session-timeout：到期登出時刪除共用副本，且在清空 sessionStorage 之前', () => {
  const sessionStorage = memoryStorage({ ...STUDENT, student1_token: 't1' });
  const login = fakeLogin(sessionStorage);
  const replaced = [];
  const window = {
    WebGameLogin: login,
    location: { href: 'https://example.test/Select/index.html', pathname: '/Select/index.html', hostname: 'example.test', origin: 'https://example.test', replace: (url) => replaced.push(url) },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
  };
  const document = { currentScript: { src: 'https://example.test/shared/session-timeout.js' }, addEventListener: () => {} };
  vm.runInNewContext(API_BASE, { window });
  vm.runInNewContext(read('shared/session-timeout.js'), { window, document, sessionStorage, URL, Date, fetch: async () => ({}) });

  window.WebGameSession.expireSession(true);

  assert.equal(login.calls.length, 1);
  assert.equal(login.calls[0].idStillThere, 'id-1');
  assert.equal(sessionStorage.getItem('user_role'), null);
  assert.equal(replaced.length, 1);
});

function loadApi({ session = {}, shared } = {}) {
  const sessionStorage = memoryStorage(session);
  const window = { location: { pathname: '/', hostname: 'example.test' } };
  if (shared) window.WebGameLogin = fakeLogin(sessionStorage, shared);
  vm.runInNewContext(API_BASE, { window });
  vm.runInNewContext(read('shared/api.js'), { window, sessionStorage, fetch: async () => ({}) });
  return window.WebGameApi;
}

test('storedTokens：包含其他分頁共用的 token，並去重', () => {
  const api = loadApi({ session: { token: 'a', student1_token: 'a' }, shared: ['a', 'b'] });

  assert.deepEqual([...api.storedTokens()], ['a', 'b']);
});

test('storedTokens：這個分頁沒登入時，仍回傳共用的 token（登入新帳號前要先登出）', () => {
  const api = loadApi({ shared: ['b', 'c'] });

  assert.deepEqual([...api.storedTokens()], ['b', 'c']);
});

test('storedTokens：沒有載入 login-share.js 的頁面維持原本行為', () => {
  const api = loadApi({ session: { student1_token: 'x', student2_token: 'y', token: 'x' } });

  assert.deepEqual([...api.storedTokens()], ['x', 'y']);
});
