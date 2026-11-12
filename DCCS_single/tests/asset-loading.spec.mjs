// 圖片載入：進度、自動重試、卡住逾時、失敗時的「重新載入」按鈕（單人與雙人）。
// 以前任何一張圖卡住，畫面就永遠停在「載入中」，沒有進度、錯誤訊息或重試按鈕。
// 圖片請求由 page.route 攔截，決定要正常回應、失敗還是永遠不回應。

import { test, expect } from '@playwright/test';
import { QUERY, setup } from './helpers.mjs';

// ready：載入完成後出現的畫面。單人是關卡提示的「繼續」，雙人是兩人共用的第 1 關提示。
// errorScreen／retry：學生看到的錯誤畫面與按鈕。雙人版由共用畫面蓋住兩位玩家各自的遮罩。
const GAMES = [
  {
    mode: 'single', path: '/DCCS_single/index.html', image: '**/DCCS_single/assets/Single.png*',
    ready: '.dccs-level-continue:not([data-break])', errorScreen: '.dccs-overlay-error', retry: '.dccs-error-retry',
  },
  {
    mode: 'double', path: '/DCCS_double/index.html', image: '**/DCCS_double/assets/Double.png*',
    ready: '#shared-level', errorScreen: '#shared-error', retry: '#shared-error-retry',
  },
];

// 雙人版每位玩家各有一組遮罩，兩邊一起載入，取第一位玩家的即可。
const loading = (page) => page.locator('.dccs-overlay-loading').first();

/**
 * 只等 HTML 載入：瀏覽器會等所有圖片請求結束才觸發 load 事件，
 * 圖片卡住時 page.goto 預設的 waitUntil: 'load' 會跟著卡住，量不到載入中的畫面。
 */
const open = (page, url) => page.goto(url, { waitUntil: 'domcontentloaded' });

/** 載入完成：出現開始畫面，載入中與錯誤畫面都已消失。 */
async function expectLoaded(page, game) {
  await expect(page.locator(game.ready).first()).toBeVisible({ timeout: 30_000 });
  await expect(loading(page)).toBeHidden();
  await expect(page.locator(game.errorScreen).first()).toBeHidden();
}

/** 記錄某張圖被請求的次數，前 failTimes 次用 how 處理（'abort' 或 'hang'），之後正常回應。 */
async function interceptImage(page, pattern, { failTimes = Infinity, how = 'abort' } = {}) {
  const state = { requests: 0, failTimes };
  await page.route(pattern, async (route) => {
    state.requests += 1;
    if (state.requests > state.failTimes) return route.continue();
    if (how === 'hang') return; // 不回應，模擬連線停住
    return route.abort('connectionfailed');
  });
  return state;
}

for (const game of GAMES) {
  const { mode, path, image } = game;
  const errorOverlay = (page) => page.locator(game.errorScreen).first();
  const retryButton = (page) => page.locator(game.retry).first();
  test.describe(`${mode} 圖片載入`, () => {
    test('載入中顯示進度（已載入張數／總張數）', async ({ page }) => {
      await setup(page, mode);
      // 讓一張圖晚一點回應，才看得到進度停在中間。
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await page.route(image, async (route) => { await held; await route.continue(); });

      await open(page, `${path}${QUERY}`);

      await expect(loading(page)).toContainText(/正在載入圖片…（20／21）/, { timeout: 30_000 });
      release();
      await expectLoaded(page, game);
    });

    test('第一次載入失敗會自動重試，學生不會看到錯誤', async ({ page }) => {
      const { pageErrors } = await setup(page, mode);
      const state = await interceptImage(page, image, { failTimes: 1 });

      await open(page, `${path}${QUERY}`);

      await expectLoaded(page, game);
      expect(state.requests).toBe(2);
      expect(pageErrors).toEqual([]);
    });

    test('重試後仍失敗：顯示中文錯誤和「重新載入」按鈕，主控台記錄是哪個檔案', async ({ page }) => {
      await setup(page, mode);
      const consoleErrors = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      const state = await interceptImage(page, image);

      await open(page, `${path}${QUERY}`);

      await expect(errorOverlay(page)).toBeVisible({ timeout: 30_000 });
      await expect(errorOverlay(page)).toContainText('圖片載入失敗，請確認網路連線後按「重新載入」。');
      await expect(retryButton(page)).toBeVisible();
      await expect(retryButton(page)).toBeFocused();
      await expect(loading(page)).toBeHidden();
      expect(state.requests).toBe(2);
      expect(consoleErrors.some((text) => /Double\.png|Single\.png/.test(text))).toBe(true);
    });

    test('按「重新載入」後網路恢復，就能正常進入遊戲', async ({ page }) => {
      await setup(page, mode);
      // 前兩次（第一次 + 自動重試）失敗，重新載入後恢復。
      const state = await interceptImage(page, image, { failTimes: 2 });

      await open(page, `${path}${QUERY}`);
      await expect(retryButton(page)).toBeVisible({ timeout: 30_000 });
      await retryButton(page).click();

      await expectLoaded(page, game);
      expect(state.requests).toBeGreaterThanOrEqual(3);
    });
  });
}

const errorOverlay = (page) => page.locator(GAMES[0].errorScreen);
const retryButton = (page) => page.locator(GAMES[0].retry);

test('單人：圖片一直沒有回應（連線卡住）時，逾時後顯示錯誤，不會永遠停在載入中', async ({ page }) => {
  // 預設每次等 15 秒，加上自動重試共約 30 秒。
  test.setTimeout(90_000);
  await setup(page, 'single');
  const state = await interceptImage(page, GAMES[0].image, { how: 'hang' });

  await open(page, `${GAMES[0].path}${QUERY}`);
  await expect(loading(page)).toBeVisible({ timeout: 30_000 });

  await expect(errorOverlay(page)).toBeVisible({ timeout: 45_000 });
  await expect(retryButton(page)).toBeVisible();
  expect(state.requests).toBe(2);
});

test('單人：其他錯誤（不是載入失敗）不顯示「重新載入」按鈕', async ({ page }) => {
  await setup(page, 'single');
  // manifest 格式錯誤：不是網路問題，重新載入也沒用。
  await page.route('**/DCCS_single/manifest.json*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"categories": [{}]}',
  }));

  await open(page, `${GAMES[0].path}${QUERY}`);

  await expect(errorOverlay(page)).toBeVisible({ timeout: 30_000 });
  await expect(retryButton(page)).toBeHidden();
});
