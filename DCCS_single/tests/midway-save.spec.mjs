// 到中場就先送第 3 關成績：之後直接關掉頁面，前三關也已經在後端。
// 同一局的第 3 關與全場成績共用 submissionId，後端用較高關卡更新同一列。
//
// 執行：cd DCCS_single/tests && npx playwright test midway-save

import { test, expect } from '@playwright/test';
import {
  LEVEL_SECONDS,
  LEVEL_TIMEOUT,
  SUBMIT_PATH,
  answerLeave,
  drive,
  pendingResults,
  reachBreak,
  setup,
  stat,
} from './helpers.mjs';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test.describe('單人版 中場先送第 3 關', () => {
  test('一進中場就送出第 3 關，不用按任何按鈕；關掉頁面也不會再少', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single');
    await reachBreak(page, 'single');

    await expect.poll(() => posts.length).toBe(1);
    expect(stat(posts[0], 'stage')).toBe(3);
    expect(stat(posts[0], 'levelsPlayed')).toBe('1,2,3');
    expect(posts[0].data.submissionId).toMatch(V4);
    expect(pageErrors).toEqual([]);
    await page.close();
    expect(posts).toHaveLength(1);
  });

  test('中場已送好，第 4 關離開不重送', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single');
    await reachBreak(page, 'single');
    await expect.poll(() => posts.length).toBe(1);
    await page.locator('[data-break="continue"]').click();
    await expect.poll(() => page.locator('[data-break]').evaluateAll(
      (nodes) => nodes.some((node) => node.checkVisibility())
    )).toBe(false);

    await page.locator('#leave-btn').click();
    await answerLeave(page, 'leave');
    await expect(page).toHaveURL(/\/Select\/index\.html/, { timeout: 15_000 });
    expect(posts).toHaveLength(1);
    expect(pageErrors).toEqual([]);
  });

  // DCCS_duration 是遊戲時鐘算的遊玩時間（2026-10-20 起）：含關卡提示與中場休息，只扣暫停。
  test('沒中斷的一局：endTime − startTime 和 DCCS_duration 相差 1 秒內，中場檢查點算到第 3 關結束', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single');
    await reachBreak(page, 'single');
    const breakSeenAt = Date.now();
    await expect.poll(() => posts.length).toBe(1);
    const midway = posts[0];
    expect(Math.abs(midway.data.endTime - breakSeenAt)).toBeLessThan(1000);
    expect(Math.abs(midway.data.endTime - midway.data.startTime - stat(midway, 'duration'))).toBeLessThan(1000);

    // 中場休息停留的時間也算遊玩時間。
    await page.waitForTimeout(3000);
    await page.locator('[data-break="continue"]').click();
    await drive(page, 'single', 'session-end', 3 * LEVEL_TIMEOUT + 15_000);
    await page.waitForURL(/\/Select\/index\.html/);

    expect(posts).toHaveLength(2);
    const final = posts[1];
    expect(stat(final, 'stage')).toBe(6);
    expect(Math.abs(final.data.endTime - final.data.startTime - stat(final, 'duration'))).toBeLessThan(1000);
    // 賽道整場固定 6 關的時間；多出來的是關卡提示、過關畫面與中場休息。
    expect(stat(final, 'duration')).toBeGreaterThan(6 * LEVEL_SECONDS * 1000 + 3000);
    expect(pageErrors).toEqual([]);
  });

  test('中場那次送失敗：存到本機等下次開遊戲時重送，帶著這一局的 submissionId', async ({ page }) => {
    await setup(page, 'single');
    // 第一次送出（中場那筆）斷線，之後照常。
    let calls = 0;
    await page.route(`**${SUBMIT_PATH}`, async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.abort();
        return;
      }
      await route.fallback();
    });
    await reachBreak(page, 'single');
    await expect.poll(() => pendingResults(page).then((list) => list.length)).toBe(1);
    const [pending] = await pendingResults(page);
    expect(stat(pending, 'stage')).toBe(3);
    expect(pending.data.submissionId).toMatch(V4);
  });
});

test.describe('雙人版 中場先送第 3 關', () => {
  test('兩位玩家一進中場就各送一筆第 3 關，各自的 submissionId', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double');
    await reachBreak(page, 'double');

    await expect.poll(() => posts.length).toBe(2);
    expect(posts.map((p) => p.data.caseId).sort()).toEqual(['T01', 'T02']);
    for (const payload of posts) {
      expect(stat(payload, 'stage')).toBe(3);
      expect(payload.data.mode).toBe('double');
      expect(payload.data.submissionId).toMatch(V4);
    }
    expect(posts[0].data.pairId).toBe(posts[1].data.pairId);
    expect(posts[0].data.submissionId).not.toBe(posts[1].data.submissionId);
    expect(pageErrors).toEqual([]);
  });

  test('中場按「返回遊戲大廳」不重送已送的第 3 關', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double');
    await reachBreak(page, 'double');
    await expect.poll(() => posts.length).toBe(2);

    await page.locator('#shared-break-lobby').click();
    await expect(page).toHaveURL(/\/Select\/index\.html/, { timeout: 15_000 });
    expect(posts).toHaveLength(2);
    expect(pageErrors).toEqual([]);
  });
});
