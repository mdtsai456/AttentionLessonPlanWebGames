// 單人結算畫面：成績送出中「返回遊戲大廳」停用，送完才能按，且一按就回大廳。
// 送出中按下去會被忽略（還沒開始等待返回），學生會以為按鈕壞了。
// 雙人版不顯示這個結算畫面，送完會自動回大廳，所以只測單人。
import { test, expect } from '@playwright/test';
import { setup, LEVEL_TIMEOUT } from './helpers.mjs';

test('結算送出中禁止返回，回應完成後可一次點擊回大廳', async ({ page }) => {
  const { posts, pageErrors } = await setup(page, 'single', { delayMs: 3000 });
  await page.goto('/DCCS_single/index.html?sessionSeconds=5');
  await page.locator('.dccs-level-continue:not([data-break])').click();
  const lobby = page.locator('[data-result="lobby"]');
  await expect(lobby).toBeVisible({ timeout: LEVEL_TIMEOUT });
  await expect(lobby).toBeDisabled();
  await lobby.evaluate((button) => button.click());
  await expect(page).toHaveURL(/\/DCCS_single\/index\.html/);
  await expect(lobby).toBeEnabled({ timeout: 10_000 });
  await lobby.click();
  await page.waitForURL(/\/Select\/index\.html/);
  expect(posts).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});
