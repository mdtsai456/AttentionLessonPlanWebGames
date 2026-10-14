import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE_ROOT } from '../site.mjs';
const student = { user_role: 'student', game_mode: 'single', token: 't1', grade: 'G1', caseId: 'S01', school: 'A' };
const body = { role: 'student', grade: 'G1', caseId: 'S01', school: 'A', studentKey: 'G1_S01', expiresAt: new Date(Date.now() + 3600000).toISOString() };
async function guard({ storage = { ...student }, mode = 'single', role = 'student', response = body, status = 200, offline = false, storageThrows = false, DateImpl = Date, apiBaseUrl } = {}) {
  const replaced = [], listeners = {}, style = {}, requests = [], delays = [], urls = [];
  const document = {
    currentScript: { src: 'https://example.test/shared/require-student.js', dataset: { mode, role } },
    documentElement: { style, inert: false }, readyState: 'complete',
    querySelectorAll: () => [],
  };
  const sessionStorage = {
    getItem: (key) => { if (storageThrows) throw new Error('storage disabled'); return storage[key] || null; },
    setItem: (key, value) => storage[key] = value,
    clear: () => Object.keys(storage).forEach((key) => delete storage[key]),
  };
  const window = {
    location: { href: 'https://example.test/game/index.html', hostname: 'example.test', pathname: '/game/index.html', origin: 'https://example.test', replace: (url) => replaced.push(url) },
    addEventListener: (name, fn) => (listeners[name] ||= []).push(fn),
    setTimeout: (fn, ms) => { delays.push(ms); const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
  };
  if (apiBaseUrl) window.API_BASE_URL = apiBaseUrl;
  const fetch = async (url, options) => { urls.push(url); requests.push(options.headers.Authorization); if (offline) throw new Error('offline'); return { ok: status === 200, status, json: async () => response }; };
  vm.runInNewContext(fs.readFileSync(`${SITE_ROOT}/shared/require-student.js`, 'utf8'), { window, document, sessionStorage, URL, Date: DateImpl, AbortController, fetch });
  await new Promise((resolve) => setImmediate(resolve));
  return { window, document, replaced, requests, urls, storage, delays, async restore() { listeners.pageshow.forEach((fn) => fn({ persisted: true })); await new Promise((resolve) => setImmediate(resolve)); } };
}
for (const [label, storage] of [['未登入', {}], ['缺角色', { ...student, user_role: '' }], ['缺 token', { ...student, token: '' }], ['老師', { ...student, user_role: 'teacher' }], ['缺模式', { ...student, game_mode: '' }]]) {
  test(`${label}拒絕啟動`, async () => { const result = await guard({ storage }); assert.equal(result.document.documentElement.inert, true); assert.match(result.replaced[0], /Home\/index.html/); assert.equal(result.requests.length, 0); });
}
test('真正學生驗證成功才解鎖', async () => { const result = await guard(); assert.equal(result.window.WebGameAuth.active, true); assert.deepEqual(result.requests, ['Bearer t1']); assert.equal(result.document.documentElement.inert, false); });
test('學生不能以 teacher 模式啟動選單', async () => { const result = await guard({ mode: 'select', storage: { ...student, game_mode: 'teacher' } }); assert.equal(result.requests.length, 0); assert.match(result.replaced[0], /Home/); });
test('雙人缺搭檔 token 拒絕啟動', async () => { const result = await guard({ mode: 'double', storage: { ...student, game_mode: 'double', student1_token: 't1' } }); assert.match(result.replaced[0], /Home/); });
test('後端角色不符清除本機登入', async () => { const result = await guard({ response: { ...body, role: 'teacher' } }); assert.equal(Object.keys(result.storage).length, 0); });
test('學生欄位必須吻合後端身分', async () => { const result = await guard({ storage: { ...student, school: 'OTHER' } }); assert.match(result.replaced[0], /auth=expired/); });
test('撤銷 token 清除本機登入', async () => { const result = await guard({ status: 401 }); assert.deepEqual(result.storage, {}); });
test('斷線保留登入並提示重試', async () => { const result = await guard({ offline: true }); assert.match(result.replaced[0], /auth=retry/); assert.equal(result.storage.token, 't1'); });
test('進錯模式回 Select', async () => { const result = await guard({ mode: 'double' }); assert.match(result.replaced[0], /Select\/index.html$/); });
test('bfcache 已登出不恢復遊戲', async () => { const result = await guard(); Object.keys(result.storage).forEach((key) => delete result.storage[key]); await result.restore(); assert.match(result.replaced[0], /Home/); assert.equal(result.document.documentElement.inert, true); });
test('bfcache 仍登入再次驗證', async () => { const result = await guard(); await result.restore(); assert.equal(result.requests.length, 2); assert.equal(result.window.WebGameAuth.active, true); });
test('sessionStorage 不可用時仍回 Home', async () => { const result = await guard({ storageThrows: true }); assert.match(result.replaced[0], /Home/); });

// 模擬裝置時鐘比伺服器快 skewMs；expiresAt 是伺服器時鐘的絕對時間。
function skewedDate(skewMs) {
  return class extends Date { static now() { return Date.now() + skewMs; } };
}
const MAX_TIMEOUT = 2 ** 31 - 1;
test('裝置時鐘快 2 小時：依 expiresIn 以本機時間計算到期，不會一登入就被登出', async () => {
  const DateImpl = skewedDate(2 * 3600000);
  const response = { ...body, expiresAt: new Date(Date.now() + 3600000).toISOString(), expiresIn: 3600 };
  const result = await guard({ response, DateImpl });
  assert.deepEqual(result.replaced, []);
  assert.equal(result.window.WebGameAuth.active, true);
  const stored = Number(result.storage.login_expires_at);
  assert.ok(Math.abs(stored - (DateImpl.now() + 3600000)) < 2000, `login_expires_at=${stored}`);
});
test('裝置時鐘快 30 分鐘：剩餘時間仍是完整的 expiresIn', async () => {
  const DateImpl = skewedDate(30 * 60000);
  const response = { ...body, expiresAt: new Date(Date.now() + 3600000).toISOString(), expiresIn: 3600 };
  const result = await guard({ response, DateImpl });
  const remaining = Number(result.storage.login_expires_at) - DateImpl.now();
  assert.ok(remaining > 3590000, `remaining=${remaining}`);
});
test('expiresIn 為 0 視同已過期', async () => {
  const result = await guard({ response: { ...body, expiresIn: 0 } });
  assert.match(result.replaced[0], /auth=expired/);
});
test('舊後端沒有 expiresIn 時沿用 expiresAt', async () => {
  const expiresAt = Date.now() + 1800000;
  const result = await guard({ response: { ...body, expiresAt: new Date(expiresAt).toISOString() } });
  assert.equal(result.window.WebGameAuth.active, true);
  assert.equal(Number(result.storage.login_expires_at), expiresAt);
});
test('expiresIn 每次 /auth/me 都不同，不算身分改變', async () => {
  let remaining = 3600;
  const response = { ...body };
  Object.defineProperty(response, 'expiresIn', { enumerable: true, get: () => remaining-- });
  const result = await guard({ response });
  await result.restore();
  assert.deepEqual(result.replaced, []);
  assert.equal(result.window.WebGameAuth.active, true);
});
test('到期時間超過 setTimeout 上限（約 24.8 天）時不會溢位而立刻登出', async () => {
  const response = { ...body, expiresAt: '2099-01-01T00:00:00.000Z' };
  const result = await guard({ response });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(result.replaced, []);
  assert.equal(result.window.WebGameAuth.active, true);
  assert.ok(result.delays.every((ms) => ms <= MAX_TIMEOUT), `delays=${result.delays}`);
});

test('API_BASE_URL 結尾有斜線時，/auth/me 不會變成 //auth/me', async () => {
  const result = await guard({ apiBaseUrl: 'https://host.test/api/' });
  assert.deepEqual(result.urls, ['https://host.test/api/auth/me']);
});
