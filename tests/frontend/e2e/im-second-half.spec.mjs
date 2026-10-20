// 指令出擊（IM）後半：今天只完成前 3 關時，下次進遊戲從第 4 關開始。
// 看後端當天的成績（/report）決定；第 4、5 關離開什麼都不送，打完第 6 關只送一筆 stage 6。
import { test, expect } from '@playwright/test';
import { STUDENT, loginAs, recordWrites, mockReport, firstHalfRecord } from './helpers.mjs';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const leaveDialog = (page) => page.getByRole('dialog', { name: '確定要離開嗎？' });
const sessionsOf = (writes) => writes.filter((request) => /\/api\/sessions$/.test(request.url));
const stat = (body, name) => body.data.stats.find((item) => item.apiname === `IM_${name}`)?.value;
const stages = (writes) => sessionsOf(writes).map((request) => stat(request.body, 'stage'));

/** 開遊戲並等第一關題目卡出現；records 是 /report 回的紀錄（預設空）。 */
async function openIm(page, records = []) {
  const writes = await recordWrites(page);
  await mockReport(page, { [STUDENT.student1_key]: records });
  await loginAs(page, STUDENT);
  await page.goto('IM_single/index.html');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.task && state.rooms.length);
  await expect(page.locator('#problem-panel')).toBeVisible();
  return writes;
}

async function beginStage(page) {
  await page.locator('#start-stage-btn').click();
  await page.waitForFunction(() => state.stageLive && !state.busy);
}

const taskId = (page) => page.evaluate(() => state.task.id);

/** 打完目前這關（過關或逾時），並按掉過關畫面。 */
async function finishStage(page, kind, { clear = true } = {}) {
  await beginStage(page);
  await page.evaluate((how) => (how === 'pass' ? passStage() : timeOut()), kind);
  if (clear) await page.locator('.shared-stage-clear-btn').click();
}

async function confirmLeave(page) {
  await page.locator('#leave-btn').click();
  await leaveDialog(page).getByRole('button', { name: '離開', exact: true }).click();
  await page.waitForURL('**/Select/index.html');
}

test('IM 後半：今天只完成前半，一進場就是第 4 關（P004），沒有中場、不送 stage 3', async ({ page }) => {
  const writes = await openIm(page, [firstHalfRecord('IM')]);
  await expect(page.locator('#problem-title')).toHaveText('第 4 關');
  expect(await taskId(page)).toBe('P004');

  await finishStage(page, 'pass');
  await expect(page.locator('#problem-title')).toHaveText('第 5 關');
  expect(await taskId(page)).toBe('P005');
  await finishStage(page, 'pass');
  await expect(page.locator('#problem-title')).toHaveText('第 6 關');
  expect(await taskId(page)).toBe('P006');
  await finishStage(page, 'pass', { clear: false });

  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#midway-panel')).toBeHidden();
  expect(stages(writes)).toEqual([6]);
});

test('IM 後半：打完第 6 關只送一筆 stage 6，成績只算第 4～6 關，duration 不含 0.7 秒等待', async ({ page }) => {
  const writes = await openIm(page, [firstHalfRecord('IM')]);
  await expect(page.locator('#problem-title')).toHaveText('第 4 關');
  await finishStage(page, 'pass');
  await finishStage(page, 'timeout');
  await finishStage(page, 'pass', { clear: false });
  await expect(page.locator('#result')).toBeVisible();
  await expect.poll(() => sessionsOf(writes).length).toBe(1);

  const body = sessionsOf(writes)[0].body;
  expect(stat(body, 'stage')).toBe(6);
  expect(body.data.submissionId).toMatch(V4);
  expect(stat(body, 'levelAccuracy')).toBe('1,0,1');
  expect(stat(body, 'correct')).toBe(2);
  expect(stat(body, 'wrong')).toBe(1);
  expect(stat(body, 'accuracy')).toBe(0.67);
  const { lastElapsed, avg } = await page.evaluate(() => ({
    lastElapsed: state.stageResults[2].elapsedMs,
    avg: (state.stageResults.reduce((sum, item) => sum + item.timeUsage, 0) / 3) * 1000,
  }));
  expect(stat(body, 'avgReactionMs')).toBeCloseTo(avg, 3);
  // 算到第 6 關結束當下：不含 endStage 的 700 ms 等待。
  expect(stat(body, 'duration')).toBe(lastElapsed);
  expect(body.data.endTime - body.data.startTime).toBe(lastElapsed);
});

