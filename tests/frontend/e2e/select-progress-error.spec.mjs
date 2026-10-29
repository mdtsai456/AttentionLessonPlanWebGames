// Select 進度讀取失敗時要說明，不能默默顯示 0%；仍可選遊戲。
import { test, expect } from '@playwright/test';
import { STUDENT, DOUBLE, loginAs } from './helpers.mjs';

const MESSAGE = '進度讀取失敗，請檢查網路後重新整理頁面。';

async function failReport(page, studentKey, how) {
  await page.route(`**/api/students/${studentKey}/report*`, (route) =>
    how === 'abort' ? route.abort('failed') : route.fulfill({ status: 500, body: '{}' }));
}

for (const how of ['abort', '500']) {
  test(`單人進度讀取失敗（${how}）：顯示錯誤，仍可選遊戲進入說明頁`, async ({ page }) => {
    await loginAs(page, STUDENT);
    await failReport(page, 'G9_S99', how);
    await page.goto('Select/index.html');
    await expect(page.locator('#single-stage [data-progress-error="1"]')).toHaveText(MESSAGE);

    await page.locator('#game-list [data-select-game]', { hasText: '賽道攔截' }).click();
    await page.click('#enter-btn');
    await expect(page).toHaveURL(/DCCS_tutorial\.html$/);
  });
}

test('雙人只有玩家二讀取失敗：只有玩家二那側顯示錯誤', async ({ page }) => {
  await loginAs(page, DOUBLE);
  await failReport(page, 'G8_S88', 'abort');
  await page.goto('Select/index.html');
  await expect(page.locator('#dual-stage [data-progress-error="2"]')).toHaveText(MESSAGE);
  await expect(page.locator('#dual-stage [data-progress-error="1"]')).toHaveText('');
});

test('讀取成功時不顯示錯誤', async ({ page }) => {
  await loginAs(page, STUDENT);
  await page.goto('Select/index.html');
  await expect(page.locator('#game-list [data-select-game]')).toHaveCount(5);
  await expect(page.locator('#single-stage [data-progress-error="1"]')).toBeHidden();
});
