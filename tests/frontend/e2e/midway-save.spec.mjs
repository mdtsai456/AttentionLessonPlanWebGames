// 到中場就先送第 3 關成績：之後直接關掉頁面，前三關也已經在後端。
// 同一局的第 3 關與第 6 關共用 submissionId，後端用較高關卡更新同一列。
// 中場那次送失敗時，第 4、5 關按離開會用同一筆重送。
// 漂浮泡泡（EFT）單人與指令出擊（IM）；其他遊戲見各自的測試。
import { test, expect } from '@playwright/test';
import { STUDENT, loginAs, recordWrites } from './helpers.mjs';

const ASSET_HOST = 'https://attention-lesson-plan-assets.zeabur.app/**';
const STAGE_RUN_MS = 65_000;
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const leaveDialog = (page) => page.getByRole('dialog', { name: '確定要離開嗎？' });
const sessionsOf = (writes) => writes.filter((request) => /\/api\/sessions$/.test(request.url));
const stat = (body, name) => body.data.stats.find((item) => item.apiname.endsWith(`_${name}`))?.value;
const stages = (writes) => sessionsOf(writes).map((request) => stat(request.body, 'stage'));

// 成績送出：第一次回 500（中場那筆，自己記到 writes），之後交給 recordWrites 照常回應。
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
// 漂浮泡泡單人
// ---------------------------------------------------------------------------

async function openEft(page, { failMidway = false } = {}) {
  const writes = await recordWrites(page);
  if (failMidway) await failFirstSave(page, writes);
  await page.route(ASSET_HOST, (route) => route.fulfill({ status: 404, body: '' }));
  await loginAs(page, STUDENT);
  await page.clock.install();
  await page.goto('EFT_single/EFT_single.html');
  await expect(page.locator('#bubble-field .bubble')).toHaveCount(3);
  return writes;
}

async function eftToMidway(page) {
  for (let stage = 1; stage <= 3; stage++) {
    await page.clock.runFor(STAGE_RUN_MS);
    if (stage < 3) await page.click('.shared-stage-clear-btn');
  }
  await expect(page.locator('#mid-break-modal')).toBeVisible();
}

test('EFT 單人：一進中場就送出第 3 關，不用按任何按鈕；關掉頁面也不會再少', async ({ page }) => {
  const writes = await openEft(page);
  await eftToMidway(page);
  await expect.poll(() => stages(writes)).toEqual([3]);
  const midway = sessionsOf(writes)[0].body;
  expect(midway.data.submissionId).toMatch(V4);
  expect(stat(midway, 'levelAccuracy')).toBe('0,0,0');
  expect(stat(midway, 'questionCount')).toBe(15);
  await page.close();
  expect(stages(writes)).toEqual([3]);
});

test('EFT 單人：繼續玩完六關，第 6 關沿用中場的 submissionId', async ({ page }) => {
  const writes = await openEft(page);
  await eftToMidway(page);
  await page.click('#btn-continue');
  for (let stage = 4; stage <= 6; stage++) {
    await page.clock.runFor(STAGE_RUN_MS);
    if (stage < 6) await page.click('.shared-stage-clear-btn');
  }
  await expect(page.locator('#results')).toBeVisible();
  await expect.poll(() => stages(writes)).toEqual([3, 6]);
  const [midway, final] = sessionsOf(writes).map((request) => request.body);
  expect(final.data.submissionId).toBe(midway.data.submissionId);
  expect(stat(final, 'questionCount')).toBe(30);
});

test('EFT 單人：中場那次送失敗，第 4 關離開時用同一筆重送', async ({ page }) => {
  const writes = await openEft(page, { failMidway: true });
  await eftToMidway(page);
  await expect.poll(() => stages(writes)).toEqual([3]);
  const failed = sessionsOf(writes)[0].body;
  await page.click('#btn-continue');
  await page.clock.runFor(20_000);
  await page.click('#leave-btn');
  await leaveDialog(page).getByRole('button', { name: '離開', exact: true }).click();
  await page.waitForURL('**/Select/index.html');
  expect(stages(writes)).toEqual([3, 3]);
  const resent = sessionsOf(writes)[1].body;
  expect(resent.data.submissionId).toBe(failed.data.submissionId);
  // 重送的仍是前三關的成績，不含第 4 關的 20 秒。
  expect(stat(resent, 'questionCount')).toBe(stat(failed, 'questionCount'));
  expect(stat(resent, 'levelAccuracy')).toBe('0,0,0');
});

