// shared/eft-player.js：本關時間切斷的題目不計分。
// 測試畫面見 eft-harness.mjs。
import { test, expect } from '@playwright/test';
import { openHarness } from './eft-harness.mjs';

// 時間軸（毫秒，從開始算）：每題記憶 1000、作答上限 10000、回饋 1100。
// 不作答時第 1～4 題在 0、12100、24200、36300 出題並逾時算錯；第 5 題 48400 出題、49400 進入作答。
test('#14 剩不到 1 秒才出的題，在記憶階段就被本關時間切斷，不記錄', async ({ page }) => {
  await openHarness(page);
  await page.clock.runFor(58_300);
  // 第 5 題在 58300 作答，回饋到 59400；第 6 題只剩 600 毫秒，看不到作答畫面。
  await page.evaluate(() => window.player.answer('left'));
  await page.clock.runFor(1_300);
  expect(await page.evaluate(() => window.player.getState().phase)).toBe('memory');
  await page.clock.runFor(2_000);
  const ended = await page.evaluate(() => window.ended);
  expect(ended).toHaveLength(1);
  expect(ended[0].stage).toBe(1);
  expect(ended[0].state.index).toBe(5);
  expect(ended[0].state.reactionSamples).toHaveLength(5);
  expect(ended[0].state.reactionSamples).not.toContain(0);
});

test('#14 作答階段被本關時間切斷（不滿 10 秒）也不記錄', async ({ page }) => {
  await openHarness(page);
  await page.clock.runFor(49_500);
  // 第 5 題 49500 作答；第 6 題 50600 出題、51600 進入作答，只剩 8.4 秒。
  await page.evaluate(() => window.player.answer('left'));
  await page.clock.runFor(2_200);
  expect(await page.evaluate(() => window.player.getState().phase)).toBe('answer');
  await page.clock.runFor(10_000);
  const ended = await page.evaluate(() => window.ended);
  expect(ended).toHaveLength(1);
  expect(ended[0].state.index).toBe(5);
  expect(ended[0].state.reactionSamples).toHaveLength(5);
  // 被切斷的題目也不影響連擊與箭頭階數。
  expect(ended[0].state.levelAccuracies[0]).toBe(ended[0].state.score / 5);
});

test('#14 10 秒內完全沒作答仍算錯', async ({ page }) => {
  await openHarness(page);
  await page.clock.runFor(61_000);
  const ended = await page.evaluate(() => window.ended);
  expect(ended).toHaveLength(1);
  expect(ended[0].state.index).toBe(5);
  expect(ended[0].state.score).toBe(0);
  expect(ended[0].state.reactionSamples).toEqual([10000, 10000, 10000, 10000, 10000]);
});

test('一題都還沒作答時，成績的錯題數是 0（不是 1）', async ({ page }) => {
  await openHarness(page);
  const stats = await page.evaluate(() => window.player.checkpointStats(3));
  expect(stats.questionCount).toBe(0);
  expect(stats.score).toBe(0);
  expect(stats.wrong).toBe(0);
});

test('R3 遊戲暫停時（例如確定離開、存檔中）按鈕與 answer() 都不算作答；恢復後照常', async ({ page }) => {
  await openHarness(page);
  await page.clock.runFor(1_100);
  expect(await page.evaluate(() => window.player.getState().phase)).toBe('answer');
  await page.evaluate(() => window.WebGameRuntime.pause('leave-confirm'));
  await page.locator('[data-direction="left"]').click();
  await page.evaluate(() => window.player.answer('right'));
  let state = await page.evaluate(() => window.player.getState());
  expect(state.index).toBe(0);
  expect(state.phase).toBe('answer');
  await page.evaluate(() => window.WebGameRuntime.resume('leave-confirm'));
  await page.locator('[data-direction="left"]').click();
  state = await page.evaluate(() => window.player.getState());
  expect(state.index).toBe(1);
});
