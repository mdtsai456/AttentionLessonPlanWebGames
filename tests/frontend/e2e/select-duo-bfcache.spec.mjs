// 雙人進入說明頁後按上一頁（bfcache 還原）時，Select 不能卡在「準備進入遊戲…」。
import { test, expect } from '@playwright/test';
import { DOUBLE, loginAs } from './helpers.mjs';

// Playwright 預設使用 --disable-back-forward-cache。
test.use({
  channel: 'chromium',
  launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] },
});

test('從說明頁按上一頁回到 Select，遮罩收起，可以重新選遊戲', async ({ page }) => {
  const shows = [];
  await page.addInitScript(() => {
    addEventListener('pageshow', (event) => console.log(`pageshow ${location.pathname} ${event.persisted}`));
  });
  page.on('console', (message) => {
    const match = /^pageshow (\S+) (true|false)$/.exec(message.text());
    if (match) shows.push({ path: match[1], persisted: match[2] === 'true' });
  });
  await loginAs(page, DOUBLE);
  await page.goto('Select/index.html');
  for (const slot of [1, 2]) {
    await page.locator(`[data-game-list="${slot}"] [data-select-game]`, { hasText: '賽道攔截' }).click();
    await page.click(`[data-enter="${slot}"]`);
  }
  await expect(page).toHaveURL(/DCCS_double_tutorial\.html$/);
  await page.waitForTimeout(500);

  await page.goBack({ waitUntil: 'commit' });
  await page.waitForTimeout(1000);

  // 須先確認 Select 從 bfcache 還原，才能驗證本測試的行為。
  expect(shows).toContainEqual({ path: '/Select/index.html', persisted: true });
  await expect(page.locator('[data-wait="1"]')).toBeHidden();
  await expect(page.locator('[data-wait="2"]')).toBeHidden();
  await page.locator('[data-game-list="1"] [data-select-game]', { hasText: '漂浮泡泡' }).click();
  await expect(page.locator('[data-game-list="1"] .is-selected')).toHaveText('漂浮泡泡');
});
