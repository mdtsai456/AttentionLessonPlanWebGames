import { test, expect } from '@playwright/test';
import { GUARDED_PAGES, DOUBLE_PAGES } from '../site.mjs';
import { STUDENT, DOUBLE, TEACHER, HOME_URL, loginAs, recordWrites } from './helpers.mjs';
const all = [...GUARDED_PAGES, ...DOUBLE_PAGES, 'Back/index.html'];
for (const pagePath of all) {
  const teacher = pagePath.startsWith('Back/');
  const session = teacher ? TEACHER : DOUBLE_PAGES.includes(pagePath) ? DOUBLE : STUDENT;
  const scenarios = [
    ['未登入', {}],
    ['殘留資料無 token', { ...session, token: '', student1_token: '', student2_token: '' }],
    ['撤銷 token', session],
    ...(!teacher ? [['學生身分不符', { ...session, student1_school: 'OTHER' }]] : []),
    ['缺少角色', { ...session, user_role: '' }],
    ['假 token', { ...session, token: 'fake', student1_token: 'fake' }],
    ['過期 token', { ...session, token: 'expired', student1_token: 'expired' }],
    ['冒用角色', teacher ? { ...TEACHER, token: 'student-token' } : { ...session, token: 'teacher-token', student1_token: 'teacher-token' }],
  ];
  for (const [label, state] of scenarios) {
    test(`${pagePath} ${label} 不啟動功能腳本`, async ({ page, request }) => {
      const scripts = [], writes = await recordWrites(page);
      page.on('request', (req) => { if (/\.(?:m?js)(?:\?|$)/.test(req.url())) scripts.push(req.url()); });
      await loginAs(page, state);
      if (label === '撤銷 token') {
        const token = await page.evaluate(() => sessionStorage.getItem('student2_token') || sessionStorage.getItem('token'));
        await request.get(`/__test/revoke?token=${encodeURIComponent(token)}`);
      }
      scripts.length = 0;
      await page.goto(pagePath);
      await expect(page).toHaveURL(HOME_URL);
      const functional = scripts.filter((url) => !/\/Home\/|\/shared\/(?:require-student|api|session-timeout)\.js/.test(url));
      expect(functional).toEqual([]);
      expect(writes).toEqual([]);
    });
  }
  test(`${pagePath} 正常登入顯示`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await loginAs(page, session);
    await page.goto(pagePath);
    await expect.poll(() => page.evaluate(() => !!window.WebGameAuth?.active)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('script[type="application/x-webgame-script"]').length)).toBe(0);
    expect(new URL(page.url()).pathname).toBe('/' + pagePath);
    expect(errors).toEqual([]);
  });
}
for (const pagePath of DOUBLE_PAGES) {
  for (const [label, change] of [
    ['缺主要 token', { student1_token: '', token: '' }],
    ['缺搭檔 token', { student2_token: '' }],
    ['搭檔 token 無效', { student2_token: 'fake' }],
    ['搭檔身分不符', { student2_school: 'OTHER' }],
    ['殘留學生欄位', { student1_case: 'OTHER' }],
  ]) {
    test(`${pagePath} ${label}`, async ({ page }) => {
      await loginAs(page, { ...DOUBLE, ...change });
      await page.goto(pagePath);
      await expect(page).toHaveURL(HOME_URL);
    });
  }
}
for (const token of ['offline', 'slow']) {
  test(`${token} 驗證失敗顯示重試提示並保留登入`, async ({ page }) => {
    await loginAs(page, { ...STUDENT, token, student1_token: token });
    await page.goto('DAT_single/DAT_single.html');
    await expect(page).toHaveURL(HOME_URL, { timeout: 8000 });
    await expect(page.getByRole('alert').filter({ hasText: '重新嘗試登入' })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('student1_token'))).toContain(token);
  });
}

for (const path of [...GUARDED_PAGES.filter((path) => !path.startsWith('Select/')), ...DOUBLE_PAGES]) {
  test(`${path} 合法登入進錯模式回選單`, async ({ page }) => {
    const doublePage = DOUBLE_PAGES.includes(path);
    await loginAs(page, doublePage ? STUDENT : DOUBLE);
    await page.goto(path);
    await expect(page).toHaveURL(path === 'DCCS/index.html' ? /DCCS\/double.html$/ : /Select\/index.html$/);
    expect(await page.evaluate(() => sessionStorage.getItem('user_role'))).toBe('student');
  });
}
