// 雙人版「離開」按鈕：先在頁面內確認，確定後才送出檢查點並回大廳（第 41 項）。
// 也驗兩側面板的個案編號。成績 POST 一律由測試攔截，不會打到真的後端。

import { test, expect } from '@playwright/test';
import {
  FULL_SESSION_STAGE,
  LEVEL_SECONDS,
  LEVEL_TIMEOUT,
  QUERY,
  answerLeave,
  drive,
  leaveDialog,
  reachBreak,
  recordNativeDialogs,
  pressAllValveKeys,
  setup,
  stat,
  takeQueuedPresses,
  trackStates,
  unloadGuardActive,
  watchTracks,
} from './helpers.mjs';

/** 每位玩家各送了哪些 stage，例如 { T01: [3, 6], T02: [3, 6] }。 */
function stagesByCase(posts) {
  const result = {};
  for (const payload of posts) {
    (result[payload.data.caseId] ||= []).push(stat(payload, 'stage'));
  }
  for (const stages of Object.values(result)) stages.sort((a, b) => a - b);
  return result;
}

async function continueAfterBreak(page) {
  await page.locator('#shared-break-continue').click();
  await expect(page.locator('#shared-overlay')).toBeHidden({ timeout: 2000 });
}

async function doubleClick(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('雙人版 離開：先確認，確定後才存檔', () => {
  test('取消離開不多送、遊戲照常；之後打完全場只多送全場成績', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double', { delayMs: 1000 });
    await reachBreak(page, 'double');
    await continueAfterBreak(page);
    const dialogs = recordNativeDialogs(page);

    const leave = page.locator('#leave-btn');
    await doubleClick(page, leave);
    await expect(leaveDialog(page)).toHaveCount(1);
    await answerLeave(page, 'stay');

    // 取消：只有中場先送的兩筆第 3 關、還在遊戲頁、離開保護還在、按鈕可再按。
    await page.waitForTimeout(1500);
    expect(posts).toHaveLength(2);
    expect(new URL(page.url()).pathname).toBe('/DCCS_double/index.html');
    expect(await unloadGuardActive(page)).toBe(true);
    await expect(leave).toBeEnabled();

    await leave.click();
    await answerLeave(page, 'stay');
    await page.waitForTimeout(1500);
    expect(posts).toHaveLength(2);

    await drive(page, 'double', 'session-end', 3 * LEVEL_TIMEOUT + 15_000);
    await page.waitForURL(/\/Select\/index\.html/);

    expect(stagesByCase(posts)).toEqual({
      T01: [3, FULL_SESSION_STAGE],
      T02: [3, FULL_SESSION_STAGE],
    });
    expect(new Set(posts.map((payload) => payload.data.pairId)).size).toBe(1);
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('確定離開：每位玩家送一次第 3 關檢查點後回大廳，不跳瀏覽器離開詢問', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double', { delayMs: 1500 });
    await reachBreak(page, 'double');
    await continueAfterBreak(page);
    await watchTracks(page, 'double');
    const dialogs = recordNativeDialogs(page);

    const leave = page.locator('#leave-btn');
    await leave.click();
    await answerLeave(page, 'leave');
    // 存檔送出中（確定離開後遊戲維持暫停）：兩側賽道都不前進、不換關、不多送。
    // 確認框已關、遊戲仍暫停：這時按轉動鍵不能轉輪盤、不能記成績，也不能排隊等恢復後補轉。
    const frozen = await trackStates(page);
    await pressAllValveKeys(page);
    await page.waitForTimeout(800);
    expect(await trackStates(page)).toEqual(frozen);
    expect(await takeQueuedPresses(page)).toEqual(frozen.map(() => 0));
    expect(new URL(page.url()).pathname).toBe('/DCCS_double/index.html');
    expect(posts).toHaveLength(2);
    // 存檔中再按離開（按鈕停用，強制點也不能再問一次或重送）。
    await leave.click({ force: true });
    await page.waitForURL(/\/Select\/index\.html/);

    expect(stagesByCase(posts)).toEqual({ T01: [3], T02: [3] });
    expect(new Set(posts.map((payload) => payload.data.pairId)).size).toBe(1);
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('第 1 關就確定離開：不送成績，直接回大廳，不跳瀏覽器離開詢問', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double');
    await page.goto(`/DCCS_double/index.html${QUERY}`);
    await page.locator('#shared-continue').click({ timeout: 30_000 });
    await expect(page.locator('#shared-overlay')).toBeHidden({ timeout: 2000 });
    expect(await unloadGuardActive(page)).toBe(true);
    const dialogs = recordNativeDialogs(page);

    await page.locator('#leave-btn').click();
    await answerLeave(page, 'leave');
    await page.waitForURL(/\/Select\/index\.html/);

    expect(posts).toHaveLength(0);
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('全場成績送出中按離開：不再另送一次，送完照常回大廳', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double', { delayMs: 3000 });
    const dialogs = recordNativeDialogs(page);
    await reachBreak(page, 'double');
    const breakSeenAt = Date.now();

    // DCCS_duration 是遊戲時鐘算的遊玩時間（2026-10-20 起）：沒中斷時和 endTime − startTime
    // 相差在 1 秒內；中場檢查點算到第 3 關結束當下。
    await expect.poll(() => posts.length).toBe(2);
    const midway = posts.slice(0, 2);
    for (const payload of midway) {
      expect(stat(payload, 'stage')).toBe(3);
      expect(Math.abs(payload.data.endTime - breakSeenAt)).toBeLessThan(1000);
      expect(Math.abs(payload.data.endTime - payload.data.startTime - stat(payload, 'duration')))
        .toBeLessThan(1000);
    }
    // 中場休息停留的時間也算遊玩時間。
    await page.waitForTimeout(2000);
    await continueAfterBreak(page);

    // 最終成績一開始送就按離開（按鈕已停用，點擊不會有作用，也不會問要不要離開）。
    const clickLeaveWhileSending = (async () => {
      await expect.poll(
        () => posts.some((payload) => stat(payload, 'stage') === FULL_SESSION_STAGE),
        { timeout: 3 * LEVEL_TIMEOUT }
      ).toBe(true);
      await page.locator('#leave-btn').click({ force: true });
      await page.locator('#leave-btn').click({ force: true });
      expect(await leaveDialog(page).count()).toBe(0);
    })();

    await drive(page, 'double', 'session-end', 3 * LEVEL_TIMEOUT + 15_000);
    await clickLeaveWhileSending;
    await page.waitForURL(/\/Select\/index\.html/);

    expect(stagesByCase(posts)).toEqual({
      T01: [3, FULL_SESSION_STAGE],
      T02: [3, FULL_SESSION_STAGE],
    });
    for (const payload of posts.slice(2)) {
      expect(Math.abs(payload.data.endTime - payload.data.startTime - stat(payload, 'duration')))
        .toBeLessThan(1000);
      // 賽道整場固定 6 關的時間；多出來的是關卡提示與中場休息。
      expect(stat(payload, 'duration')).toBeGreaterThan(6 * LEVEL_SECONDS * 1000 + 2000);
    }
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

test('雙人版遊戲開始後，兩側面板各自顯示該玩家的個案編號', async ({ page }) => {
  const { pageErrors } = await setup(page, 'double');
  await page.goto(`/DCCS_double/index.html${QUERY}`);
  await page.locator('#shared-continue').click({ timeout: 30_000 });
  await expect(page.locator('#shared-overlay')).toBeHidden({ timeout: 2000 });

  const player1 = page.locator('#player1-case');
  const player2 = page.locator('#player2-case');
  await expect(player1).toBeVisible();
  await expect(player2).toBeVisible();
  await expect(player1).toHaveText('玩家 1：T01');
  await expect(player2).toHaveText('玩家 2：T02');

  // 編號要落在各自那一側的面板裡。
  const inside = async (label, panel) => {
    const a = await label.boundingBox();
    const b = await page.locator(panel).boundingBox();
    return a.x >= b.x && a.x + a.width <= b.x + b.width && a.y >= b.y && a.y + a.height <= b.y + b.height;
  };
  expect(await inside(player1, '.player-one')).toBe(true);
  expect(await inside(player2, '.player-two')).toBe(true);
  expect(pageErrors).toEqual([]);
});