for (const leaveAt of [4, 5]) {
  test(`IM 後半：第 ${leaveAt} 關離開什麼都不送`, async ({ page }) => {
    const writes = await openIm(page, [firstHalfRecord('IM')]);
    for (let stage = 4; stage < leaveAt; stage++) await finishStage(page, 'pass');
    await expect(page.locator('#problem-title')).toHaveText(`第 ${leaveAt} 關`);
    await beginStage(page);
    await confirmLeave(page);
    expect(sessionsOf(writes)).toHaveLength(0);
  });
}

test('IM 後半：第 6 關打完的 0.7 秒等待中離開，照舊送 stage 6（只送一筆）', async ({ page }) => {
  const writes = await openIm(page, [firstHalfRecord('IM')]);
  await finishStage(page, 'pass');
  await finishStage(page, 'pass');
  await beginStage(page);
  await page.evaluate(() => passStage());
  await confirmLeave(page);
  expect(stages(writes)).toEqual([6]);
  const body = sessionsOf(writes)[0].body;
  expect(stat(body, 'levelAccuracy')).toBe('1,1,1');
  expect(stat(body, 'correct')).toBe(3);
});

test('IM 後半：報表是空的，照舊從第 1 關開始，第 3 關後有中場', async ({ page }) => {
  const writes = await openIm(page, []);
  await expect(page.locator('#problem-title')).toHaveText('第 1 關');
  expect(await taskId(page)).toBe('P001');
  await finishStage(page, 'pass');
  await finishStage(page, 'pass');
  await finishStage(page, 'pass', { clear: false });
  await expect(page.locator('#midway-panel')).toBeVisible();
  await expect.poll(() => stages(writes)).toEqual([3]);
});

test('IM 後半：今天已經有 stage 6，從第 1 關開始', async ({ page }) => {
  await openIm(page, [
    firstHalfRecord('IM'),
    firstHalfRecord('IM', { stats: { stage: 6 } }),
  ]);
  await expect(page.locator('#problem-title')).toHaveText('第 1 關');
  expect(await taskId(page)).toBe('P001');
});

test('IM 後半：只有別天的前半，從第 1 關開始', async ({ page }) => {
  await openIm(page, [firstHalfRecord('IM', { day: 2 })]);
  await expect(page.locator('#problem-title')).toHaveText('第 1 關');
  expect(await taskId(page)).toBe('P001');
});

test('IM 後半：結算畫面「再玩一次」是新的一局，從第 1 關開始，第 3 關後有中場', async ({ page }) => {
  const writes = await openIm(page, [firstHalfRecord('IM')]);
  await expect(page.locator('#problem-title')).toHaveText('第 4 關');
  await finishStage(page, 'pass');
  await finishStage(page, 'pass');
  await finishStage(page, 'pass', { clear: false });
  await expect(page.locator('#result')).toBeVisible();
  await expect.poll(() => stages(writes)).toEqual([6]);
  const firstId = sessionsOf(writes)[0].body.data.submissionId;

  await page.locator('#replay-btn').click();
  await expect(page.locator('#problem-title')).toHaveText('第 1 關');
  expect(await taskId(page)).toBe('P001');
  await finishStage(page, 'pass');
  await finishStage(page, 'pass');
  await finishStage(page, 'pass', { clear: false });
  await expect(page.locator('#midway-panel')).toBeVisible();
  await expect.poll(() => stages(writes)).toEqual([6, 3]);
  expect(sessionsOf(writes)[1].body.data.submissionId).not.toBe(firstId);
});
