// 老師後台的學生名單讀不到時，要說明讀取失敗，不能看起來像是沒有學生。
import { test, expect } from '@playwright/test';
import { TEACHER, loginAs } from './helpers.mjs';

for (const how of ['abort', '500']) {
  test(`學生名單讀取失敗（${how}）：下拉選單與提示卡都說明失敗`, async ({ page }) => {
    await page.route('**/api/me/students', (route) =>
      how === 'abort' ? route.abort('failed') : route.fulfill({ status: 500, body: '{}' }));
    await loginAs(page, TEACHER);
    await page.goto('Teacher_platform/index.html');
    await expect(page.locator('#student-select option')).toHaveText(['學生名單讀取失敗']);
    await expect(page.locator('#empty-hint h3')).toHaveText('學生名單讀取失敗');
    await expect(page.locator('#empty-hint p')).toHaveText('請檢查網路後重新整理頁面。');
  });
}

test('名單讀取成功時維持原本的提示', async ({ page }) => {
  await page.route('**/api/me/students', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ students: [{ studentKey: 'G9_A01', caseId: 'A01', school: 'TEST' }] }),
  }));
  await loginAs(page, TEACHER);
  await page.goto('Teacher_platform/index.html');
  await expect(page.locator('#student-select option')).toHaveCount(2);
  await expect(page.locator('#empty-hint h3')).toHaveText('請於上方選取學生');
});
