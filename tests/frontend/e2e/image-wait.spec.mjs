// shared/image-wait.js：漂浮泡泡、指令出擊要等圖片全部載完才開局，慢也不能先開始計時。
import { test, expect } from '@playwright/test';
import { DOUBLE, STUDENT, loginAs } from './helpers.mjs';

/** 攔住符合 pattern 的請求，直到呼叫回傳的 release() 才放行。 */
async function holdRequests(page, pattern) {
  const held = [];
  let released = false;
  await page.route(pattern, (route) => {
    if (released) route.continue();
    else held.push(route);
  });
  return {
    count: () => held.length,
    release() {
      released = true;
      held.splice(0).forEach((route) => route.continue());
    },
  };
}

const overlay = (page) => page.locator('.webgame-image-wait');

for (const game of [
  { name: 'EFT_single', session: STUDENT, path: 'EFT_single/EFT_single.html', field: '#bubble-field .bubble', round: '#round' },
  { name: 'EFT_double', session: DOUBLE, path: 'EFT_double/EFT_double.html', field: '.player-1 [data-ui="bubble-field"] .bubble', round: '.player-1 [data-ui="round"]' },
]) {
  test(`${game.name}：泡泡圖還沒載完不開局，載完才出第一題`, async ({ page }) => {
    const bubble = await holdRequests(page, '**/assets/arrow/%E7%A9%BA%E6%B3%A1%E6%B3%A1.png*');
    await loginAs(page, game.session);
    await page.goto(game.path, { waitUntil: 'domcontentloaded' });

    await expect(overlay(page)).toContainText('正在載入圖片');
    await expect.poll(bubble.count).toBeGreaterThan(0);
    // 超過舊版的 5 秒逾時仍不開局。
    await page.waitForTimeout(6000);
    await expect(page.locator(game.field)).toHaveCount(0);
    const roundBefore = await page.locator(game.round).textContent();

    bubble.release();
    await expect(overlay(page)).toHaveCount(0);
    await expect(page.locator(game.field)).toHaveCount(3);
    // 計時是載完才開始：剩餘秒數從 60 起算。
    await expect(page.locator(game.round)).toContainText('60 秒');
    expect(roundBefore).toBeTruthy();
  });
}

test('EFT_single：圖片載入失敗，重試後顯示錯誤與「重新載入」，不開局', async ({ page }) => {
  await page.route('**/assets/arrow/%E7%A9%BA%E6%B3%A1%E6%B3%A1.png*', (route) => route.fulfill({ status: 404, body: '' }));
  await loginAs(page, STUDENT);
  await page.goto('EFT_single/EFT_single.html', { waitUntil: 'domcontentloaded' });

  await expect(overlay(page)).toContainText('圖片載入失敗', { timeout: 10000 });
  await expect(overlay(page).getByRole('button', { name: '重新載入' })).toBeVisible();
  await expect(overlay(page).getByRole('button', { name: '返回選遊戲' })).toBeVisible();
  await expect(page.locator('#bubble-field .bubble')).toHaveCount(0);
});

test('IM_single：房間圖還沒載完不開局，載完才出題目卡', async ({ page }) => {
  const scene = await holdRequests(page, '**/IM_single/img/scene/kitchen.png*');
  await loginAs(page, STUDENT);
  await page.goto('IM_single/index.html', { waitUntil: 'domcontentloaded' });

  await expect(overlay(page)).toContainText('正在載入圖片');
  await expect.poll(scene.count).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  await expect(page.locator('#start-stage-btn')).toBeHidden();

  // 載入期間「離開」仍按得到。
  await page.locator('#leave-btn').click();
  await expect(page.locator('.webgame-leave-confirm')).toBeVisible();
  await page.keyboard.press('Escape');

  scene.release();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator('#start-stage-btn')).toBeVisible();
  await expect(page.locator('#timer-box')).toHaveText('60 秒');
});
