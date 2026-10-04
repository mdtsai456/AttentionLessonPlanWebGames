// 024 動物追擊令（雙人）：離開遊戲與存檔 checkpoint
import { test, expect } from './dat-double.fixture.mjs';

const BACK_HOME = (player) => `.player-${player} [data-ui="back-home"]`;

test.describe('版面', () => {
  test('結算遮罩打開時「離開」仍在最上層', async ({ game }) => {
    await game.open();
    await game.playThrough(6);
    expect(await game.elementOnLeaveButton()).toBe('leave-btn');
  });

  for (const viewport of [{ width: 1024, height: 600 }, { width: 1920, height: 1080 }]) {
    test(`兩張結算卡都有「返回遊戲大廳」，和「再玩一次」排同一列（${viewport.width}×${viewport.height}）`, async ({ game, page }) => {
      await page.setViewportSize(viewport);
      await game.open();
      await game.playThrough(6);
      for (const player of [1, 2]) {
        const restart = page.locator(`.player-${player} [data-ui="restart"]`);
        const backHome = page.locator(BACK_HOME(player));
        await expect(backHome).toBeVisible();
        await expect(backHome).toHaveText('返回遊戲大廳');
        const [a, b, card] = await Promise.all([
          restart.boundingBox(),
          backHome.boundingBox(),
          page.locator(`.player-${player} [data-ui="results"] .result-card`).boundingBox(),
        ]);
        expect(Math.abs(a.y - b.y)).toBeLessThan(2);
        expect(b.x + b.width).toBeLessThanOrEqual(card.x + card.width);
      }
    });
  }

  test('game.js 只載入一次（main.js 的 import 版本號和實際載入的一致）', async ({ game, page }) => {
    const gameModules = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/DAT_double/js/game.js') gameModules.push(request.url());
    });
    await game.open();
    expect(gameModules).toHaveLength(1);
  });
});

test.describe('玩完六關', () => {
  test('結算時兩位玩家各存一筆 stage 6，payload 正確', async ({ game }) => {
    await game.open();
    await game.playThrough(6);
    await game.waitForSaves(2);
    expect(game.posted()).toEqual([6, 6]);

    const payloads = game.payloads();
    expect(new Set(payloads.map((p) => p.data.pairId)).size).toBe(1);
    expect(payloads[0].data.pairId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(payloads.map((p) => p.data.caseId)).size).toBe(2);
    for (const { lessonId, data } of payloads) {
      const stat = (name) => data.stats.find((s) => s.apiname === name).value;
      expect(lessonId).toBe('1140908_EFT');
      expect(data.mode).toBe('double');
      expect(data.stats).toHaveLength(10);
      expect(data.endTime).toBeGreaterThan(data.startTime);
      expect(stat('EFT_duration')).toBe(data.endTime - data.startTime);
      expect(stat('EFT_levelAccuracy').split(',')).toHaveLength(6);
    }
  });

  for (const player of [1, 2]) {
    test(`玩家${player === 1 ? '一' : '二'}按結算卡「返回遊戲大廳」：不重存、不跳確認框，直接回大廳`, async ({ game }) => {
      await game.open();
      await game.playThrough(6);
      await game.waitForSaves(2);
      expect(await game.clickAndWaitForLobby(BACK_HOME(player))).toBe(true);
      expect(game.posted()).toEqual([6, 6]);
      expect(game.dialogs).toEqual([]);
    });
  }

  test('按「離開」：不重存、不跳確認框，直接回大廳', async ({ game }) => {
    await game.open();
    await game.playThrough(6);
    await game.waitForSaves(2);
    expect(await game.clickAndWaitForLobby('#leave-btn')).toBe(true);
    expect(game.posted()).toEqual([6, 6]);
    expect(game.dialogs).toEqual([]);
  });

  test('存檔還沒送完就按「返回遊戲大廳」：等兩筆都送達才導頁', async ({ game }) => {
    await game.open();
    game.api.delayMs = 1500;
    await game.playThrough(6);
    expect(await game.clickAndWaitForLobby(BACK_HOME(1), 8000)).toBe(true);
    expect(game.posted()).toEqual([6, 6]);
    expect(game.delivered()).toEqual([6, 6]);
  });

  test('連按兩下「離開」不會重複存檔', async ({ game, page }) => {
    await game.open();
    game.api.delayMs = 1000;
    await game.playThrough(6);
    // 在同一個事件迴圈內連點兩下，確保第二下發生在第一下的存檔還沒送完時
    await page.evaluate(() => {
      const leave = document.getElementById('leave-btn');
      leave.click();
      leave.click();
    });
    // 兩次點擊都會導頁，第二次會中斷第一次，所以只看最後停在哪
    await expect(page).toHaveURL(/\/Select\/index\.html$/, { timeout: 8000 });
    expect(game.posted()).toEqual([6, 6]);
  });

  test('結算存檔失敗後按「離開」會重送一次', async ({ game }) => {
    await game.open();
    game.api.failNext = 2;
    await game.playThrough(6);
    await game.waitForSaves(2);
    expect(game.delivered()).toEqual([]);
    expect(await game.clickAndWaitForLobby('#leave-btn')).toBe(true);
    expect(game.posted()).toEqual([6, 6, 6, 6]);
    expect(game.delivered()).toEqual([6, 6]);
  });

  test('只有一位玩家先結算時按「返回遊戲大廳」：照舊跳確認框，已存 stage 6 的玩家不補存 stage 3', async ({ game, page }) => {
    await game.open();
    await game.playThrough(5);
    await game.startQuestions();
    await game.pausePlayer(1);
    await game.skipStageTime();
    await expect(page.locator('.player-1 [data-ui="results"]')).toBeVisible();
    await expect(page.locator('.player-2 [data-ui="results"]')).toBeHidden();
    await game.waitForSaves(1);

    expect(await game.clickAndWaitForLobby(BACK_HOME(1))).toBe(false);
    expect(game.posted()).toEqual([6, 3]);
    expect(game.dialogs).toEqual(['beforeunload']);
  });
});

