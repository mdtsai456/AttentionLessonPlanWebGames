import { test, expect } from '@playwright/test';
import { STUDENT, loginAs, recordWrites, HOME_URL } from './helpers.mjs';
async function ready(page) {
  await loginAs(page, STUDENT);
  await page.goto('Select/index.html');
  await expect.poll(() => page.evaluate(() => !!window.WebGameAuth?.active && !!window.WebGameApi)).toBe(true);
  await page.evaluate(async () => { window.outbox = await import('/DCCS/js/net/client.js'); });
}
test('DCCS 僅重送目前學生資料，其他人紀錄保留，暫存沒有 token', async ({ page }) => {
  const writes = await recordWrites(page);
  await ready(page);
  const result = await page.evaluate(async () => {
    localStorage.clear();
    const mine = { lessonId: 'DCCS', data: { grade: 'G9', caseId: 'S99', school: 'TEST', mode: 'single' } };
    const other = { ...mine, data: { ...mine.data, caseId: 'OTHER' } };
    localStorage.setItem('dccs_pending_1', JSON.stringify(other));
    localStorage.setItem('dccs_pending_2', JSON.stringify(mine));
    const results = await Promise.all([outbox.flushPendingResults(), outbox.flushPendingResults()]);
    return results[0];
  });
  expect(result).toEqual({ attempted: 1, sent: 1, failed: 0, rejected: 0 });
  expect(writes).toHaveLength(1);
  expect(writes[0].headers.authorization).toMatch(/^Bearer student-token\./);
  expect(await page.evaluate(() => localStorage.getItem('dccs_pending_1'))).not.toContain('token');
  expect(await page.evaluate(() => localStorage.getItem('dccs_pending_2'))).toBeNull();
});
test('DCCS 登入失效不把待送成績移至永久拒絕區', async ({ page }) => {
  await ready(page);
  await page.route('**/api/sessions', (route) => route.fulfill({ status: 401, body: '{"detail":"請重新登入"}', contentType: 'application/json' }));
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem('dccs_pending_1', JSON.stringify({ lessonId: 'DCCS', data: { grade: 'G9', caseId: 'S99', school: 'TEST', mode: 'single' } }));
    await outbox.flushPendingResults();
  }).catch(() => {}); // location.replace 可能先於 evaluate 回傳。
  await expect(page).toHaveURL(HOME_URL);
  expect(await page.evaluate(() => localStorage.getItem('dccs_pending_1'))).not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('dccs_rejected_1'))).toBeNull();
});
