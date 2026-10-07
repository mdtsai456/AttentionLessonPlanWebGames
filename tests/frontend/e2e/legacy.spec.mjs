import { test, expect } from '@playwright/test';
import { STUDENT, DOUBLE, TEACHER, HOME_URL, loginAs } from './helpers.mjs';
const redirects = {
  'frontend/index.html': 'Home/index.html',
  'frontend/dms.html': 'Back/index.html',
  'frontend/games.html': 'Select/index.html',
  'frontend/dccs/index.html': 'DCCS/index.html',
  'frontend/dccs/double.html': 'DCCS/double.html',
  'frontend/DAT_single/DAT_single.html': 'DAT_single/DAT_single.html',
  'frontend/DAT_single/DAT_tutorial.html': 'tutorial/DAT_tutorial.html',
  'frontend/DAT_double/DAT_double.html': 'DAT_double/DAT_double.html',
  'frontend/EFT_single/EFT_single.html': 'EFT_single/EFT_single.html',
  'frontend/EFT_double/EFT_double.html': 'EFT_double/EFT_double.html',
  'frontend/bubblegame/index.html': 'Select/index.html',
  'backend/demo/index.html': 'Back/index.html',
};
for (const [old, current] of Object.entries(redirects)) {
  test(`${old} 轉新版且未登入回 Home`, async ({ page }) => {
    await page.goto(old);
    await expect(page).toHaveURL(HOME_URL);
  });
  test(`${old} 合法登入轉至 ${current}`, async ({ page }) => {
    const session = current.startsWith('Back/') ? TEACHER : current.includes('double') ? DOUBLE : STUDENT;
    await loginAs(page, session);
    await page.goto(old);
    await expect(page).toHaveURL((url) => url.pathname === '/' + current);
  });
}