test.describe('第 3 關中場', () => {
  test('「返回遊戲大廳」：兩位玩家各存 stage 3 後直接回大廳', async ({ game }) => {
    await game.open();
    await game.playThrough(3);
    expect(await game.clickAndWaitForLobby('#mid-lobby')).toBe(true);
    expect(game.posted()).toEqual([3, 3]);
    expect(game.dialogs).toEqual([]);
  });

  test('「返回遊戲大廳」存檔期間鎖住中場按鈕，存完才導頁', async ({ game, page }) => {
    await game.open();
    game.api.delayMs = 1500;
    await game.playThrough(3);
    const navigated = page.waitForURL('**/Select/index.html', { timeout: 8000 });
    await page.click('#mid-lobby', { noWaitAfter: true });
    await expect(page.locator('#mid-continue')).toBeDisabled();
    await expect(page.locator('#mid-lobby')).toBeDisabled();
    await navigated;
    expect(game.delivered()).toEqual([3, 3]);
  });

  test('「離開」點得到：存 stage 3 後跳確認框', async ({ game }) => {
    await game.open();
    await game.playThrough(3);
    expect(await game.elementOnLeaveButton()).toBe('leave-btn');
    expect(await game.clickAndWaitForLobby('#leave-btn')).toBe(false);
    expect(game.posted()).toEqual([3, 3]);
    expect(game.dialogs).toEqual(['beforeunload']);
  });

  test('「離開」後在確認框取消、繼續玩完：結算照常存 stage 6', async ({ game, page }) => {
    await game.open();
    await game.playThrough(3);
    expect(await game.clickAndWaitForLobby('#leave-btn')).toBe(false);
    await page.click('#mid-continue');
    await game.playThrough(6, 4);
    await game.waitForSaves(4);
    expect(game.posted()).toEqual([3, 3, 6, 6]);
  });

  test('「離開」後在確認框取消、玩完六關：「返回遊戲大廳」不會再跳一次確認框', async ({ game, page }) => {
    await game.open();
    await game.playThrough(3);
    expect(await game.clickAndWaitForLobby('#leave-btn')).toBe(false);
    await page.click('#mid-continue');
    await game.playThrough(6, 4);
    await game.waitForSaves(4);
    expect(await game.clickAndWaitForLobby(BACK_HOME(1))).toBe(true);
    expect(game.dialogs).toEqual(['beforeunload']);
  });

  test('只有一位玩家到中場時按「離開」：不存檔、跳確認框', async ({ game, page }) => {
    await game.open();
    await game.playThrough(2);
    await game.startQuestions();
    await game.pausePlayer(1);
    await game.skipStageTime();
    await expect.poll(() => game.completedStages()).toEqual([3, 2]);

    expect(await game.clickAndWaitForLobby('#leave-btn')).toBe(false);
    expect(game.posted()).toEqual([]);
    expect(game.dialogs).toEqual(['beforeunload']);
    await expect(page.locator('#mid-break')).toBeHidden();
  });
});

