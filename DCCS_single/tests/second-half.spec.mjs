// 當天已完成前半（後端有今天的 stage 3）：下次進遊戲從第 4 關開始，涵蓋單人與雙人。
// 學生報表（/api/students/{key}/report）由測試模擬；成績 POST 一律攔截，不會打到真的後端。
// 預設使用 ?sessionSeconds=60（每關 10 秒），後半那一局約 30 秒遊戲時間。

import { test, expect } from '@playwright/test';
import {
  LEVEL_SECONDS,
  LEVEL_TIMEOUT,
  QUERY,
  answerLeave,
  drive,
  pendingResults,
  recordNativeDialogs,
  setup,
  stat,
  trackStates,
  watchTracks,
} from './helpers.mjs';

// helpers.mjs 的假登入：課次 1、學生 key 與 token 一一對應。
const STUDENT_KEYS = { 1: 'G1_T01', 2: 'G1_T02' };
const TOKENS = { G1_T01: 'token-1', G1_T02: 'token-2' };
const FIRST_HALF_SUBMISSION_ID = 'first-half-submission';

/** 今天（課次 1）只完成前半的 stage 3 紀錄。 */
function firstHalf(mode, overrides = {}) {
  return {
    gameType: 'DCCS',
    mode,
    currentDay: 1,
    submissionId: FIRST_HALF_SUBMISSION_ID,
    ...overrides,
    stats: { stage: 3, ...(overrides.stats || {}) },
  };
}

/**
 * 設定 student{n}_key 並模擬報表。recordsBySlot 是 { slot: records }。
 * 只回該生自己的報表（token 不對就 403），回傳收到的報表請求。
 * 要在 setup() 之後呼叫，sessionStorage 才會在它的設定之後補上 key。
 */
async function mockReport(page, recordsBySlot) {
  const requests = [];
  await page.addInitScript((keys) => {
    for (const [slot, key] of Object.entries(keys)) {
      window.sessionStorage.setItem(`student${slot}_key`, key);
    }
  }, Object.fromEntries(Object.keys(recordsBySlot).map((slot) => [slot, STUDENT_KEYS[slot]])));

  await page.route('**/api/students/*/report*', async (route) => {
    const url = new URL(route.request().url());
    const key = decodeURIComponent(url.pathname.split('/').at(-2));
    const token = (route.request().headers().authorization || '').replace(/^Bearer /, '');
    requests.push({ key, token, school: url.searchParams.get('school') });
    const slot = Object.keys(STUDENT_KEYS).find((n) => STUDENT_KEYS[n] === key);
    if (!slot || TOKENS[key] !== token || !recordsBySlot[slot]) {
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ students: [], sessions: [], records: recordsBySlot[slot] }),
    });
  });
  return requests;
}

/** 單人版畫面上的關卡提示文字。 */
function singleLevelMessage(page) {
  return page.locator('.dccs-overlay-level:not(.dccs-overlay-break) .dccs-level-message:visible');
}

