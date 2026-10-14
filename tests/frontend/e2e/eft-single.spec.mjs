// 漂浮泡泡單人：彈窗內的 Tab 焦點循環、第 3 關檢查點的成績範圍。
import { test, expect } from '@playwright/test';
import { STUDENT, loginAs, recordWrites } from './helpers.mjs';

const ASSET_HOST = 'https://attention-lesson-plan-assets.zeabur.app/**';
const STAGE_RUN_MS = 65_000;

// 按「離開」先在頁面內確認（第 41 項）：取消什麼都不送，確定才存檔並回大廳。
const leaveDialog = (page) => page.getByRole('dialog', { name: '確定要離開嗎？' });
// 記下瀏覽器原生的對話框；確定離開時不可再跳出「離開網站？」。
function watchNativeDialogs(page) {
  const seen = [];
  page.on('dialog', (dialog) => {
    seen.push(dialog.type());
    dialog.dismiss().catch(() => {});
  });
  return seen;
}
async function leaveAndConfirm(page) {
  await page.click('#leave-btn');
  await leaveDialog(page).getByRole('button', { name: '離開', exact: true }).click();
  await page.waitForURL('**/Select/index.html');
}
const sessionsOf = (writes) => writes.filter((request) => /\/api\/sessions$/.test(request.url));
const stat = (body, name) => body.data.stats.find((item) => item.apiname === name)?.value;

async function openSingle(page, { clock = false } = {}) {
  const writes = await recordWrites(page);
  await page.route(ASSET_HOST, (route) => route.fulfill({ status: 404, body: '' }));
  await loginAs(page, STUDENT);
  if (clock) await page.clock.install();
  await page.goto('EFT_single/EFT_single.html');
  await expect(page.locator('#bubble-field .bubble')).toHaveCount(3);
  return writes;
}

const focusedId = (page) => page.evaluate(() => document.activeElement?.id);

test('#29 中場彈窗內 Tab / Shift+Tab 在兩顆按鈕間循環', async ({ page }) => {
  await openSingle(page);
  await page.evaluate(() => window.EFTSingle.showMidBreak());
  await expect(page.locator('#mid-break-modal')).toBeVisible();
  expect(await focusedId(page)).toBe('btn-continue');
  await page.keyboard.press('Tab');
  expect(await focusedId(page)).toBe('btn-lobby');
  await page.keyboard.press('Tab');
  expect(await focusedId(page)).toBe('btn-continue');
  await page.keyboard.press('Shift+Tab');
  expect(await focusedId(page)).toBe('btn-lobby');
  await page.keyboard.press('Shift+Tab');
  expect(await focusedId(page)).toBe('btn-continue');
});

test('#29 結果彈窗內 Tab 可以到「返回遊戲大廳」', async ({ page }) => {
  await openSingle(page);
  await page.evaluate(() => window.EFTSingle.finishGame());
  await expect(page.locator('#results')).toBeVisible();
  expect(await focusedId(page)).toBe('restart');
  await page.keyboard.press('Tab');
  expect(await focusedId(page)).toBe('btn-lobby-finish');
  await page.keyboard.press('Tab');
  expect(await focusedId(page)).toBe('restart');
  await page.keyboard.press('Shift+Tab');
  expect(await focusedId(page)).toBe('btn-lobby-finish');
});

async function playToMidBreak(page) {
  for (let stage = 1; stage <= 3; stage++) {
    await page.clock.runFor(STAGE_RUN_MS);
    if (stage < 3) await page.click('.shared-stage-clear-btn');
  }
  await expect(page.locator('#mid-break-modal')).toBeVisible();
}

