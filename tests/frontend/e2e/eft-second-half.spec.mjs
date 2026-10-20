// 漂浮泡泡：同一個課次已完成前半（第 1～3 關）時，下次進遊戲直接從第 4 關開始，只玩並只送後半。
// 後端這個課次的成績用 mockReport 模擬；用 page.clock 快轉關卡時間，不作答，每關固定 5 題逾時算錯。
import { test, expect } from '@playwright/test';
import { STUDENT, DOUBLE, loginAs, recordWrites, mockReport, firstHalfRecord } from './helpers.mjs';

const ASSET_HOST = 'https://attention-lesson-plan-assets.zeabur.app/**';
// 一關 60 秒，最後一題回饋最晚 60.5 秒結束；多留幾秒確保停在過關畫面。
const STAGE_RUN_MS = 65_000;
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const leaveDialog = (page) => page.getByRole('dialog', { name: '確定要離開嗎？' });
const sessionsOf = (writes) => writes.filter((request) => /\/api\/sessions$/.test(request.url));
const stat = (body, name) => body.data.stats.find((item) => item.apiname === name)?.value;
const stages = (writes) => sessionsOf(writes).map((request) => stat(request.body, 'EFT_stage'));

async function leaveAndConfirm(page) {
  await page.click('#leave-btn');
  await leaveDialog(page).getByRole('button', { name: '離開', exact: true }).click();
  await page.waitForURL('**/Select/index.html');
}

// 成績送出：第一次回 500（自己記到 writes），之後交給 recordWrites 照常回應。
async function failFirstSave(page, writes) {
  let calls = 0;
  await page.route('**/api/sessions', async (route) => {
    calls += 1;
    if (calls === 1) {
      const request = route.request();
      writes.push({ method: request.method(), url: request.url(), body: request.postDataJSON(), headers: request.headers() });
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"測試失敗"}' });
      return;
    }
    await route.fallback();
  });
}

// ---------------------------------------------------------------------------
// 單人
// ---------------------------------------------------------------------------

async function openSingle(page, { records = [firstHalfRecord('EFT')], failFirst = false } = {}) {
  const writes = await recordWrites(page);
  if (failFirst) await failFirstSave(page, writes);
  await mockReport(page, { [STUDENT.student1_key]: records });
  await page.route(ASSET_HOST, (route) => route.fulfill({ status: 404, body: '' }));
  await loginAs(page, STUDENT);
  await page.clock.install();
  await page.goto('EFT_single/EFT_single.html');
  await expect(page.locator('#bubble-field .bubble')).toHaveCount(3);
  return writes;
}

// 從目前這關打到第 lastStage 關結束；最後一關之前的每關都按繼續。
async function playSingle(page, fromStage, lastStage) {
  for (let stage = fromStage; stage <= lastStage; stage++) {
    await page.clock.runFor(STAGE_RUN_MS);
    if (stage < lastStage && stage < 6) await page.click('.shared-stage-clear-btn');
  }
}

test('EFT 單人：只完成前半 → 一進場就是第 4 關，進度條從一半開始，沒有中場畫面', async ({ page }) => {
  await openSingle(page);
  await expect(page.locator('#round')).toContainText('第 4 / 6 關');
  const height = await page.locator('#progress-fill').evaluate((el) => parseFloat(el.style.height));
  expect(height).toBeGreaterThanOrEqual(50);
  expect(height).toBeLessThan(55);
  await expect(page.locator('#mid-break-modal')).toBeHidden();
});

