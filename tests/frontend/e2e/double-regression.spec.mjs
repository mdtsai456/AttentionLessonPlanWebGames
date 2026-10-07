import { test, expect } from '@playwright/test';
import { STUDENT, loginAs, HOME_URL } from './helpers.mjs';
test('雙人 DAT 缺搭檔 token 時不得啟動', async ({ page }) => {
  await loginAs(page, { ...STUDENT, game_mode: 'double' });
  await page.goto('DAT_double/DAT_double.html');
  await expect(page).toHaveURL(HOME_URL);
});
