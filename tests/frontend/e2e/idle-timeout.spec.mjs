// 閒置自動登出（shared/session-timeout.js、shared/require-student.js）。
// 用 page.route 回應 /api/auth/me 與 /api/auth/heartbeat，並把效期縮短成幾秒，測試不用等 30 分鐘。
import { test, expect } from '@playwright/test';
import { STUDENT, TEACHER, loginAs } from './helpers.mjs';

const SELECT_URL = /\/Select\/index\.html$/;

const identity = (session) => (session.user_role === 'teacher'
  ? { role: 'teacher', teacherId: 1, teacherName: '測試', school: 'TEST' }
  : { role: 'student', grade: 'G9', caseId: 'S99', school: 'TEST', studentKey: 'G9_S99' });

/**
 * 攔截登入驗證與 heartbeat。
 * me：依序回應 /auth/me 的剩餘秒數（null 表示 401）；用完沿用最後一個。
 * heartbeat：回應的剩餘秒數（null 表示 401）。
 */
async function mockAuth(page, session, { me = [3600], heartbeat = 1800 } = {}) {
  const calls = { me: 0, heartbeat: [] };
  await page.route('**/api/auth/me', (route) => {
    const expiresIn = me[Math.min(calls.me, me.length - 1)];
    calls.me += 1;
    if (expiresIn === null) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"請重新登入"}' });
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...identity(session), expiresIn, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }),
    });
  });
  await page.route('**/api/auth/heartbeat', (route) => {
    calls.heartbeat.push(route.request().headers().authorization);
    if (heartbeat === null) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ expiresIn: heartbeat, expiresAt: new Date(Date.now() + heartbeat * 1000).toISOString() }),
    });
  });
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204 }));
  return calls;
}

async function openSelect(page, session = STUDENT) {
  await loginAs(page, session);
  await page.goto(session.user_role === 'teacher' ? 'Teacher_platform/index.html' : 'Select/index.html');
  await expect(page.locator('html')).not.toHaveAttribute('style', /visibility: hidden/);
}

test('有操作時送 heartbeat（帶本人 token），延長本機到期時間', async ({ page }) => {
  const calls = await mockAuth(page, STUDENT, { me: [600], heartbeat: 1800 });
  await openSelect(page);
  const before = await page.evaluate(() => Number(sessionStorage.getItem('login_expires_at')));

  await page.mouse.move(200, 200);
  await page.keyboard.press('Shift');

  await expect.poll(() => calls.heartbeat.length).toBe(1);
  expect(calls.heartbeat[0]).toMatch(/^Bearer student-token\./);
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem('login_expires_at'))))
    .toBeGreaterThan(before + 1000 * 1000);
});

test('沒有操作就不送 heartbeat', async ({ page }) => {
  const calls = await mockAuth(page, STUDENT);
  await openSelect(page);

  await page.waitForTimeout(1500);

  expect(calls.heartbeat).toEqual([]);
});

test('老師後台移動滑鼠也算操作', async ({ page }) => {
  const calls = await mockAuth(page, TEACHER);
  await openSelect(page, TEACHER);

  await page.mouse.move(300, 300);
  await page.mouse.move(320, 320);

  await expect.poll(() => calls.heartbeat.length).toBe(1);
  expect(calls.heartbeat[0]).toMatch(/^Bearer teacher-token\./);
});

test('閒置到期：後端也說已失效，回登入頁並清除登入', async ({ page }) => {
  // 第一次驗證剩 2 秒；到期時重新驗證回 401。
  await mockAuth(page, STUDENT, { me: [2, null] });
  await openSelect(page);

  // 只由 require-student.js 導頁一次，帶 auth=expired，登入頁會顯示「登入已失效」。
  await page.waitForURL(/\/Home\/index\.html\?auth=expired$/, { timeout: 15_000 });
  await expect(page.getByText('登入已失效或身分不符，請重新登入。')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('user_role'))).toBeNull();
});

test('本機到期但後端說還有效（例如別的分頁延長過），留在原頁面', async ({ page }) => {
  const calls = await mockAuth(page, STUDENT, { me: [2, 1800] });
  await openSelect(page);

  await expect.poll(() => calls.me, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(1000);

  await expect(page).toHaveURL(SELECT_URL);
  await expect(page.locator('html')).not.toHaveAttribute('style', /visibility: hidden/);
});

test('持續操作讓登入延長，原本的到期時間過了也不會被登出', async ({ page }) => {
  // 驗證時只剩 3 秒；有操作就 heartbeat 延到 30 分鐘。之後的 /auth/me 一律 401，
  // 若還依原本的 3 秒到期，就會被登出。
  const calls = await mockAuth(page, STUDENT, { me: [3, null], heartbeat: 1800 });
  await openSelect(page);
  await page.keyboard.press('Shift');
  await expect.poll(() => calls.heartbeat.length).toBe(1);

  await page.waitForTimeout(4500);

  await expect(page).toHaveURL(SELECT_URL);
  expect(calls.me).toBe(1);
});

test('heartbeat 回 401（例如已達 8 小時上限）時登出', async ({ page }) => {
  await mockAuth(page, STUDENT, { heartbeat: null });
  await openSelect(page);

  await page.keyboard.press('Shift');

  await page.waitForURL(/\/Home\/index\.html/, { timeout: 15_000 });
});
