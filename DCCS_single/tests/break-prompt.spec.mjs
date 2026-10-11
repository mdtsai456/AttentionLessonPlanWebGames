// 第 3 關後「繼續遊玩／返回遊戲大廳」中場休息的端對端測試（單人與雙人）。
//
// 執行：cd DCCS_single/tests && npm install && npx playwright test
// 預設以 ?sessionSeconds=60 把每關縮成 10 秒；DCCS_FULL_LENGTH=1 時用正式長度（每關 60 秒）。
// 成績 POST 一律由測試攔截，不會打到真的後端。

import { test, expect } from '@playwright/test';
import {
  FULL_SESSION_LEVELS,
  FULL_SESSION_STAGE,
  LEVEL_TIMEOUT,
  drive,
  reachBreak,
  recordNativeDialogs,
  screenshotPath,
  setup,
  stat,
  unloadGuardActive,
} from './helpers.mjs';

// 觀察既有 Track 實例，不變更題目、計時或判定；作答仍透過真正的鍵盤事件。
async function observeTracks(page, mode) {
  // 雙人頁載入的是 DCCS_double 自己那份引擎，要改那一份的 Track 才觀察得到。
  await page.evaluate(async (mode) => {
    const { Track } = await import(`/DCCS_${mode}/js/game/track.js`);
    const render = Track.prototype.render;
    window.testTracks = new Set();
    window.getTestTracks = () => [...window.testTracks].sort((a, b) =>
      a._ctx.canvas.closest('.game-root').id.localeCompare(b._ctx.canvas.closest('.game-root').id));
    Track.prototype.render = function (...args) {
      window.testTracks.add(this);
      return render.apply(this, args);
    };
  }, mode);
  await expect.poll(() => page.evaluate(() => window.testTracks.size))
    .toBe(mode === 'double' ? 2 : 1);

  const elapsed = await page.evaluate(() => window.getTestTracks().map((t) => t.elapsed));
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => window.getTestTracks().map((t) => t.elapsed))).toEqual(elapsed);
}

async function assertPlayable(page, mode) {
  const before = await page.evaluate(() => window.getTestTracks().map((t) => ({
    shape: t._shapePressCount, object: t._objectPressCount, trial: t._currentTrialIndex,
  })));

  await page.keyboard.press('KeyA');
  await page.keyboard.press('KeyD');
  await expect.poll(() => page.evaluate(() => {
    const t = window.getTestTracks()[0];
    return [t._shapePressCount, t._objectPressCount];
  })).toEqual([before[0].shape + 1, before[0].object + 1]);

  if (mode === 'double') {
    // 玩家 1 的 A/D 不應控制到玩家 2。
    expect(await page.evaluate(() => {
      const t = window.getTestTracks()[1];
      return [t._shapePressCount, t._objectPressCount];
    })).toEqual([before[1].shape, before[1].object]);
  }

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  const count = mode === 'double' ? 1 : 2;
  await expect.poll(() => page.evaluate(() => window.getTestTracks().map((t) =>
    [t._shapePressCount, t._objectPressCount]
  ))).toEqual(before.map((t) => [t.shape + count, t.object + count]));

  // 輪盤會完成轉動，並且這題的鍵盤操作確實進入第 4 關的成績記錄。
  await expect.poll(() => page.evaluate((trials) => window.getTestTracks().every((t, i) =>
    t.stats.rows().filter((row) => row.level === 4 && row.trialIndex === trials[i]
      && row.slotsRotated > 0 && Number.isFinite(row.firstInputMs)).length === 2
  ), before.map((t) => t.trial)), { timeout: 10_000 }).toBe(true);
  await page.screenshot({ path: screenshotPath(`dccs-${mode}-verified-play`) });
}

function anyVisible(page, selector) {
  return page.evaluate(
    (selector) => [...document.querySelectorAll(selector)].some((el) => el.checkVisibility()),
    selector
  );
}

