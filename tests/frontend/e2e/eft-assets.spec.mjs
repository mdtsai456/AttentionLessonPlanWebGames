// shared/eft-assets.js：素材 API 或圖片卡住時，逾時改用內建箭頭，遊戲照樣開始。
import { test, expect } from '@playwright/test';
import { DOUBLE, STUDENT, loginAs } from './helpers.mjs';

const ASSET_HOST = 'https://attention-lesson-plan-assets.zeabur.app';

// 不呼叫 fulfill / continue，請求就一直懸著。
const hang = () => {};

for (const game of [
  { name: 'EFT_single', session: STUDENT, path: 'EFT_single/EFT_single.html', field: '#bubble-field .bubble' },
  { name: 'EFT_double', session: DOUBLE, path: 'EFT_double/EFT_double.html', field: '.player-1 [data-ui="bubble-field"] .bubble' },
]) {
  test(`#15 ${game.name} 素材 API 不回應，逾時後用內建箭頭開始`, async ({ page }) => {
    await page.route(`${ASSET_HOST}/**`, hang);
    await loginAs(page, game.session);
    await page.goto(game.path);
    await expect(page.locator(game.field)).toHaveCount(3, { timeout: 9000 });
  });
}

test('#15 上傳的箭頭圖卡住時，逾時改用本機箭頭', async ({ page }) => {
  await page.route(`${ASSET_HOST}/api/**`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ EFT: { assets: { files: [`${ASSET_HOST}/hang-1.png`, `${ASSET_HOST}/hang-2.png`] } } }),
  }));
  await page.route(`${ASSET_HOST}/hang-*.png`, hang);
  await loginAs(page, STUDENT);
  // 懸著的圖片會讓 load 事件一直不觸發（遊戲本身不受影響），所以只等 DOM 就緒。
  await page.goto('EFT_single/EFT_single.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bubble-field .bubble')).toHaveCount(3, { timeout: 9000 });
  const loaded = await page.evaluate(async () => {
    const { preloadEftAssets } = await import('/shared/eft-assets.js');
    return preloadEftAssets({ studentId: 'S99' });
  });
  expect(loaded).toEqual(['assets/arrow/箭頭00.png', 'assets/arrow/箭頭01.png', 'assets/arrow/箭頭02.png']);
});