test('#41 離開→繼續遊戲什麼都不送、遊戲照常；再離開並確定才送第 3 關後回大廳', async ({ page }) => {
  const writes = await openSingle(page, { clock: true });
  const nativeDialogs = watchNativeDialogs(page);
  await playToMidBreak(page);
  await page.click('#btn-continue');
  await page.clock.runFor(10_000);

  await page.click('#leave-btn');
  await expect(leaveDialog(page)).toBeVisible();
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(true);
  // 確認框開著時本關時間不走。
  const frozen = await page.locator('#round').textContent();
  await page.clock.runFor(10_000);
  await expect(page.locator('#round')).toHaveText(frozen);
  await leaveDialog(page).getByRole('button', { name: '繼續遊戲', exact: true }).click();
  await expect(leaveDialog(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(sessionsOf(writes)).toHaveLength(0);
  expect(new URL(page.url()).pathname).toBe('/EFT_single/EFT_single.html');
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(false);
  await expect(page.locator('#leave-btn')).toBeEnabled();
  // 取消後第 4 關照常進行。
  await page.clock.runFor(10_000);
  await expect(page.locator('#round')).not.toHaveText(frozen);

  await leaveAndConfirm(page);
  expect(sessionsOf(writes).map((request) => stat(request.body, 'EFT_stage'))).toEqual([3]);
  expect(nativeDialogs).toEqual([]);
});

// 單人版中場彈窗蓋住「離開」，這裡直接呼叫 leaveGame，確認遊戲自己的彈窗 Tab 循環不會跟確認框搶焦點。
test('#41 中場彈窗開著時叫出離開確認：Tab 在確認框內循環，Esc 取消後回到中場彈窗', async ({ page }) => {
  const writes = await openSingle(page, { clock: true });
  await playToMidBreak(page);
  await page.evaluate(() => { void window.EFTSingle.leaveGame(); });
  await expect(leaveDialog(page)).toBeVisible();
  await expect(leaveDialog(page).getByRole('button', { name: '繼續遊戲', exact: true })).toBeFocused();
  // 遊戲自己的彈窗 Tab 循環不可搶走焦點。
  await page.keyboard.press('Tab');
  await expect(leaveDialog(page).getByRole('button', { name: '離開', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(leaveDialog(page).getByRole('button', { name: '繼續遊戲', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(leaveDialog(page)).toHaveCount(0);
  await expect(page.locator('#mid-break-modal')).toBeVisible();
  await page.waitForTimeout(300);
  expect(sessionsOf(writes)).toHaveLength(0);
});

test('#41 中場「返回遊戲大廳」不用確認，送第 3 關後直接回大廳', async ({ page }) => {
  const writes = await openSingle(page, { clock: true });
  const nativeDialogs = watchNativeDialogs(page);
  await playToMidBreak(page);
  await page.click('#btn-lobby');
  await page.waitForURL('**/Select/index.html');
  expect(sessionsOf(writes).map((request) => stat(request.body, 'EFT_stage'))).toEqual([3]);
  expect(nativeDialogs).toEqual([]);
});

test('#10 第 4 關中途離開，第 3 關檢查點只含前 3 關的資料', async ({ page }) => {
  const writes = await openSingle(page, { clock: true });
  for (let stage = 1; stage <= 3; stage++) {
    await page.clock.runFor(STAGE_RUN_MS);
    if (stage < 3) {
      await expect(page.locator('.shared-stage-clear')).toBeVisible();
      await page.click('.shared-stage-clear-btn');
    }
  }
  await expect(page.locator('#mid-break-modal')).toBeVisible();
  await page.click('#btn-continue');
  // 第 4 關再跑 30 秒：多 2 題逾時算錯。
  await page.clock.runFor(30_000);
  await leaveAndConfirm(page);
  expect(sessionsOf(writes)).toHaveLength(1);
  const body = sessionsOf(writes)[0].body;
  expect(stat(body, 'EFT_stage')).toBe(3);
  expect(stat(body, 'EFT_questionCount')).toBe(15);
  expect(stat(body, 'EFT_wrong')).toBe(15);
  expect(stat(body, 'EFT_levelAccuracy')).toBe('0,0,0');
  expect(stat(body, 'EFT_duration')).toBeLessThan(3 * STAGE_RUN_MS);
  // R8：endTime 也停在第 3 關結束當下，endTime − startTime 要等於時長（不含中場與第 4 關的 30 秒）。
  expect(Math.abs(body.data.endTime - body.data.startTime - stat(body, 'EFT_duration'))).toBeLessThan(1000);
});

test('#10 中場按返回大廳送的第 3 關成績不含中場等待時間', async ({ page }) => {
  const writes = await openSingle(page, { clock: true });
  for (let stage = 1; stage <= 3; stage++) {
    await page.clock.runFor(STAGE_RUN_MS);
    if (stage < 3) await page.click('.shared-stage-clear-btn');
  }
  await expect(page.locator('#mid-break-modal')).toBeVisible();
  // 中場停留 60 秒再回大廳。
  await page.clock.runFor(60_000);
  await page.click('#btn-lobby');
  await expect.poll(() => sessionsOf(writes).length).toBe(1);
  const body = sessionsOf(writes)[0].body;
  expect(stat(body, 'EFT_questionCount')).toBe(15);
  expect(stat(body, 'EFT_duration')).toBeLessThan(3 * STAGE_RUN_MS);
  // R8：endTime 也不含中場的 60 秒。
  expect(Math.abs(body.data.endTime - body.data.startTime - stat(body, 'EFT_duration'))).toBeLessThan(1000);
});

/** 存檔請求先卡住，回傳放行用的函式。 */
async function holdSessionSaves(page) {
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/sessions', async (route) => {
    await released;
    await route.fallback();
  });
  return release;
}

test('R3 確定離開後存檔還在路上：方向鍵與按鈕都不算作答，分數不變', async ({ page }) => {
  const writes = await openSingle(page, { clock: true });
  await playToMidBreak(page);
  await page.click('#btn-continue');
  // 第 4 關第 1 題：記憶 1 秒後進入作答。
  await page.clock.runFor(1_200);
  await expect(page.locator('#feedback')).toHaveText('回答剛才位置的泡泡');
  const release = await holdSessionSaves(page);
  await page.click('#leave-btn');
  await leaveDialog(page).getByRole('button', { name: '離開', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.WebGameRuntime.paused)).toBe(true);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.locator('[data-direction="left"]').dispatchEvent('click');
  await expect(page.locator('#feedback')).toHaveText('回答剛才位置的泡泡');
  await expect(page.locator('#score')).toHaveText('0 分');
  expect(await page.locator('.answer-panel').getAttribute('data-result')).toBeNull();
  release();
  await page.waitForURL('**/Select/index.html');
  expect(sessionsOf(writes).map((request) => stat(request.body, 'EFT_stage'))).toEqual([3]);
});