test('EFT 單人：打完第 6 關只送一筆 stage 6，新的 submissionId，成績只含後半', async ({ page }) => {
  const writes = await openSingle(page);
  await playSingle(page, 4, 6);
  await expect(page.locator('#results')).toBeVisible();
  await expect.poll(() => stages(writes)).toEqual([6]);
  const body = sessionsOf(writes)[0].body;
  expect(body.data.submissionId).toMatch(V4);
  expect(body.data.mode).toBe('single');
  expect(stat(body, 'EFT_levelAccuracy')).toBe('0,0,0');
  expect(stat(body, 'EFT_questionCount')).toBe(15);
  expect(stat(body, 'EFT_wrong')).toBe(15);
  expect(stat(body, 'EFT_correct')).toBe(0);
  // 時長只算 3 關，不含前半；endTime − startTime 等於時長。
  expect(stat(body, 'EFT_duration')).toBeLessThan(3 * STAGE_RUN_MS);
  expect(Math.abs(body.data.endTime - body.data.startTime - stat(body, 'EFT_duration'))).toBeLessThan(1000);
  // 打完後離開不重送。
  await leaveAndConfirm(page);
  expect(stages(writes)).toEqual([6]);
});

test('EFT 單人：第 4 關中途離開什麼都不送', async ({ page }) => {
  const writes = await openSingle(page);
  await page.clock.runFor(20_000);
  await leaveAndConfirm(page);
  expect(sessionsOf(writes)).toHaveLength(0);
});

test('EFT 單人：第 5 關中途離開什麼都不送（不會送內容錯誤的 stage 3）', async ({ page }) => {
  const writes = await openSingle(page);
  await playSingle(page, 4, 5);
  await page.click('.shared-stage-clear-btn');
  await page.clock.runFor(20_000);
  await expect(page.locator('#round')).toContainText('第 6 / 6 關');
  await leaveAndConfirm(page);
  expect(sessionsOf(writes)).toHaveLength(0);
});

test('EFT 單人：第 5 關結束的過關畫面離開，同樣什麼都不送', async ({ page }) => {
  const writes = await openSingle(page);
  await playSingle(page, 4, 5);
  await expect(page.locator('.shared-stage-clear')).toBeVisible();
  await page.evaluate(() => { void window.EFTSingle.leaveGame(); });
  await leaveDialog(page).getByRole('button', { name: '離開', exact: true }).click();
  await page.waitForURL('**/Select/index.html');
  expect(sessionsOf(writes)).toHaveLength(0);
});

test('EFT 單人：打完第 6 關但 stage 6 送失敗，離開時用同一筆重送', async ({ page }) => {
  const writes = await openSingle(page, { failFirst: true });
  await playSingle(page, 4, 6);
  await expect(page.locator('#results')).toBeVisible();
  await expect.poll(() => stages(writes)).toEqual([6]);
  await leaveAndConfirm(page);
  expect(stages(writes)).toEqual([6, 6]);
  const [failed, resent] = sessionsOf(writes).map((request) => request.body);
  expect(resent.data.submissionId).toBe(failed.data.submissionId);
  expect(stat(resent, 'EFT_levelAccuracy')).toBe('0,0,0');
  expect(stat(resent, 'EFT_questionCount')).toBe(15);
});

test('EFT 單人：報表沒有紀錄 → 照舊從第 1 關開始，打到中場送第 3 關', async ({ page }) => {
  const writes = await openSingle(page, { records: [] });
  await expect(page.locator('#round')).toContainText('第 1 / 6 關');
  await playSingle(page, 1, 3);
  await expect(page.locator('#mid-break-modal')).toBeVisible();
  await expect.poll(() => stages(writes)).toEqual([3]);
});

test('EFT 單人：這個課次已經有 stage 6 → 照舊從第 1 關開始', async ({ page }) => {
  await openSingle(page, { records: [firstHalfRecord('EFT'), firstHalfRecord('EFT', { stats: { stage: 6 } })] });
  await expect(page.locator('#round')).toContainText('第 1 / 6 關');
});

test('EFT 單人：前半是雙人玩的 → 單人從第 1 關開始', async ({ page }) => {
  await openSingle(page, { records: [firstHalfRecord('EFT', { mode: 'double' })] });
  await expect(page.locator('#round')).toContainText('第 1 / 6 關');
});

