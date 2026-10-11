import { test, expect } from '@playwright/test';
import { STUDENT, DOUBLE, TEACHER, HOME_URL, loginAs } from './helpers.mjs';
// 舊網址轉址。repo 根目錄的 frontend/ 已在 PR #22（1e1162b）整個移除，
// 靜態部署不再提供 frontend/*.html 轉址頁；舊的 /app/... 網址改由後端
// main.py 的 _LEGACY_REDIRECTS 處理，見 backend/tests/test_legacy_redirects.py。
// 這裡只剩仍以靜態轉址頁存在的 backend/demo/index.html。
const redirects = {
  'backend/demo/index.html': 'Teacher_platform/index.html',
};
for (const [old, current] of Object.entries(redirects)) {
  test(`${old} 轉新版且未登入回 Home`, async ({ page }) => {
    await page.goto(old);
    await expect(page).toHaveURL(HOME_URL);
  });
  test(`${old} 合法登入轉至 ${current}`, async ({ page }) => {
    const session = current.startsWith('Teacher_platform/') ? TEACHER : current.includes('double') ? DOUBLE : STUDENT;
    await loginAs(page, session);
    await page.goto(old);
    await expect(page).toHaveURL((url) => url.pathname === '/' + current);
  });
}
