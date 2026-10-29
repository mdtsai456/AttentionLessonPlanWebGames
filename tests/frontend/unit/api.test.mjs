import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE_ROOT } from '../site.mjs';
const API_BASE = fs.readFileSync(`${SITE_ROOT}/shared/api-base.js`, 'utf8');
function api({ active = true, status = 201, sameAccount = false } = {}) {
  const first = { role: 'student', grade: 'G1', caseId: 'S01', school: 'A' };
  const second = sameAccount ? first : { role: 'student', grade: 'G2', caseId: 'S02', school: 'B' };
  const calls = [];
  let invalidated = false;
  const window = {
    location: { hostname: 'localhost', protocol: 'http:', pathname: '/app/Select/index.html', origin: 'http://localhost:5001' },
    WebGameAuth: { active, session: { mode: 'double', bodies: [first, second], tokens: ['one', 'two'] }, invalidate() { invalidated = true; } },
  };
  vm.runInNewContext(API_BASE, { window });
  vm.runInNewContext(fs.readFileSync(`${SITE_ROOT}/shared/api.js`, 'utf8'), { window, fetch: async (url, opts) => { calls.push({ url, ...opts }); return { status }; } });
  return { instance: window.WebGameApi, calls, first, second, invalidated: () => invalidated };
}
test('雙人每筆帶自己的 Authorization 和搭檔 header，跨校可送', async () => {
  const { instance, calls, first, second } = api();
  await instance.submitSession({ data: { ...first, mode: 'double' } }, { player: 1 });
  await instance.submitSession({ data: { ...second, mode: 'double' } }, { player: 2 });
  assert.equal(calls[0].headers.Authorization, 'Bearer one');
  assert.equal(calls[0].headers['X-Partner-Authorization'], 'Bearer two');
  assert.equal(calls[1].headers.Authorization, 'Bearer two');
  assert.equal(calls[1].headers['X-Partner-Authorization'], 'Bearer one');
  assert.equal(calls[0].url, 'http://localhost:5001/api/sessions');
  assert.equal(JSON.stringify(JSON.parse(calls[0].body)).includes('token'), false);
});
test('同帳號雙人仍使用指定玩家 token', async () => {
  const { instance, calls, second } = api({ sameAccount: true });
  await instance.submitSession({ data: { ...second, mode: 'double' } }, { player: 2 });
  assert.equal(calls[0].headers.Authorization, 'Bearer two');
});
for (const [label, options, data] of [['等待驗證', { active: false }, {}], ['他人成績', {}, { grade: 'X', caseId: 'X', school: 'X' }]]) {
  test(`${label}不送出`, async () => { const { instance, calls } = api(options); await assert.rejects(instance.submitSession({ data })); assert.equal(calls.length, 0); });
}
test('401 清除登入，403 保留登入供核對身分', async () => {
  for (const status of [401, 403]) {
    const run = api({ status });
    await run.instance.submitSession({ data: run.first });
    assert.equal(run.invalidated(), status === 401);
  }
});

test('損壞的待送成績無法選到學生，也不會送出', async () => {
  const { instance, calls } = api();
  for (const payload of [null, {}, { data: null }, []]) {
    assert.equal(instance.sessionPlayer(payload), -1);
    await assert.rejects(instance.submitSession(payload), { status: 401 });
  }
  assert.equal(calls.length, 0);
});

test('uuid() 產生 UUID v4；沒有 randomUUID（非 https 區網）時改用 getRandomValues，不用 Math.random', () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const withRandomUUID = { location: {} };
  vm.runInNewContext(fs.readFileSync(`${SITE_ROOT}/shared/api.js`, 'utf8'), { window: withRandomUUID, crypto: globalThis.crypto });
  assert.match(withRandomUUID.WebGameApi.uuid(), V4);

  const insecure = { location: {} };
  const getRandomValues = (bytes) => globalThis.crypto.getRandomValues(bytes);
  const math = Object.create(Math);
  math.random = () => { throw new Error('不可使用 Math.random'); };
  vm.runInNewContext(fs.readFileSync(`${SITE_ROOT}/shared/api.js`, 'utf8'), { window: insecure, crypto: { getRandomValues }, Math: math });
  const ids = new Set(Array.from({ length: 50 }, () => insecure.WebGameApi.uuid()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, V4);
});
