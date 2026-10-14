// 第 3 關後中場休息畫面的 E2E 測試，涵蓋單人與雙人模式。
//
// 執行：cd DCCS_single/tests && npm install && npx playwright test
// 預設使用 ?sessionSeconds=60，將每關縮短為 10 秒。DCCS_FULL_LENGTH=1 時，每關使用正式長度 60 秒。
// 測試攔截所有成績 POST 請求，不連線至正式後端。

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FULL_LENGTH = process.env.DCCS_FULL_LENGTH === '1';
const LEVEL_SECONDS = FULL_LENGTH ? 60 : 10;
const QUERY = FULL_LENGTH ? '' : '?sessionSeconds=60';
const SUBMIT_PATH = '/__test__/api/sessions';
const screenshotPath = (name) => fileURLToPath(new URL(`../../.context/${name}.png`, import.meta.url));

// 等待時間包含關卡時長與題目離場時間。主機忙碌時，影格更新較慢，遊戲時間可能落後實際時間。
const LEVEL_TIMEOUT = (LEVEL_SECONDS * 2 + 30) * 1000;

/**
 * 寫入大廳登入資料，並把成績送出位址改到可攔截的同源路徑。
 * @param {import('@playwright/test').Page} page
 * @param {'single' | 'double'} mode
 * @param {{delayMs?: number, fail?: boolean, hang?: boolean}} [submitOptions]
 */
