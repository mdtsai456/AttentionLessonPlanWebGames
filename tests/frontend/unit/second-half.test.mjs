import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE_ROOT } from '../site.mjs';

const SINGLE = {
  student1_token: 'one', student1_key: 'G9_S99', student1_school: 'TEST', student1_day: '3',
};
const DOUBLE = {
  ...SINGLE, student2_token: 'two', student2_key: 'G8_S88', student2_school: 'TEST', student2_day: '3',
};

const firstHalf = (overrides = {}) => ({
  gameType: 'EFT', mode: 'single', currentDay: 3, stats: { stage: 3 }, ...overrides,
});

/**
 * 載入 api.js 與 second-half.js。reports[studentKey] 是 /report 的回應：
 * 陣列當成 records；物件可指定 { status }、{ body }（原樣字串）或 { hang: true }（永遠不回）。
 * timers 收集注入的 nativeSetTimeout，測試自己決定何時觸發逾時。
 */
function load({ storage = SINGLE, reports = {}, runtime = true } = {}) {
  const calls = [];
  const timers = [];
  const store = new Map(Object.entries(storage));
  const window = {
    location: { hostname: 'localhost', protocol: 'http:', pathname: '/app/EFT_single/EFT_single.html', origin: 'http://localhost:5001' },
  };
  if (runtime) window.WebGameRuntime = { nativeSetTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; } };
  const fetch = async (url, opts) => {
    calls.push({ url, headers: opts && opts.headers });
    const key = decodeURIComponent(new URL(url).pathname.split('/')[3]);
    const report = reports[key] ?? [];
    if (report instanceof Error) throw report;
    if (report.hang) return new Promise(() => {});
    const status = report.status ?? 200;
    const body = report.body ?? JSON.stringify(Array.isArray(report) ? { records: report } : {});
    return { status, ok: status >= 200 && status < 300, json: async () => JSON.parse(body) };
  };
  const sessionStorage = { getItem: (key) => (store.has(key) ? store.get(key) : null) };
  const context = vm.createContext({ window, fetch, sessionStorage });
  vm.runInContext(fs.readFileSync(`${SITE_ROOT}/shared/api.js`, 'utf8'), context);
  vm.runInContext(fs.readFileSync(`${SITE_ROOT}/shared/second-half.js`, 'utf8'), context);
  return { SecondHalf: window.WebGameSecondHalf, calls, timers };
}

const single = { mode: 'single', slots: [1] };
const double = { mode: 'double', slots: [1, 2] };

test('當天同模式只有一列 stage 3 → 從第 4 關開始', async () => {
  const { SecondHalf, calls } = load({ reports: { G9_S99: [firstHalf()] } });
  assert.equal(await SecondHalf.startStage('EFT', single), 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:5001/api/students/G9_S99/report?school=TEST');
  assert.equal(calls[0].headers.Authorization, 'Bearer one');
});

test('前半玩了兩次也算只完成前半', async () => {
  const { SecondHalf } = load({ reports: { G9_S99: [firstHalf(), firstHalf()] } });
  assert.equal(await SecondHalf.startStage('EFT', single), 4);
});

test('當天已有 stage 4 以上（含 100%）→ 從第 1 關開始', async () => {
  for (const stage of [4, 5, 6]) {
    const { SecondHalf } = load({ reports: { G9_S99: [firstHalf(), firstHalf({ stats: { stage } })] } });
    assert.equal(await SecondHalf.startStage('EFT', single), 1, `stage ${stage}`);
  }
});

test('沒有 stage 的紀錄和選遊戲頁一樣當成已完成 → 從第 1 關開始', async () => {
  const { SecondHalf } = load({ reports: { G9_S99: [firstHalf(), firstHalf({ stats: {} })] } });
  assert.equal(await SecondHalf.startStage('EFT', single), 1);
});

test('只有 stage 1、2 → 從第 1 關開始', async () => {
  const { SecondHalf } = load({ reports: { G9_S99: [firstHalf({ stats: { stage: 2 } })] } });
  assert.equal(await SecondHalf.startStage('EFT', single), 1);
});

test('只有別的課次、別的模式、別的遊戲的 stage 3 → 從第 1 關開始', async () => {
  for (const other of [{ currentDay: 2 }, { mode: 'double' }, { gameType: 'DAT' }]) {
    const { SecondHalf } = load({ reports: { G9_S99: [firstHalf(other)] } });
    assert.equal(await SecondHalf.startStage('EFT', single), 1, JSON.stringify(other));
  }
});

test('IM 的 gameType 是 IM 時也算 InstructionGame', async () => {
  const { SecondHalf } = load({ reports: { G9_S99: [firstHalf({ gameType: 'IM' })] } });
  assert.equal(await SecondHalf.startStage('InstructionGame', single), 4);
});

test('雙人兩位都只完成前半 → 從第 4 關開始，各用自己的 token', async () => {
  const mine = firstHalf({ mode: 'double' });
  const { SecondHalf, calls } = load({ storage: DOUBLE, reports: { G9_S99: [mine], G8_S88: [mine] } });
  assert.equal(await SecondHalf.startStage('EFT', double), 4);
  const auth = Object.fromEntries(calls.map((call) => [new URL(call.url).pathname.split('/')[3], call.headers.Authorization]));
  assert.deepEqual(auth, { G9_S99: 'Bearer one', G8_S88: 'Bearer two' });
});

test('雙人只有一位只完成前半 → 從第 1 關開始', async () => {
  const mine = firstHalf({ mode: 'double' });
  const { SecondHalf } = load({ storage: DOUBLE, reports: { G9_S99: [mine], G8_S88: [] } });
  assert.equal(await SecondHalf.startStage('EFT', double), 1);
});

test('讀取失敗、HTTP 錯誤、JSON 損壞、沒有 records → 從第 1 關開始', async () => {
  for (const report of [new TypeError('Failed to fetch'), { status: 500 }, { status: 401 }, { body: '{' }, { body: '{}' }]) {
    const { SecondHalf } = load({ reports: { G9_S99: report } });
    assert.equal(await SecondHalf.startStage('EFT', single), 1, String(report.status ?? report.body ?? report));
  }
});

test('缺 token、學生代號或學校 → 不讀報表，從第 1 關開始', async () => {
  for (const missing of ['student1_token', 'student1_key', 'student1_school']) {
    const storage = { ...SINGLE };
    delete storage[missing];
    const { SecondHalf, calls } = load({ storage, reports: { G9_S99: [firstHalf()] } });
    assert.equal(await SecondHalf.startStage('EFT', single), 1, missing);
    assert.equal(calls.length, 0, missing);
  }
});

test('單人沒有 student1_* 時改用舊欄位 token、school、current_day', async () => {
  const storage = { token: 'legacy', student1_key: 'G9_S99', school: 'TEST', current_day: '3' };
  const { SecondHalf, calls } = load({ storage, reports: { G9_S99: [firstHalf()] } });
  assert.equal(await SecondHalf.startStage('EFT', single), 4);
  assert.equal(calls[0].headers.Authorization, 'Bearer legacy');
});

test('超過 5 秒沒回應 → 從第 1 關開始，用不受暫停影響的計時器', async () => {
  const { SecondHalf, timers } = load({ reports: { G9_S99: { hang: true } } });
  const result = SecondHalf.startStage('EFT', single);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 5000);
  timers[0].fn();
  assert.equal(await result, 1);
});
