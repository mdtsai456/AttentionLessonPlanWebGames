import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE_ROOT } from '../site.mjs';
const student = { user_role: 'student', game_mode: 'single', token: 't1', grade: 'G1', caseId: 'S01', school: 'A' };
const body = { role: 'student', grade: 'G1', caseId: 'S01', school: 'A', studentKey: 'G1_S01', expiresAt: new Date(Date.now() + 3600000).toISOString() };
async function guard({ storage = { ...student }, mode = 'single', role = 'student', response = body, status = 200, offline = false, storageThrows = false } = {}) {
  const replaced = [], listeners = {}, style = {}, requests = [];
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
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
  };
  const fetch = async (url, options) => { requests.push(options.headers.Authorization); if (offline) throw new Error('offline'); return { ok: status === 200, status, json: async () => response }; };
  vm.runInNewContext(fs.readFileSync(`${SITE_ROOT}/shared/require-student.js`, 'utf8'), { window, document, sessionStorage, URL, Date, AbortController, fetch });
  await new Promise((resolve) => setImmediate(resolve));
  return { window, document, replaced, requests, storage, async restore() { listeners.pageshow.forEach((fn) => fn({ persisted: true })); await new Promise((resolve) => setImmediate(resolve)); } };
}
for (const [label, storage] of [['未登入', {}], ['缺角色', { ...student, user_role: '' }], ['缺 token', { ...student, token: '' }], ['老師', { ...student, user_role: 'teacher' }], ['缺模式', { ...student, game_mode: '' }]]) {
  test(`${label}拒絕啟動`, async () => { const result = await guard({ storage }); assert.equal(result.document.documentElement.inert, true); assert.match(result.replaced[0], /Home\/index.html/); assert.equal(result.requests.length, 0); });
}
test('真正學生驗證成功才解鎖', async () => { const result = await guard(); assert.equal(result.window.WebGameAuth.active, true); assert.deepEqual(result.requests, ['Bearer t1']); assert.equal(result.document.documentElement.inert, false); });
test('雙人缺搭檔 token 拒絕啟動', async () => { const result = await guard({ mode: 'double', storage: { ...student, game_mode: 'double', student1_token: 't1' } }); assert.match(result.replaced[0], /Home/); });
test('後端角色不符清除本機登入', async () => { const result = await guard({ response: { ...body, role: 'teacher' } }); assert.equal(Object.keys(result.storage).length, 0); });
test('學生欄位必須吻合後端身分', async () => { const result = await guard({ storage: { ...student, school: 'OTHER' } }); assert.match(result.replaced[0], /auth=expired/); });
test('撤銷 token 清除本機登入', async () => { const result = await guard({ status: 401 }); assert.deepEqual(result.storage, {}); });
test('斷線保留登入並提示重試', async () => { const result = await guard({ offline: true }); assert.match(result.replaced[0], /auth=retry/); assert.equal(result.storage.token, 't1'); });
test('進錯模式回 Select', async () => { const result = await guard({ mode: 'double' }); assert.match(result.replaced[0], /Select\/index.html$/); });
test('bfcache 已登出不恢復遊戲', async () => { const result = await guard(); Object.keys(result.storage).forEach((key) => delete result.storage[key]); await result.restore(); assert.match(result.replaced[0], /Home/); assert.equal(result.document.documentElement.inert, true); });
test('bfcache 仍登入再次驗證', async () => { const result = await guard(); await result.restore(); assert.equal(result.requests.length, 2); assert.equal(result.window.WebGameAuth.active, true); });
test('sessionStorage 不可用時仍回 Home', async () => { const result = await guard({ storageThrows: true }); assert.match(result.replaced[0], /Home/); });
