// 每個說明頁都有「返回選遊戲」，選錯遊戲不必按瀏覽器的上一頁。
import { test, expect } from '@playwright/test';
import { STUDENT, DOUBLE, loginAs } from './helpers.mjs';
import { GUARDED_PAGES, DOUBLE_PAGES } from '../site.mjs';

const tutorials = [
  ...GUARDED_PAGES.filter((path) => path.startsWith('Tutorial/')).map((path) => [path, STUDENT, '#single-stage']),
  ...DOUBLE_PAGES.filter((path) => path.startsWith('Tutorial/')).map((path) => [path, DOUBLE, '#dual-stage']),
];

test('九個說明頁都列入測試', () => {
  expect(tutorials).toHaveLength(9);
});

for (const [path, session, stage] of tutorials) {
  test(`${path}：按「返回選遊戲」回到 Select，仍保持登入`, async ({ page }) => {
    await loginAs(page, session);
    await page.goto(path);
    const back = page.getByRole('link', { name: '返回選遊戲' });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/Select\/index\.html$/);
    await expect(page.locator(stage)).toBeVisible();
  });
}