test('EFT 單人：後半打完按「再玩一次」→ 第 1 關，新的一局照一般規則在中場送第 3 關', async ({ page }) => {
  const writes = await openSingle(page);
  await playSingle(page, 4, 6);
  await expect(page.locator('#results')).toBeVisible();
  await expect.poll(() => stages(writes)).toEqual([6]);
  await page.click('#restart');
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#round')).toContainText('第 1 / 6 關');
  await playSingle(page, 1, 3);
  await expect(page.locator('#mid-break-modal')).toBeVisible();
  await expect.poll(() => stages(writes)).toEqual([6, 3]);
  const [second, third] = sessionsOf(writes).map((request) => request.body);
  expect(third.data.submissionId).not.toBe(second.data.submissionId);
  expect(stat(third, 'EFT_levelAccuracy')).toBe('0,0,0');
  // 新的一局第 4 關離開，照一般規則不再送（第 3 關已送過）。
  await page.click('#btn-continue');
  await page.clock.runFor(20_000);
  await leaveAndConfirm(page);
  expect(stages(writes)).toEqual([6, 3]);
});

test('EFT 單人：後半打完「再玩一次」後的新一局，第 5 關離開照一般規則（中場已送的第 3 關不重送）', async ({ page }) => {
  const writes = await openSingle(page);
  await playSingle(page, 4, 6);
  await expect(page.locator('#results')).toBeVisible();
  await page.click('#restart');
  await playSingle(page, 1, 3);
  await page.click('#btn-continue');
  await playSingle(page, 4, 4);
  await page.click('.shared-stage-clear-btn');
  await page.clock.runFor(10_000);
  await leaveAndConfirm(page);
  // [6] 是後半，[3] 是新的一局中場送的第 3 關；第 5 關離開沒有多送。
  await expect.poll(() => stages(writes)).toEqual([6, 3]);
});

// ---------------------------------------------------------------------------
// 雙人
// ---------------------------------------------------------------------------

// 第 1 位 G9_S99 課次 3、第 2 位 G8_S88 課次 1。
const FIRST = (opts) => firstHalfRecord('EFT', { mode: 'double', day: 3, ...opts });
const SECOND = (opts) => firstHalfRecord('EFT', { mode: 'double', day: 1, ...opts });

async function openDouble(page, { reports }) {
  const writes = await recordWrites(page);
  await mockReport(page, reports);
  await page.route(ASSET_HOST, (route) => route.fulfill({ status: 404, body: '' }));
  await loginAs(page, DOUBLE);
  await page.clock.install();
  await page.goto('EFT_double/EFT_double.html');
  await expect(page.locator('.player-1 [data-ui="bubble-field"] .bubble')).toHaveCount(3);
  await expect(page.locator('.player-2 [data-ui="bubble-field"] .bubble')).toHaveCount(3);
  return writes;
}

const bothHalf = { G9_S99: [FIRST()], G8_S88: [SECOND()] };
const round = (page, n) => page.locator(`.player-${n} [data-ui="round"]`);

async function playDouble(page, fromStage, lastStage) {
  for (let stage = fromStage; stage <= lastStage; stage++) {
    await page.clock.runFor(STAGE_RUN_MS);
    if (stage === 6) {
      await expect(page.locator('.player-1 [data-ui="results"]')).toBeVisible();
      await expect(page.locator('.player-2 [data-ui="results"]')).toBeVisible();
    } else {
      await expect(page.locator('.shared-stage-clear')).toBeVisible();
      if (stage < lastStage) await page.click('.shared-stage-clear-btn');
    }
  }
}

test('EFT 雙人：兩位都只完成前半 → 兩人都從第 4 關開始，沒有中場畫面', async ({ page }) => {
  await openDouble(page, { reports: bothHalf });
  await expect(round(page, 1)).toContainText('第 4 / 6 關');
  await expect(round(page, 2)).toContainText('第 4 / 6 關');
  await expect(page.locator('#mid-break')).toBeHidden();
});