async function setup(page, mode, submitOptions = {}) {
  const posts = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.addInitScript(({ mode, submitPath }) => {
    const s = window.sessionStorage;
    if (mode === 'double') s.setItem('game_mode', 'double');
    else s.removeItem('game_mode');
    s.setItem('school', 'TEST');
    s.setItem('student1_case', 'T01');
    s.setItem('student1_grade', 'G1');
    s.setItem('student1_day', '1');
    s.setItem('student1_token', 'dummy');
    if (mode === 'double') {
      s.setItem('student2_case', 'T02');
      s.setItem('student2_grade', 'G1');
      s.setItem('student2_day', '1');
      s.setItem('student2_token', 'dummy');
    }
    s.setItem('login_expires_at', String(Date.now() + 3600e3));
    window.DCCS_SUBMIT_URL = submitPath;
  }, { mode, submitPath: SUBMIT_PATH });

  await page.route(`**${SUBMIT_PATH}`, async (route) => {
    posts.push(route.request().postDataJSON());
    if (submitOptions.hang) return;
    if (submitOptions.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, submitOptions.delayMs));
    }
    if (submitOptions.fail) {
      await route.abort();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return { posts, pageErrors };
}

// 第 6 關目前沒有可行題目，Track 會警告並略過。依 SPEC 4.11，整場最多記錄到第 5 關。
const FULL_SESSION_STAGE = 5;
const FULL_SESSION_LEVELS = '1,2,3,4,5';

/** 讀取 payload 中指定的 stats 欄位。 */
function stat(payload, name) {
  const entry = payload.data.stats.find((item) => item.apiname === `DCCS_${name}`);
  return entry ? entry.value : undefined;
}

/**
 * 處理關卡提示與關間畫面，直到 stopWhen 成立。
 * @param {import('@playwright/test').Page} page
 * @param {'single' | 'double'} mode
 * @param {string} stopWhen 'break' | 'level4-clear' | 'session-end'
 * @param {number} timeoutMs
 */
async function drive(page, mode, stopWhen, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (stopWhen === 'session-end' && /\/Select\/index\.html/.test(page.url())) {
      return 'navigated';
    }

    const step = await page
      .evaluate(({ mode, stopWhen }) => {
        const visible = (el) => !!el && el.checkVisibility();
        const stageClear = document.querySelector('.shared-stage-clear');

        if (stageClear && !stageClear.hidden) {
          const text = stageClear.textContent;
          if (stopWhen === 'level4-clear' && text.includes('第 4 關結束')) {
            return 'level4-clear';
          }
          document.querySelector('.shared-stage-clear-btn').click();
          return 'stage-clear';
        }

        if (mode === 'double') {
          if (visible(document.getElementById('shared-break'))) return 'break';
          if (visible(document.getElementById('shared-title'))) return 'title';
          if (visible(document.getElementById('shared-level'))) {
            document.getElementById('shared-continue').click();
            return 'level-prompt';
          }
          return 'running';
        }

        if ([...document.querySelectorAll('[data-break="continue"]')].some(visible)) return 'break';
        const resultLobby = [...document.querySelectorAll('[data-result="lobby"]')].find(visible);
        if (resultLobby) {
          if (stopWhen === 'session-end') resultLobby.click();
          return 'result';
        }
        const levelButton = [...document.querySelectorAll('.dccs-level-continue:not([data-break])')]
          .find(visible);
        if (levelButton) {
          levelButton.click();
          return 'level-prompt';
        }
        return 'running';
      }, { mode, stopWhen })
      // 導向頁面期間，evaluate 可能失敗。下一輪重新檢查。
      .catch(() => 'navigating');

    if (step === 'title') await page.keyboard.press('Space');
    if (step === stopWhen) return step;
    if (stopWhen === 'session-end' && step === 'break') {
      throw new Error('session-end 不應再遇到中場休息畫面');
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`drive: ${timeoutMs}ms 內沒有等到 ${stopWhen}`);
}

async function reachBreak(page, mode) {
  await page.goto(`${mode === 'double' ? '/DCCS_double/index.html' : '/DCCS_single/index.html'}${QUERY}`);
  await drive(page, mode, 'break', 3 * LEVEL_TIMEOUT + 15_000);
}

// 觀察既有的 Track 實例，保留題目、計時與判定。透過鍵盤事件作答。
async function observeTracks(page, mode) {
  await page.evaluate(async () => {
    const { Track } = await import('/DCCS_single/js/game/track.js');
    const render = Track.prototype.render;
    window.testTracks = new Set();
    window.getTestTracks = () => [...window.testTracks].sort((a, b) =>
      a._ctx.canvas.closest('.game-root').id.localeCompare(b._ctx.canvas.closest('.game-root').id));
    Track.prototype.render = function (...args) {
      window.testTracks.add(this);
      return render.apply(this, args);
    };
  });
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

  // 輪盤完成轉動後，本題的鍵盤操作會記錄於第 4 關成績。
  await expect.poll(() => page.evaluate((trials) => window.getTestTracks().every((t, i) =>
    t.stats.rows().filter((row) => row.level === 4 && row.trialIndex === trials[i]
      && row.slotsRotated > 0 && Number.isFinite(row.firstInputMs)).length === 2
  ), before.map((t) => t.trial)), { timeout: 10_000 }).toBe(true);
  await page.screenshot({ path: screenshotPath(`dccs-${mode}-verified-play`) });
}

/** 模擬離開頁面。beforeunload 呼叫 preventDefault 時，表示離開保護生效。 */
function unloadGuardActive(page) {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
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

    // 第 4 關正在進行時，時間結束後會顯示「第 4 關結束」。
    await drive(page, 'double', 'level4-clear', LEVEL_TIMEOUT);
    expect(posts).toHaveLength(0);
    expect(pageErrors).toEqual([]);
  });

  test('空白鍵選繼續：結果和點擊相同', async ({ page }) => {
    const { pageErrors } = await setup(page, 'double');
    await reachBreak(page, 'double');

    // 進入畫面時，若空白鍵已按住，須先放開再按。此處使用一次新的按鍵事件。
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

    // 若遊戲結束時未解除離開保護，beforeunload 會阻止導向頁面。
    const dialogs = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.accept();
    });

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

    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.data.caseId).sort()).toEqual(['T01', 'T02']);
    for (const payload of posts) {
      expect(payload.data.mode).toBe('double');
      expect(stat(payload, 'stage')).toBe(3);
      // 成績不應包含第 4 關的題目。
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

    const dialogs = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.accept();
    });

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

    await page.locator('[data-break="lobby"]').click();
    await page.waitForURL(/\/Select\/index\.html/, { timeout: 15_000 });

    expect(posts).toHaveLength(1);
    expect(stat(posts[0], 'stage')).toBe(3);
    expect(stat(posts[0], 'levelsPlayed')).toBe('1,2,3');
    expect(pageErrors).toEqual([]);
  });
});
