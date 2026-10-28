// 雙人選遊戲：等待遮罩說明已選的遊戲與取消方式，選不同遊戲時列出兩人各選什麼，
// 兩人確認後顯示「準備進入遊戲…」。
import { test, expect } from '@playwright/test';
import { DOUBLE, loginAs } from './helpers.mjs';

async function openDuoSelect(page) {
  await loginAs(page, DOUBLE);
  await page.goto('Select/index.html');
  await expect(page.locator('#dual-stage')).toBeVisible();
}

async function pickAndConfirm(page, slot, label) {
  await page.locator(`[data-game-list="${slot}"] [data-select-game]`, { hasText: label }).click();
  await page.click(`[data-enter="${slot}"]`);
}

test('確認後遮罩顯示已選的遊戲與「點此取消」，點一下就取消', async ({ page }) => {
  await openDuoSelect(page);
  await pickAndConfirm(page, 1, '賽道攔截');
  const mask = page.locator('[data-wait="1"]');
  await expect(mask).toContainText('已選：賽道攔截（點此取消）');
  await expect(mask).toContainText('等待玩家二確認');

  await mask.click();
  await expect(mask).toBeHidden();
  await pickAndConfirm(page, 1, '漂浮泡泡');
  await expect(mask).toContainText('已選：漂浮泡泡（點此取消）');
});

test('玩家二的遮罩稱呼玩家一', async ({ page }) => {
  await openDuoSelect(page);
  await pickAndConfirm(page, 2, '勇闖迷宮');
  await expect(page.locator('[data-wait="2"]')).toContainText('已選：勇闖迷宮（點此取消）');
  await expect(page.locator('[data-wait="2"]')).toContainText('等待玩家一確認');
});

test('兩人選不同遊戲：列出兩人各選了什麼，並取消兩邊的確認', async ({ page }) => {
  await openDuoSelect(page);
  await pickAndConfirm(page, 1, '賽道攔截');
  await pickAndConfirm(page, 2, '漂浮泡泡');
  const message = '玩家一選「賽道攔截」，玩家二選「漂浮泡泡」，請選擇同一個遊戲';
  await expect(page.locator('[data-error="1"]')).toHaveText(message);
  await expect(page.locator('[data-error="2"]')).toHaveText(message);
  await expect(page.locator('[data-wait="1"]')).toBeHidden();
  await expect(page.locator('[data-wait="2"]')).toBeHidden();
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
});

test('兩人選同一個遊戲：導頁期間兩邊都顯示「準備進入遊戲…」且不能取消', async ({ page }) => {
  await openDuoSelect(page);
  await pickAndConfirm(page, 1, '漂浮泡泡');
  await page.locator('[data-game-list="2"] [data-select-game]', { hasText: '漂浮泡泡' }).click();
  // 導頁開始後 Playwright 會等新頁面，所以在同一段腳本裡按下並讀出遮罩狀態。
  const masks = await page.evaluate(() => {
    document.querySelector('[data-enter="2"]').click();
    return [1, 2].map((slot) => {
      const mask = document.querySelector(`[data-wait="${slot}"]`);
      return { text: mask.textContent, hidden: mask.hidden, disabled: mask.disabled };
    });
  });
  expect(masks).toEqual([
    { text: '準備進入遊戲…', hidden: false, disabled: true },
    { text: '準備進入遊戲…', hidden: false, disabled: true },
  ]);
  await expect(page).toHaveURL(/EFT_double_tutorial\.html$/);
});
