// Home 的「登入已失效」等提示，重新選身分或模式後要消失，重新整理也不再出現。
import { test, expect } from '@playwright/test';

const NOTICES = {
  expired: '登入已失效或身分不符，請重新登入。',
  retry: '無法連線驗證登入，請確認網路後重新嘗試登入。',
};

for (const [reason, text] of Object.entries(NOTICES)) {
  test(`?auth=${reason}：選身分後提示消失，網址拿掉 auth`, async ({ page }) => {
    await page.goto(`Home/index.html?auth=${reason}`);
    const notice = page.getByRole('alert').filter({ hasText: text });
    await expect(notice).toBeVisible();

    await page.locator('[data-role="student"]').click();
    await expect(notice).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');

    await page.reload();
    await expect(page.getByText(text)).toHaveCount(0);
  });
}

test('選老師也會清掉提示', async ({ page }) => {
  await page.goto('Home/index.html?auth=expired');
  await page.locator('[data-role="teacher"]').click();
  await expect(page.getByText(NOTICES.expired)).toHaveCount(0);
});
