// 單人版「離開」按鈕：先在頁面內確認，確定後才送出檢查點並回大廳（第 41 項）。
// 以前先存檔再跳瀏覽器的離開詢問，取消後打完全場會多一筆檢查點。
// 成績 POST 一律由測試攔截，不會打到真的後端。

import { test, expect } from '@playwright/test';
import {
  FULL_SESSION_STAGE,
  LEVEL_TIMEOUT,
  QUERY,
  SUBMIT_PATH,
  answerLeave,
  drive,
  leaveDialog,
  pendingResults,
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

async function continueAfterBreak(page) {
  await page.locator('[data-break="continue"]').click();
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll('[data-break]')].some((el) => el.checkVisibility())
  ), { timeout: 2000 }).toBe(false);
}

test.describe('單人版 離開：先確認，確定後才存檔', () => {
  test('第 1 關：取消後遊戲照常、什麼都不送；確定後直接回大廳，不跳瀏覽器離開詢問', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single');
    await page.goto(`/DCCS_single/index.html${QUERY}`);
    await page.locator('.dccs-level-continue:not([data-break])').click({ timeout: 30_000 });
    const dialogs = recordNativeDialogs(page);

    const leave = page.locator('#leave-btn');
    await leave.click();
    await answerLeave(page, 'stay');
    await page.waitForTimeout(500);
    expect(posts).toHaveLength(0);
    expect(new URL(page.url()).pathname).toBe('/DCCS_single/index.html');
    expect(await unloadGuardActive(page)).toBe(true);

    await leave.click();
    await answerLeave(page, 'leave');
    await page.waitForURL(/\/Select\/index\.html/);

    expect(posts).toHaveLength(0);
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('第 3 關後確定離開：送一次第 3 關檢查點再回大廳，不跳瀏覽器離開詢問', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single', { delayMs: 1500 });
    await reachBreak(page, 'single');
    await continueAfterBreak(page);
    await watchTracks(page, 'single');
    const dialogs = recordNativeDialogs(page);

    const leave = page.locator('#leave-btn');
    await leave.click();
    await answerLeave(page, 'leave');
    // 存檔送出中（確定離開後遊戲維持暫停）：賽道不前進、不換關、不多送。
    // 確認框已關、遊戲仍暫停：這時按轉動鍵不能轉輪盤、不能記成績，也不能排隊等恢復後補轉。
    const frozen = await trackStates(page);
    await pressAllValveKeys(page);
    await page.waitForTimeout(800);
    expect(await trackStates(page)).toEqual(frozen);
    expect(await takeQueuedPresses(page)).toEqual(frozen.map(() => 0));
    expect(new URL(page.url()).pathname).toBe('/DCCS_single/index.html');
    expect(posts).toHaveLength(1);
    // 存檔中再按離開：不能再問一次，也不能重送或提早導頁。
    await leave.click({ force: true });
    await page.waitForTimeout(200);
    expect(await leaveDialog(page).count()).toBe(0);
    // 送完後 main.js（場次結束）與離開流程都會導向同一頁，第一個導頁可能被第二個取代，
    // waitForURL 會把被取代的那次當成失敗，所以改看最後停在哪一頁。
    await expect(page).toHaveURL(/\/Select\/index\.html/, { timeout: 15_000 });

    expect(posts).toHaveLength(1);
    expect(stat(posts[0], 'stage')).toBe(3);
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('第 3 關後取消離開，再打完全場：只送全場成績一筆', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single');
    await reachBreak(page, 'single');
    await continueAfterBreak(page);
    const dialogs = recordNativeDialogs(page);

    const leave = page.locator('#leave-btn');
    await leave.click();
    await expect(leaveDialog(page)).toBeVisible();
    // 確認框開著時遊戲畫面的按鍵不作用；Esc 等於取消。
    await page.keyboard.press('Escape');
    await expect(leaveDialog(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(posts).toHaveLength(0);

    await leave.click();
    await answerLeave(page, 'stay');
    await page.waitForTimeout(500);
    expect(posts).toHaveLength(0);

    await drive(page, 'single', 'session-end', 3 * LEVEL_TIMEOUT + 15_000);
    await page.waitForURL(/\/Select\/index\.html/);

    expect(posts).toHaveLength(1);
    expect(stat(posts[0], 'stage')).toBe(FULL_SESSION_STAGE);
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('第 3 關後確定離開但後端不回應：遊戲暫停中送出仍會在 15 秒後逾時，暫存成績並回大廳', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single', { hang: true });
    await reachBreak(page, 'single');
    await continueAfterBreak(page);
    const dialogs = recordNativeDialogs(page);

    await page.locator('#leave-btn').click();
    await answerLeave(page, 'leave');
    // 逾時計時器若用遊戲時鐘（確定離開後暫停），就永遠等不到逾時、卡在這頁。
    await expect(page).toHaveURL(/\/Select\/index\.html/, { timeout: 25_000 });

    expect(posts).toHaveLength(1);
    const pending = await pendingResults(page);
    expect(pending).toHaveLength(1);
    expect(stat(pending[0], 'stage')).toBe(3);
    expect(pending[0].data.submissionId).toBe(posts[0].data.submissionId);
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('整場結束、成績送出中確定離開：等送完才回大廳，不中斷送出也不重送', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single', { delayMs: 3000 });
    const aborted = [];
    page.on('requestfailed', (request) => {
      if (request.url().includes(SUBMIT_PATH)) aborted.push(request.failure()?.errorText);
    });
    await page.goto('/DCCS_single/index.html?sessionSeconds=5');
    await page.locator('.dccs-level-continue:not([data-break])').click();
    // 結算畫面出現、最終成績已在送。
    await expect.poll(() => posts.length, { timeout: LEVEL_TIMEOUT }).toBe(1);
    await expect(page.locator('[data-result="lobby"]')).toBeDisabled();
    const dialogs = recordNativeDialogs(page);

    const leave = page.locator('#leave-btn');
    await leave.click();
    await answerLeave(page, 'leave');
    // 送出中不能導頁：導頁會中斷請求，失敗也來不及存到本機，成績就不見了。
    await page.waitForTimeout(1000);
    expect(new URL(page.url()).pathname).toBe('/DCCS_single/index.html');
    // 等待中再按離開：不再問、不重送。
    await leave.click({ force: true });
    expect(await leaveDialog(page).count()).toBe(0);

    await expect(page).toHaveURL(/\/Select\/index\.html/, { timeout: 15_000 });
    expect(aborted).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(await pendingResults(page)).toEqual([]);
    expect(dialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
