// 登入跨分頁共用（shared/login-share.js）。
// 同一個 Playwright context 的多個 page 就像同一個瀏覽器的多個分頁：
// 共用 localStorage、各自有 sessionStorage，storage 事件也會在分頁之間傳遞。
import { test, expect } from '@playwright/test';
import { HOME_URL } from './helpers.mjs';

const SELECT_URL = /\/Select\/index\.html$/;
const TEACHER_URL = /\/Teacher_platform\/index\.html$/;

/**
 * 整個 context 共用：API 指向測試伺服器；登入端點回傳測試伺服器 /auth/me 認得的 token。
 * caseId 可指定，用來模擬換帳號（S99 對應 student-token、S77 對應 alternate-token）。
 */
async function setup(context) {
  await context.addInitScript(() => { window.API_BASE_URL = location.origin + '/api'; });
  await context.route('**/api/auth/student/login', async (route) => {
    const { account } = route.request().postDataJSON();
    const other = account === 'S077';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: `${other ? 'alternate-token' : 'student-token'}.${crypto.randomUUID()}`,
        studentKey: other ? 'G8_S77' : 'G9_S99', grade: other ? 'G8' : 'G9',
        caseId: other ? 'S77' : 'S99', school: other ? 'T2' : 'TEST',
        expiresAt: new Date(Date.now() + 3600000).toISOString(), expiresIn: 3600,
      }),
    });
  });
  await context.route('**/api/auth/teacher/login', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      token: `teacher-token.${crypto.randomUUID()}`, teacherId: 1, teacherName: '測試', school: 'TEST',
      expiresAt: new Date(Date.now() + 3600000).toISOString(), expiresIn: 3600,
    }),
  }));
}

async function loginStudent(page, account = 'S099') {
  await page.goto('Home/index.html');
  await page.locator('[data-role="student"]').click();
  await page.locator('[data-mode="single"]').click();
  await page.locator('[name="username-0"]').fill(account);
  await page.locator('[name="password-0"]').fill('pw');
  await page.locator('[name="day-0"]').fill('3');
  await page.locator('#login-form [type="submit"]').click();
  await page.waitForURL(SELECT_URL);
  await expectVisible(page);
}

async function loginTeacher(page) {
  await page.goto('Home/index.html');
  await page.locator('[data-role="teacher"]').click();
  await page.locator('[name="username-0"]').fill('T001');
  await page.locator('[name="password-0"]').fill('pw');
  await page.locator('#login-form [type="submit"]').click();
  await page.waitForURL(TEACHER_URL);
}

/** require-student.js 驗證通過後才會顯示頁面。 */
async function expectVisible(page) {
  await expect(page.locator('html')).not.toHaveAttribute('style', /visibility: hidden/);
}

const session = (page, key) => page.evaluate((name) => sessionStorage.getItem(name), key);
// 分頁正在導頁時 evaluate 會失敗；輪詢時當成「還沒讀到」，下一輪再試。
const sessionSoon = (page, key) => session(page, key).catch(() => undefined);

async function logoutFromSelect(page) {
  await page.click('#logout-btn');
  await page.click('.webgame-leave-confirm__leave');
  await expect(page).toHaveURL(HOME_URL);
}

// 新分頁維持登入

test('登入後開新分頁進入 Select，不用重新登入', async ({ context }) => {
  await setup(context);
  const first = await context.newPage();
  await loginStudent(first);

  const second = await context.newPage();
  await second.goto('Select/index.html');

  await expect(second).toHaveURL(SELECT_URL);
  await expectVisible(second);
  expect(await session(second, 'caseId')).toBe('S99');
  expect(await session(second, 'token')).toBe(await session(first, 'token'));
});

test('登入後開新分頁直接進遊戲頁，不用重新登入', async ({ context }) => {
  await setup(context);
  await loginStudent(await context.newPage());

  const game = await context.newPage();
  await game.goto('TGame_single/index.html');

  await expect(game).toHaveURL(/\/TGame_single\/index\.html$/);
  await expectVisible(game);
});

test('已登入時新分頁打開登入頁，直接導向 Select', async ({ context }) => {
  await setup(context);
  await loginStudent(await context.newPage());

  const second = await context.newPage();
  await second.goto('Home/index.html');

  await expect(second).toHaveURL(SELECT_URL);
});

test('老師登入後新分頁打開登入頁，直接導向老師後台', async ({ context }) => {
  await setup(context);
  await loginTeacher(await context.newPage());

  const second = await context.newPage();
  await second.goto('Home/index.html');

  await expect(second).toHaveURL(TEACHER_URL);
});