/** 後半那一局的成績：stage 6、只含第 4～6 關、題數只算後半。 */
function expectSecondHalfPayload(payload) {
  expect(stat(payload, 'stage')).toBe(6);
  expect(stat(payload, 'levelsPlayed')).toBe('4,5,6');
  const levelAccuracy = String(stat(payload, 'levelAccuracy')).split(',');
  expect(levelAccuracy).toHaveLength(3);
  for (const value of levelAccuracy) {
    expect(Number(value)).toBeGreaterThanOrEqual(0);
    expect(Number(value)).toBeLessThanOrEqual(1);
  }
  expect(stat(payload, 'questionCount')).toBe(stat(payload, 'correct') + stat(payload, 'wrong'));
  expect(stat(payload, 'questionCount')).toBeGreaterThan(0);
  // 新的一列：不沿用前半那一筆的 submissionId。
  expect(payload.data.submissionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(payload.data.submissionId).not.toBe(FIRST_HALF_SUBMISSION_ID);
  // duration 只算後半：賽道 3 關的時間加上提示與過關畫面，遠少於整場 6 關。
  const duration = stat(payload, 'duration');
  expect(duration).toBeGreaterThan(3 * LEVEL_SECONDS * 1000);
  expect(duration).toBeLessThan(6 * LEVEL_SECONDS * 1000);
  expect(Math.abs(payload.data.endTime - payload.data.startTime - duration)).toBeLessThan(1000);
}

test.describe('單人版 當天已完成前半：從第 4 關開始', () => {
  test('一進場就是第 4 關、沒有中場；打完只送一筆 stage 6，只含第 4～6 關', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single');
    const reports = await mockReport(page, { 1: [firstHalf('single')] });
    await page.goto(`/DCCS_single/index.html${QUERY}`);

    await expect(singleLevelMessage(page)).toHaveText('準備開始第 4 關！', { timeout: 30_000 });
    // 選遊戲頁之後也會讀報表，所以在這裡就先核對。
    expect(reports).toEqual([{ key: 'G1_T01', token: 'token-1', school: 'TEST' }]);
    await page.locator('.dccs-level-continue:not([data-break])').click();
    await watchTracks(page, 'single');
    // 賽道時間從第 3 關結束接著算，進度條從一半開始。
    const [state] = await trackStates(page);
    expect(state.level).toBe(4);
    expect(state.elapsed).toBeGreaterThanOrEqual(3 * LEVEL_SECONDS);
    expect(state.elapsed).toBeLessThan(3 * LEVEL_SECONDS + 5);

    // drive 遇到中場休息畫面會丟錯。
    await drive(page, 'single', 'session-end', 3 * LEVEL_TIMEOUT + 15_000);
    await page.waitForURL(/\/Select\/index\.html/);

    expect(posts).toHaveLength(1);
    expectSecondHalfPayload(posts[0]);
    expect(posts[0].data.mode).toBe('single');
    expect(pageErrors).toEqual([]);
  });

  test('第 4 關離開：什麼都不送，直接回大廳', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single');
    await mockReport(page, { 1: [firstHalf('single')] });
    await page.goto(`/DCCS_single/index.html${QUERY}`);
    await expect(singleLevelMessage(page)).toHaveText('準備開始第 4 關！', { timeout: 30_000 });
    await page.locator('.dccs-level-continue:not([data-break])').click();
    await page.waitForTimeout(1000);
    const dialogs = recordNativeDialogs(page);

    await page.locator('#leave-btn').click();
    await answerLeave(page, 'leave');
    await page.waitForURL(/\/Select\/index\.html/);

    expect(posts).toHaveLength(0);
    expect(await pendingResults(page)).toEqual([]);
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('第 5 關離開：不送 stage 3（前半那一列已在後端），什麼都不送', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single');
    await mockReport(page, { 1: [firstHalf('single')] });
    await page.goto(`/DCCS_single/index.html${QUERY}`);
    await drive(page, 'single', 'level4-clear', 2 * LEVEL_TIMEOUT);
    await page.locator('.shared-stage-clear-btn').click();
    await watchTracks(page, 'single');
    await expect.poll(async () => (await trackStates(page))[0].level).toBe(5);
    const dialogs = recordNativeDialogs(page);

    await page.locator('#leave-btn').click();
    await answerLeave(page, 'leave');
    await page.waitForURL(/\/Select\/index\.html/);

    expect(posts).toHaveLength(0);
    expect(await pendingResults(page)).toEqual([]);
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('打完第 6 關、成績送出中確定離開：等送完才回大廳，只有一筆 stage 6', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single', { delayMs: 3000 });
    await mockReport(page, { 1: [firstHalf('single')] });
    await page.goto(`/DCCS_single/index.html${QUERY}`);
    await drive(page, 'single', 'result', 4 * LEVEL_TIMEOUT);
    await expect.poll(() => posts.length).toBe(1);
    await expect(page.locator('[data-result="lobby"]')).toBeDisabled();
    const dialogs = recordNativeDialogs(page);

    await page.locator('#leave-btn').click();
    await answerLeave(page, 'leave');
    // 送出中不能導頁。
    await page.waitForTimeout(1000);
    expect(new URL(page.url()).pathname).toBe('/DCCS_single/index.html');
    await expect(page).toHaveURL(/\/Select\/index\.html/, { timeout: 15_000 });

    expect(posts).toHaveLength(1);
    expectSecondHalfPayload(posts[0]);
    expect(await pendingResults(page)).toEqual([]);
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  for (const [name, records] of [
    ['報表沒有紀錄', []],
    ['今天已有 stage 6（已經 100%）', [firstHalf('single'), firstHalf('single', { stats: { stage: 6 } })]],
    ['只有雙人模式的前半', [firstHalf('double')]],
    ['只有別的課次的前半', [firstHalf('single', { currentDay: 2 })]],
    ['只有別的遊戲的前半', [firstHalf('single', { gameType: 'DAT' })]],
  ]) {
    test(`${name}：照舊從第 1 關開始`, async ({ page }) => {
      const { pageErrors } = await setup(page, 'single');
      const reports = await mockReport(page, { 1: records });
      await page.goto(`/DCCS_single/index.html${QUERY}`);
      await expect(singleLevelMessage(page)).toHaveText('準備開始第 1 關！', { timeout: 30_000 });
      expect(reports).toHaveLength(1);
      expect(pageErrors).toEqual([]);
    });
  }
});

test.describe('雙人版 當天已完成前半：兩人都符合才從第 4 關開始', () => {
  test('兩人都只完成前半：第 4 關開始、沒有中場；打完各送一筆 stage 6，同一個新的 pairId', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double');
    const reports = await mockReport(page, { 1: [firstHalf('double')], 2: [firstHalf('double')] });
    await page.goto(`/DCCS_double/index.html${QUERY}`);

    await expect(page.locator('#shared-level-message')).toHaveText('準備開始第 4 關！', { timeout: 30_000 });
    // 第 2 位用自己的 token 讀自己的報表。選遊戲頁之後也會讀報表，所以在這裡就先核對。
    expect(reports.map(({ key, token }) => `${key}:${token}`).sort())
      .toEqual(['G1_T01:token-1', 'G1_T02:token-2']);
    await page.locator('#shared-continue').click();
    await watchTracks(page, 'double');
    for (const state of await trackStates(page)) {
      expect(state.level).toBe(4);
      expect(state.elapsed).toBeGreaterThanOrEqual(3 * LEVEL_SECONDS);
    }

    await drive(page, 'double', 'session-end', 3 * LEVEL_TIMEOUT + 15_000);
    await page.waitForURL(/\/Select\/index\.html/);

    expect(posts).toHaveLength(2);
    expect(posts.map((payload) => payload.data.caseId).sort()).toEqual(['T01', 'T02']);
    for (const payload of posts) {
      expectSecondHalfPayload(payload);
      expect(payload.data.mode).toBe('double');
    }
    expect(new Set(posts.map((payload) => payload.data.pairId)).size).toBe(1);
    expect(posts[0].data.submissionId).not.toBe(posts[1].data.submissionId);
    expect(pageErrors).toEqual([]);
  });

  test('只有一人完成前半：從第 1 關開始', async ({ page }) => {
    const { pageErrors } = await setup(page, 'double');
    await mockReport(page, { 1: [firstHalf('double')], 2: [firstHalf('single')] });
    await page.goto(`/DCCS_double/index.html${QUERY}`);
    await expect(page.locator('#shared-level-message')).toHaveText('準備開始第 1 關！', { timeout: 30_000 });
    expect(pageErrors).toEqual([]);
  });

  test('第 5 關離開：兩位都不送 stage 3，什麼都不送', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double');
    await mockReport(page, { 1: [firstHalf('double')], 2: [firstHalf('double')] });
    await page.goto(`/DCCS_double/index.html${QUERY}`);
    await drive(page, 'double', 'level4-clear', 2 * LEVEL_TIMEOUT);
    await page.locator('.shared-stage-clear-btn').click();
    await watchTracks(page, 'double');
    await expect.poll(async () => (await trackStates(page)).map((state) => state.level)).toEqual([5, 5]);
    const dialogs = recordNativeDialogs(page);

    await page.locator('#leave-btn').click();
    await answerLeave(page, 'leave');
    await page.waitForURL(/\/Select\/index\.html/);

    expect(posts).toHaveLength(0);
    expect(await pendingResults(page)).toEqual([]);
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