test.describe('雙人版 第 3 關後中場休息', () => {
  test('點「繼續遊玩」：共用遮罩關閉、第 4 關正常進行、離開保護恢復', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double');
    await reachBreak(page, 'double');

    await expect(page.locator('#shared-break')).toBeVisible();
    await expect(page.locator('#shared-break')).toContainText('第 3 關已結束');
    await observeTracks(page, 'double');

    await page.locator('#shared-break-continue').click();

    await expect(page.locator('#shared-overlay')).toBeHidden({ timeout: 2000 });
    expect(await anyVisible(page, '.game-root [data-break]')).toBe(false);
    expect(await unloadGuardActive(page)).toBe(true);
    await assertPlayable(page, 'double');

    // 第 4 關確實在跑：時間到會出現「第 4 關結束」。
    await drive(page, 'double', 'level4-clear', LEVEL_TIMEOUT);
    expect(posts).toHaveLength(0);
    expect(pageErrors).toEqual([]);
  });

  test('空白鍵選繼續：結果和點擊相同', async ({ page }) => {
    const { pageErrors } = await setup(page, 'double');
    await reachBreak(page, 'double');

    // 進入畫面時若空白鍵已按著，要放開再按；這裡是全新的一次按鍵。
    await page.keyboard.press('Space');

    await expect(page.locator('#shared-overlay')).toBeHidden({ timeout: 2000 });
    expect(await unloadGuardActive(page)).toBe(true);
    await drive(page, 'double', 'level4-clear', LEVEL_TIMEOUT);
    expect(pageErrors).toEqual([]);
  });

  test('選「繼續遊玩」後打完全場：兩位玩家都送出全場成績並回到大廳', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double');
    await reachBreak(page, 'double');
    await page.locator('#shared-break-continue').click();
    await expect(page.locator('#shared-overlay')).toBeHidden({ timeout: 2000 });

    // 若離開保護在結束時沒解除，導頁會跳出瀏覽器的離開詢問。
    const dialogs = recordNativeDialogs(page);

    await drive(page, 'double', 'session-end', 3 * LEVEL_TIMEOUT + 15_000);
    await page.waitForURL(/\/Select\/index\.html/);

    expect(dialogs).toEqual([]);
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.data.caseId).sort()).toEqual(['T01', 'T02']);
    for (const payload of posts) {
      expect(payload.data.mode).toBe('double');
      expect(stat(payload, 'stage')).toBe(FULL_SESSION_STAGE);
      expect(stat(payload, 'levelsPlayed')).toBe(FULL_SESSION_LEVELS);
    }
    expect(posts[0].data.pairId).toBe(posts[1].data.pairId);
    expect(pageErrors).toEqual([]);
  });

  test('點「返回遊戲大廳」：立即顯示送出中畫面、連點只送一次、送完回大廳', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double', { delayMs: 3000 });
    await reachBreak(page, 'double');
    // 中場「返回遊戲大廳」是明確的選擇：不再問要不要離開，也不能跳出瀏覽器的離開詢問。
    const dialogs = recordNativeDialogs(page);

    const lobby = page.locator('#shared-break-lobby');
    const box = await lobby.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.click(x, y);
    await page.mouse.click(x, y);
    await page.mouse.click(x, y);

    const loading = page.locator('#shared-loading');
    await expect(loading).toBeVisible();
    await expect(loading.locator('h1')).toHaveText('正在送出成績…');
    await expect(loading.locator('p')).toHaveText('完成後會自動返回遊戲大廳');
    await expect(page.locator('#shared-break')).toBeHidden();
    await page.screenshot({ path: screenshotPath('dccs-double-verified-submitting') });

    // 送出中按空白鍵不應有任何作用。
    await page.keyboard.press('Space');
    await expect(loading).toBeVisible();

    await page.waitForURL(/\/Select\/index\.html/, { timeout: 15_000 });

    expect(dialogs).toEqual([]);
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.data.caseId).sort()).toEqual(['T01', 'T02']);
    for (const payload of posts) {
      expect(payload.data.mode).toBe('double');
      expect(stat(payload, 'stage')).toBe(3);
      // 第 4 關的題目不應被記錄進來。
      expect(stat(payload, 'levelsPlayed')).toBe('1,2,3');
    }
    expect(pageErrors).toEqual([]);
  });

  test('返回大廳但後端失敗：成績暫存在本機，仍會回大廳', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double', { fail: true });
    await reachBreak(page, 'double');

    await page.locator('#shared-break-lobby').click();
    await page.waitForURL(/\/Select\/index\.html/, { timeout: 15_000 });

    expect(posts).toHaveLength(2);
    const pendingKeys = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('dccs_pending_'))
    );
    expect(pendingKeys).toHaveLength(2);
    expect(pageErrors).toEqual([]);
  });

  test('後端一直不回應：15 秒後暫存兩筆成績並回大廳', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'double', { hang: true });
    await reachBreak(page, 'double');
    await page.locator('#shared-break-lobby').click();
    await expect(page.locator('#shared-loading')).toBeVisible();
    await page.waitForURL(/\/Select\/index\.html/, { timeout: 20_000 });
    expect(posts).toHaveLength(2);
    const pending = await page.evaluate(() => Object.keys(localStorage)
      .filter((key) => key.startsWith('dccs_pending_'))
      .map((key) => JSON.parse(localStorage.getItem(key))));
    expect(pending.map((p) => p.data.caseId).sort()).toEqual(['T01', 'T02']);
    expect(pending.every((p) => p.data.mode === 'double' && stat(p, 'stage') === 3)).toBe(true);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('單人版 第 3 關後中場休息（回歸）', () => {
  test('點「繼續遊玩」：第 4 關正常進行、離開保護恢復', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single');
    await reachBreak(page, 'single');
    await observeTracks(page, 'single');

    await page.locator('[data-break="continue"]').click();

    await expect.poll(() => anyVisible(page, '[data-break]'), { timeout: 2000 }).toBe(false);
    expect(await unloadGuardActive(page)).toBe(true);
    await assertPlayable(page, 'single');
    await drive(page, 'single', 'level4-clear', LEVEL_TIMEOUT);
    expect(posts).toHaveLength(0);
    expect(pageErrors).toEqual([]);
  });

  test('空白鍵選繼續（按鈕預設聚焦在「繼續遊玩」）', async ({ page }) => {
    const { pageErrors } = await setup(page, 'single');
    await reachBreak(page, 'single');

    await page.keyboard.press('Space');

    await expect.poll(() => anyVisible(page, '[data-break]'), { timeout: 2000 }).toBe(false);
    expect(await unloadGuardActive(page)).toBe(true);
    await drive(page, 'single', 'level4-clear', LEVEL_TIMEOUT);
    expect(pageErrors).toEqual([]);
  });

  test('選「繼續遊玩」後打完全場：送出全場成績並回到大廳', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single');
    await reachBreak(page, 'single');
    await page.locator('[data-break="continue"]').click();

    const dialogs = recordNativeDialogs(page);

    await drive(page, 'single', 'session-end', 3 * LEVEL_TIMEOUT + 15_000);
    await page.waitForURL(/\/Select\/index\.html/);

    expect(dialogs).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(posts[0].data.mode).toBe('single');
    expect(stat(posts[0], 'stage')).toBe(FULL_SESSION_STAGE);
    expect(stat(posts[0], 'levelsPlayed')).toBe(FULL_SESSION_LEVELS);
    expect(pageErrors).toEqual([]);
  });

  test('點「返回遊戲大廳」：送出 3 關成績並回到大廳', async ({ page }) => {
    const { posts, pageErrors } = await setup(page, 'single');
    await reachBreak(page, 'single');
    const dialogs = recordNativeDialogs(page);

    await page.locator('[data-break="lobby"]').click();
    await page.waitForURL(/\/Select\/index\.html/, { timeout: 15_000 });

    expect(dialogs).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(stat(posts[0], 'stage')).toBe(3);
    expect(stat(posts[0], 'levelsPlayed')).toBe('1,2,3');
    expect(pageErrors).toEqual([]);
  });
});