test('關掉所有分頁後重新開啟，要重新登入（共用電腦上下一位不會進到前一位的帳號）', async ({ context }) => {
  await setup(context);
  const first = await context.newPage();
  await loginStudent(first);
  await first.close({ runBeforeUnload: true });

  const reopened = await context.newPage();
  await reopened.goto('Home/index.html');

  await expect(reopened.locator('[data-role="student"]')).toBeVisible();
  await expect(reopened).toHaveURL(HOME_URL);
  const select = await context.newPage();
  await select.goto('Select/index.html');
  await expect(select).toHaveURL(/\/Home\/index\.html/);
});

test('還有一個登入的分頁開著時，關掉其他分頁不影響新分頁沿用', async ({ context }) => {
  await setup(context);
  const first = await context.newPage();
  await loginStudent(first);
  const second = await context.newPage();
  await second.goto('Select/index.html');
  await expectVisible(second);
  await first.close({ runBeforeUnload: true });

  const third = await context.newPage();
  await third.goto('Home/index.html');

  await expect(third).toHaveURL(SELECT_URL);
});

test('停在登入頁的分頁，在別的分頁登入後一起進入 Select', async ({ context }) => {
  await setup(context);
  const waiting = await context.newPage();
  await waiting.goto('Home/index.html');

  await loginStudent(await context.newPage());

  await expect(waiting).toHaveURL(SELECT_URL);
});

// 登出、換帳號、失效

test('一個分頁登出，其他分頁一起回登入頁', async ({ context }) => {
  await setup(context);
  const first = await context.newPage();
  await loginStudent(first);
  const second = await context.newPage();
  await second.goto('Select/index.html');
  await expectVisible(second);

  await logoutFromSelect(first);

  await expect(second).toHaveURL(HOME_URL);
  expect(await session(second, 'user_role')).toBeNull();
  // 登出後開新分頁不會又自動登入。
  const third = await context.newPage();
  await third.goto('Home/index.html');
  await expect(third.locator('#role-step')).toBeVisible();
  await expect(third).toHaveURL(HOME_URL);
});

test('登出時遊戲中的分頁也回登入頁，不跳「確定離開」', async ({ context }) => {
  await setup(context);
  const first = await context.newPage();
  await loginStudent(first);
  const game = await context.newPage();
  await game.goto('TGame_single/index.html');
  await expectVisible(game);

  await logoutFromSelect(first);

  await expect(game).toHaveURL(HOME_URL);
  await expect(game.locator('.webgame-leave-confirm')).toHaveCount(0);
});

test('從上一頁返回登入頁換帳號，其他分頁改用新帳號', async ({ context }) => {
  await setup(context);
  const first = await context.newPage();
  await loginStudent(first);
  const second = await context.newPage();
  await second.goto('Select/index.html');
  await expectVisible(second);

  // 第一個分頁按上一頁回登入頁（保留原本「返回登入頁重新登入」的用法），改登另一位學生。
  await first.goBack();
  await expect(first).toHaveURL(HOME_URL);
  await first.locator('[data-role="student"]').click();
  await first.locator('[data-mode="single"]').click();
  await first.locator('[name="username-0"]').fill('S077');
  await first.locator('[name="password-0"]').fill('pw');
  await first.locator('[name="day-0"]').fill('3');
  await first.locator('#login-form [type="submit"]').click();
  await first.waitForURL(SELECT_URL);

  // 舊分頁不能繼續用舊帳號：回登入頁後自動進入新帳號的 Select。
  await expect.poll(() => sessionSoon(second, 'caseId')).toBe('S77');
  await expect(second).toHaveURL(SELECT_URL);
});

test('一個分頁發現登入失效，其他分頁也一起回登入頁', async ({ context, request }) => {
  await setup(context);
  const first = await context.newPage();
  await loginStudent(first);
  const token = await session(first, 'token');
  await request.get(`/__test/revoke?token=${encodeURIComponent(token)}`);

  const second = await context.newPage();
  await second.goto('Select/index.html');

  await expect(second).toHaveURL(/\/Home\/index\.html\?auth=expired$/);
  await expect(first).toHaveURL(HOME_URL);
  expect(await session(first, 'user_role')).toBeNull();
});

test('從驗證失敗導回的登入頁（?auth=）不自動導向，先顯示提示', async ({ context }) => {
  await setup(context);
  await loginStudent(await context.newPage());

  const second = await context.newPage();
  await second.goto('Home/index.html?auth=retry');

  await expect(second.getByText('無法連線驗證登入')).toBeVisible();
  await expect(second).toHaveURL(/\?auth=retry$/);
});

test('不同瀏覽器（不同 context）不共用登入', async ({ browser }) => {
  const one = await browser.newContext();
  const two = await browser.newContext();
  await setup(one);
  await setup(two);
  await loginStudent(await one.newPage());

  const other = await two.newPage();
  await other.goto('Select/index.html');

  await expect(other).toHaveURL(HOME_URL);
  await one.close();
  await two.close();
});