test.describe('遊戲進行中', () => {
  test('第 1 關按「離開」：不存檔、跳確認框', async ({ game }) => {
    await game.open();
    await game.startQuestions();
    expect(await game.clickAndWaitForLobby('#leave-btn')).toBe(false);
    expect(game.posted()).toEqual([]);
    expect(game.dialogs).toEqual(['beforeunload']);
  });

  test('第 4 關按「離開」：存 stage 3 checkpoint 後跳確認框', async ({ game }) => {
    await game.open();
    await game.playThrough(3);
    await game.page.click('#mid-continue');
    await game.startQuestions();
    expect(await game.clickAndWaitForLobby('#leave-btn')).toBe(false);
    expect(game.posted()).toEqual([3, 3]);
    expect(game.dialogs).toEqual(['beforeunload']);
  });
});

test.describe('練習模式', () => {
  test('練習中按「離開」：不存檔、跳確認框', async ({ game }) => {
    await game.open('practice');
    await game.startQuestions();
    expect(await game.clickAndWaitForLobby('#leave-btn')).toBe(false);
    expect(game.posted()).toEqual([]);
    expect(game.dialogs).toEqual(['beforeunload']);
  });

  test('從練習按「進入正式遊戲」玩完六關：結算卡有返回鈕，按了直接回大廳', async ({ game, page }) => {
    await game.open('practice');
    // 「進入正式遊戲」的右半邊被「離開」蓋住（原本就有的版面問題），點左邊露出來的地方
    await page.click('#enter-formal-btn', { position: { x: 12, y: 12 } });
    await game.playThrough(6);
    await game.waitForSaves(2);
    await expect(page.locator(BACK_HOME(1))).toBeVisible();
    await expect(page.locator(BACK_HOME(2))).toBeVisible();
    expect(await game.clickAndWaitForLobby(BACK_HOME(2))).toBe(true);
    expect(game.posted()).toEqual([6, 6]);
    expect(game.dialogs).toEqual([]);
  });
});

test.describe('再玩一次', () => {
  test('舊局延遲失敗不會讓新局已成功的 stage 6 重送', async ({ game, page }) => {
    const failures = [];
    page.on('console', (message) => {
      if (message.text().includes('存檔失敗 (HTTP 500)')) failures.push(message.text());
    });
    await game.open();
    game.api.failNext = 2;
    game.api.holdNext = 2;
    await game.playThrough(6);
    await expect.poll(() => game.posted()).toEqual([6, 6]);
    await page.click('.player-1 [data-ui="restart"]');
    await page.click('.player-2 [data-ui="restart"]');
    await game.playThrough(6);
    await game.waitForSaves(2);
    expect(game.delivered()).toEqual([6, 6]);

    game.api.releaseHeld();
    await game.waitForSaves(4);
    // 等到遊戲處理完兩個舊局失敗回應，才操作新局的返回按鈕。
    await expect.poll(() => failures.length).toBe(2);
    expect(await game.clickAndWaitForLobby(BACK_HOME(1))).toBe(true);
    expect(game.posted()).toEqual([6, 6, 6, 6]);
    expect(game.delivered()).toEqual([6, 6]);
  });

  test('兩位玩家都再玩一次後，中場離開仍會存 stage 3', async ({ game, page }) => {
    await game.open();
    await game.playThrough(6);
    await game.waitForSaves(2);
    await page.click('.player-1 [data-ui="restart"]');
    await page.click('.player-2 [data-ui="restart"]');
    await game.playThrough(3);
    expect(await game.clickAndWaitForLobby('#mid-lobby')).toBe(true);
    expect(game.posted()).toEqual([6, 6, 3, 3]);
  });
});