test('EFT 單人：再玩一次是新的一局，換新的 submissionId', async ({ page }) => {
  const writes = await openEft(page);
  await eftToMidway(page);
  await page.click('#btn-continue');
  for (let stage = 4; stage <= 6; stage++) {
    await page.clock.runFor(STAGE_RUN_MS);
    if (stage < 6) await page.click('.shared-stage-clear-btn');
  }
  await expect(page.locator('#results')).toBeVisible();
  await expect.poll(() => stages(writes)).toEqual([3, 6]);
  await page.click('#restart');
  await eftToMidway(page);
  await expect.poll(() => stages(writes)).toEqual([3, 6, 3]);
  const ids = sessionsOf(writes).map((request) => request.body.data.submissionId);
  expect(ids[2]).not.toBe(ids[0]);
});

// ---------------------------------------------------------------------------
// 指令出擊
// ---------------------------------------------------------------------------

async function beginImStage(page) {
  await page.locator('#start-stage-btn').click();
  await page.waitForFunction(() => state.stageLive && !state.busy);
}

async function openIm(page, { failMidway = false } = {}) {
  const writes = await recordWrites(page);
  if (failMidway) await failFirstSave(page, writes);
  await loginAs(page, STUDENT);
  await page.goto('IM_single/index.html');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.task && state.rooms.length);
  return writes;
}

async function imToMidway(page) {
  for (let stage = 1; stage <= 3; stage++) {
    await expect(page.locator('#problem-title')).toHaveText(`第 ${stage} 關`);
    await beginImStage(page);
    await page.evaluate(() => passStage());
    if (stage < 3) await page.locator('.shared-stage-clear-btn').click();
  }
  await expect(page.locator('#midway-panel')).toBeVisible();
}

test('IM：一進中場就送出第 3 關，不用按任何按鈕', async ({ page }) => {
  const writes = await openIm(page);
  await imToMidway(page);
  await expect.poll(() => stages(writes)).toEqual([3]);
  const midway = sessionsOf(writes)[0].body;
  expect(midway.data.submissionId).toMatch(V4);
  expect(stat(midway, 'levelAccuracy')).toBe('1,1,1');
  await page.close();
  expect(stages(writes)).toEqual([3]);
});

test('IM：中場那次送失敗，第 4 關離開時用同一筆重送', async ({ page }) => {
  const writes = await openIm(page, { failMidway: true });
  await imToMidway(page);
  await expect.poll(() => stages(writes)).toEqual([3]);
  const failed = sessionsOf(writes)[0].body;
  await page.locator('#continue-btn').click();
  await expect(page.locator('#problem-title')).toHaveText('第 4 關');
  await beginImStage(page);
  await page.locator('#leave-btn').click();
  await leaveDialog(page).getByRole('button', { name: '離開', exact: true }).click();
  await page.waitForURL('**/Select/index.html');
  expect(stages(writes)).toEqual([3, 3]);
  const resent = sessionsOf(writes)[1].body;
  expect(resent.data.submissionId).toBe(failed.data.submissionId);
  expect(stat(resent, 'levelAccuracy')).toBe('1,1,1');
});

test('IM：中場已送好，第 4 關離開不重送', async ({ page }) => {
  const writes = await openIm(page);
  await imToMidway(page);
  await expect.poll(() => stages(writes)).toEqual([3]);
  await page.locator('#continue-btn').click();
  await beginImStage(page);
  await page.locator('#leave-btn').click();
  await leaveDialog(page).getByRole('button', { name: '離開', exact: true }).click();
  await page.waitForURL('**/Select/index.html');
  expect(stages(writes)).toEqual([3]);
});
