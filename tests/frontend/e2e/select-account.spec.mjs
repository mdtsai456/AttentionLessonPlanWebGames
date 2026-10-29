// Select 標題下顯示登入帳號與第幾天；Home 登入時記下帳號。
import { test, expect } from '@playwright/test';
import { STUDENT, DOUBLE, loginAs } from './helpers.mjs';

test('單人顯示帳號與第幾天', async ({ page }) => {
  await loginAs(page, { ...STUDENT, student1_account: 'S0001' });
  await page.goto('Select/index.html');
  await expect(page.locator('#single-stage [data-who="1"]')).toHaveText('帳號 S0001・第 3 天');
});

test('雙人兩邊各顯示自己的帳號與第幾天', async ({ page }) => {
  await loginAs(page, { ...DOUBLE, student1_account: 'S0001', student2_account: 'S0002' });
  await page.goto('Select/index.html');
  await expect(page.locator('#dual-stage [data-who="1"]')).toHaveText('帳號 S0001・第 3 天');
  await expect(page.locator('#dual-stage [data-who="2"]')).toHaveText('帳號 S0002・第 1 天');
});

test('舊的登入沒有存帳號時，改顯示個案編號', async ({ page }) => {
  await loginAs(page, STUDENT);
  await page.goto('Select/index.html');
  await expect(page.locator('#single-stage [data-who="1"]')).toHaveText('帳號 S99・第 3 天');
});

test('Home 學生登入時存下輸入的帳號', async ({ page }) => {
  await page.route('**/api/auth/student/login', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      token: 'student-token.' + crypto.randomUUID(),
      studentKey: 'G9_S99', grade: 'G9', caseId: 'S99', school: 'TEST', expiresIn: 3600,
    }),
  }));
  await page.addInitScript(() => { window.API_BASE_URL = location.origin + '/api'; });
  await page.goto('Home/index.html');
  await page.locator('[data-role="student"]').click();
  await page.locator('[data-mode="single"]').click();
  await page.locator('[name="username-0"]').fill(' S0001 ');
  await page.locator('[name="password-0"]').fill('pw');
  await page.locator('[name="day-0"]').fill('3');
  await page.locator('#login-form [type="submit"]').click();
  await page.waitForURL(/\/Select\/index\.html/);
  await expect(page.locator('#single-stage [data-who="1"]')).toHaveText('帳號 S0001・第 3 天');
});
