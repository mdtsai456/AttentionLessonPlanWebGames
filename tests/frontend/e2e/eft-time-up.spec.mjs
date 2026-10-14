// shared/eft-player.js：本關時間到時，還沒作答完的題目顯示「時間到！停止作答」，
// 不顯示答錯、不記錄。QA（10.05 ~ 10.11）漂浮泡泡單人。
// 測試畫面見 eft-harness.mjs。
import { test, expect } from '@playwright/test';
import { openHarness } from './eft-harness.mjs';

const TIME_UP = '時間到！停止作答';

const feedback = (page) => page.locator('[data-ui="feedback"]');
const state = (page) => page.evaluate(() => window.player.getState());
const ended = (page) => page.evaluate(() => window.ended);

// 時間軸（毫秒，從開始算）：每題記憶 1000、作答上限 10000、回饋 1100，每關 60000。
// 不作答時第 1～4 題逾時算錯，第 5 題 48400 出題、49400 進入作答。

test('作答階段被本關時間切斷：顯示時間到、不算錯，停一下才結束本關', async ({ page }) => {
  await openHarness(page);
  await page.clock.runFor(49_500);
  // 第 5 題 49500 作答；第 6 題 50600 出題、51600 進入作答，60000 關卡時間到。
  await page.evaluate(() => window.player.answer('left'));
  await page.clock.runFor(10_550);

  expect((await state(page)).phase).toBe('time_up');
  await expect(feedback(page)).toHaveText(TIME_UP);
  await expect(page.locator('.answer-panel')).not.toHaveAttribute('data-result', 'wrong');
  await expect(page.locator('[data-direction="left"]')).toBeDisabled();
  await expect(page.locator('[data-direction="right"]')).toBeDisabled();
  expect(await ended(page)).toHaveLength(0);

  await page.clock.runFor(1_100);
  const result = await ended(page);
  expect(result).toHaveLength(1);
  expect(result[0].state.index).toBe(5);
  expect(result[0].state.reactionSamples).toHaveLength(5);
});

test('記憶階段被本關時間切斷：同樣顯示時間到、不記錄', async ({ page }) => {
  await openHarness(page);
  await page.clock.runFor(58_300);
  // 第 5 題 58300 作答，回饋到 59400；第 6 題只剩 600 毫秒，還在記憶階段就到時間。
  await page.evaluate(() => window.player.answer('left'));
  await page.clock.runFor(1_750);

  expect((await state(page)).phase).toBe('time_up');
  await expect(feedback(page)).toHaveText(TIME_UP);
  expect(await ended(page)).toHaveLength(0);

  await page.clock.runFor(1_100);
  const result = await ended(page);
  expect(result).toHaveLength(1);
  expect(result[0].state.index).toBe(5);
});

test('時間到的提示期間按鍵不算作答', async ({ page }) => {
  await openHarness(page);
  await page.clock.runFor(49_500);
  await page.evaluate(() => window.player.answer('left'));
  await page.clock.runFor(10_550);
  expect((await state(page)).phase).toBe('time_up');

  await page.keyboard.press('ArrowLeft');
  await page.evaluate(() => window.player.answer('right'));
  const current = await state(page);
  expect(current.index).toBe(5);
  expect(current.phase).toBe('time_up');
});

test('關卡時間還夠時，10 秒未作答仍顯示答錯（不受時間到提示影響）', async ({ page }) => {
  await openHarness(page);
  // 第 1 題 1000 進入作答，11000 逾時。
  await page.clock.runFor(11_050);
  await expect(feedback(page)).toHaveText('10 秒未作答，這題算錯');
  await expect(page.locator('.answer-panel')).toHaveAttribute('data-result', 'wrong');
  expect((await state(page)).index).toBe(1);
});