test('EFT 雙人：打完第 6 關兩人各送一筆 stage 6，新的 submissionId 與 pairId，成績只含後半', async ({ page }) => {
  const writes = await openDouble(page, { reports: bothHalf });
  await playDouble(page, 4, 6);
  await expect.poll(() => sessionsOf(writes).length).toBe(2);
  const sessions = sessionsOf(writes).map((request) => request.body);
  expect(sessions.map((body) => stat(body, 'EFT_stage'))).toEqual([6, 6]);
  expect(sessions.map((body) => body.data.caseId).sort()).toEqual(['S88', 'S99']);
  expect(sessions[0].data.pairId).toMatch(V4);
  expect(sessions[0].data.pairId).toBe(sessions[1].data.pairId);
  expect(sessions[0].data.submissionId).toMatch(V4);
  expect(sessions[0].data.submissionId).toBe(sessions[1].data.submissionId);
  for (const body of sessions) {
    expect(body.data.mode).toBe('double');
    expect(stat(body, 'EFT_levelAccuracy')).toBe('0,0,0');
    expect(stat(body, 'EFT_questionCount')).toBe(15);
    expect(stat(body, 'EFT_duration')).toBeLessThan(3 * STAGE_RUN_MS);
  }
  // 打完後離開不重送。
  await leaveAndConfirm(page);
  expect(sessionsOf(writes)).toHaveLength(2);
});

test('EFT 雙人：只有一位完成前半 → 兩人都從第 1 關開始', async ({ page }) => {
  await openDouble(page, { reports: { G9_S99: [FIRST()], G8_S88: [] } });
  await expect(round(page, 1)).toContainText('第 1 / 6 關');
  await expect(round(page, 2)).toContainText('第 1 / 6 關');
});

test('EFT 雙人：第 2 位這個課次已經有 stage 6 → 兩人都從第 1 關開始', async ({ page }) => {
  await openDouble(page, { reports: { G9_S99: [FIRST()], G8_S88: [SECOND(), SECOND({ stats: { stage: 6 } })] } });
  await expect(round(page, 1)).toContainText('第 1 / 6 關');
  await expect(round(page, 2)).toContainText('第 1 / 6 關');
});

test('EFT 雙人：第 4 關中途離開什麼都不送', async ({ page }) => {
  const writes = await openDouble(page, { reports: bothHalf });
  await page.clock.runFor(20_000);
  await leaveAndConfirm(page);
  expect(sessionsOf(writes)).toHaveLength(0);
});

test('EFT 雙人：第 5 關中途離開什麼都不送', async ({ page }) => {
  const writes = await openDouble(page, { reports: bothHalf });
  await playDouble(page, 4, 5);
  await page.click('.shared-stage-clear-btn');
  await page.clock.runFor(20_000);
  await expect(round(page, 1)).toContainText('第 6 / 6 關');
  await leaveAndConfirm(page);
  expect(sessionsOf(writes)).toHaveLength(0);
});

test('EFT 雙人：後半打完按「再玩一次」→ 兩人第 1 關，換新的 pairId 與 submissionId', async ({ page }) => {
  const writes = await openDouble(page, { reports: bothHalf });
  await playDouble(page, 4, 6);
  await expect.poll(() => sessionsOf(writes).length).toBe(2);
  const first = sessionsOf(writes)[0].body.data;
  await page.click('.player-1 [data-ui="restart"]');
  await expect(page.locator('.player-1 [data-ui="results"]')).toBeHidden();
  await expect(round(page, 1)).toContainText('第 1 / 6 關');
  await expect(round(page, 2)).toContainText('第 1 / 6 關');
  await page.clock.runFor(STAGE_RUN_MS);
  await page.click('.shared-stage-clear-btn');
  await page.clock.runFor(STAGE_RUN_MS);
  await page.click('.shared-stage-clear-btn');
  await page.clock.runFor(STAGE_RUN_MS);
  await expect(page.locator('#mid-break')).toBeVisible();
  await expect.poll(() => sessionsOf(writes).length).toBe(4);
  const second = sessionsOf(writes).slice(2).map((request) => request.body);
  expect(second.map((body) => stat(body, 'EFT_stage'))).toEqual([3, 3]);
  expect(second[0].data.pairId).not.toBe(first.pairId);
  expect(second[0].data.submissionId).not.toBe(first.submissionId);
});
