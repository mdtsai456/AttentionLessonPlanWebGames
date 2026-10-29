// Select 的登出先跳確認框，按「取消」不登出；雙人提醒兩位會一起登出。
import { test, expect } from '@playwright/test';
import { STUDENT, DOUBLE, HOME_URL, loginAs } from './helpers.mjs';

async function trackLogout(page) {
  const calls = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/logout')) calls.push(request.url());
  });
  return calls;
}

test('按登出先問，按「取消」留在 Select 也不登出', async ({ page }) => {
  await loginAs(page, STUDENT);
  const calls = await trackLogout(page);
  await page.goto('Select/index.html');
  await page.click('#logout-btn');
  const dialog = page.locator('.webgame-leave-confirm');
  await expect(dialog.locator('h2')).toHaveText('確定要登出嗎？');
  await expect(dialog.locator('p')).toHaveText('登出後會回到登入頁。');
  await dialog.locator('.webgame-leave-confirm__stay').click();

  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem('user_role'))).toBe('student');
});

test('Esc 等於取消', async ({ page }) => {
  await loginAs(page, STUDENT);
  await page.goto('Select/index.html');
  await page.click('#logout-btn');
  await page.keyboard.press('Escape');
  await expect(page.locator('.webgame-leave-confirm')).toHaveCount(0);
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
});

test('按「登出」才登出並回到 Home', async ({ page }) => {
  await loginAs(page, STUDENT);
  const calls = await trackLogout(page);
  await page.goto('Select/index.html');
  await page.click('#logout-btn');
  await page.click('.webgame-leave-confirm__leave');
  await expect(page).toHaveURL(HOME_URL);
  expect(calls).toHaveLength(1);
});

test('雙人提醒兩位學生會一起登出，確定後兩個 token 都登出', async ({ page }) => {
  await loginAs(page, DOUBLE);
  const calls = await trackLogout(page);
  await page.goto('Select/index.html');
  await page.click('#logout-btn');
  await expect(page.locator('.webgame-leave-confirm p')).toHaveText('兩位學生都會一起登出，回到登入頁。');
  await page.click('.webgame-leave-confirm__leave');
  await expect(page).toHaveURL(HOME_URL);
  expect(calls).toHaveLength(2);
});
