// 後半判定模組（shared/second-half.js）不在時，遊戲要照常從第 1 關開始，不能卡在載入中。
// 情境：瀏覽器拿到新的 app.js，卻是沒有 second-half.js 那一行的舊 HTML（EFT／IM／TGame 沒有版號）。
import { test, expect } from '@playwright/test';
import { STUDENT, loginAs, recordWrites, mockReport, firstHalfRecord } from './helpers.mjs';

test('IM：HTML 沒載入 second-half.js 時從第 1 關開始（即使這個課次已完成前半）', async ({ page }) => {
  await recordWrites(page);
  // 就算後端說前半已完成，模組不在就不會有人去查，只能從第 1 關。
  await mockReport(page, { [STUDENT.student1_key]: [firstHalfRecord('IM')] });
  await page.route('**/IM_single/index.html', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/^.*second-half\.js.*\n/m, '');
    await route.fulfill({ response, body: html });
  });
  await loginAs(page, STUDENT);
  await page.goto('IM_single/index.html');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.task && state.rooms.length);
  expect(await page.evaluate(() => window.WebGameSecondHalf)).toBeUndefined();
  await expect(page.locator('#problem-title')).toHaveText('第 1 關');
  expect(await page.evaluate(() => state.task.id)).toBe('P001');
});
