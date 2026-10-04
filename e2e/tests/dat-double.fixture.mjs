import { test as base, expect } from '@playwright/test';

export { expect };

const LOBBY = '**/Select/index.html';

// DAT_double 的測試環境：
// - Date.now 可以快轉（window.__skew），一關 60 秒不用真的等
// - 攔下存檔 API，記錄每筆送出的 payload；可模擬延遲或失敗
// - 擋掉素材伺服器，一律用本機預設圖
// - 記錄瀏覽器確認框與頁面錯誤
export const test = base.extend({
  game: async ({ page }, use) => {
    const sessions = { payloads: [], delivered: [], answered: 0 };
    const dialogs = [];
    const pageErrors = [];
    const heldRequests = [];
    const api = {
      delayMs: 0,
      failNext: 0,
      holdNext: 0,
      acceptLeave: false,
      releaseHeld() { heldRequests.splice(0).forEach((release) => release()); },
    };

    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.type());
      if (api.acceptLeave) await dialog.accept();
      else await dialog.dismiss();
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.addInitScript(() => {
      window.__skew = 0;
      const realNow = Date.now;
      Date.now = () => realNow() + window.__skew;
    });
    await page.route('**/api/sessions', async (route) => {
      const payload = JSON.parse(route.request().postData());
      sessions.payloads.push(payload);
      const fail = api.failNext > 0;
      if (fail) api.failNext--;
      if (api.holdNext > 0) {
        api.holdNext--;
        await new Promise((resolve) => heldRequests.push(resolve));
      }
      if (api.delayMs) await new Promise((resolve) => setTimeout(resolve, api.delayMs));
      try {
        await route.fulfill({
          status: fail ? 500 : 200,
          contentType: 'application/json',
          body: JSON.stringify(fail ? { detail: 'error' } : { ok: true }),
        });
        if (!fail) sessions.delivered.push(stageOf(payload));
      } catch {
        // 頁面已經離開，請求被瀏覽器中斷，沒有送達
      }
      sessions.answered++;
    });
    await page.route('https://attention-lesson-plan-assets.zeabur.app/**', (route) => route.abort());

    const game = {
      page,
      api,
      dialogs,
      pageErrors,
      /** 等到前 count 筆存檔請求都已回應（成功或失敗） */
      async waitForSaves(count) {
        await expect.poll(() => sessions.answered).toBeGreaterThanOrEqual(count);
      },
      /** 已送出的存檔關卡，例如 [6, 6] */
      posted: () => sessions.payloads.map(stageOf),
      /** 伺服器確實收到的存檔關卡 */
      delivered: () => sessions.delivered.slice(),
      payloads: () => sessions.payloads.slice(),

      async open(mode = 'game') {
        await page.goto(`/DAT_double/DAT_double.html${mode === 'game' ? '?mode=game' : ''}`);
        // 用頁面自己載入的同一個 URL 匯入，拿到同一個模組實例
        await page.evaluate(async () => {
          const src = document.querySelector('script[type="module"]').src;
          window.__dat = await import(src);
        });
        await expect(page.locator('.player-1 [data-ui="feedback"]')).not.toHaveText('素材載入中…');
      },

      /** 兩位玩家同時開始出題（等同任一位瞄準動物） */
      async startQuestions() {
        await page.evaluate(() => window.__dat.players.forEach((player) => player.forceStart()));
        await page.waitForTimeout(100);
      },

      /** 時間快轉超過一關 */
      async skipStageTime() {
        await page.evaluate(() => { window.__skew += 61000; });
      },

      async pausePlayer(index) {
        await page.evaluate((i) => window.__dat.players[i].pauseGame(), index);
      },

      async completedStages() {
        return page.evaluate(() => window.__dat.players.map((player) => player.completedStages()));
      },

      /** 從目前關卡玩到第 lastStage 關結束；第 3 關會停在中場，除非 lastStage 更後面 */
      async playThrough(lastStage, firstStage = 1) {
        for (let stage = firstStage; stage <= lastStage; stage++) {
          await game.startQuestions();
          await game.skipStageTime();
          if (stage === 6) {
            await expect(page.locator('[data-ui="results"]:not([hidden])')).toHaveCount(2);
          } else if (stage === 3) {
            await expect(page.locator('#mid-break')).toBeVisible();
            if (lastStage > 3) await page.click('#mid-continue');
          } else {
            await page.click('.shared-stage-clear-btn');
          }
        }
      },

      /** 回傳「離開」按鈕中心點最上層的元素 id */
      async elementOnLeaveButton() {
        return page.evaluate(() => {
          const rect = document.getElementById('leave-btn').getBoundingClientRect();
          return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).id;
        });
      },

      /** 點擊後等到「回到遊戲大廳」或「跳出確認框」其中一個發生；回傳是否回到遊戲大廳 */
      async clickAndWaitForLobby(selector, timeout = 20_000) {
        const navigated = page.waitForURL(LOBBY, { timeout }).then(() => 'lobby', () => 'timeout');
        const asked = page.waitForEvent('dialog', { timeout }).then(() => 'dialog', () => 'timeout');
        await page.click(selector, { noWaitAfter: true });
        const outcome = await Promise.race([navigated, asked]);
        // 確認框被取消後頁面不該再自己導走
        await page.waitForTimeout(300);
        return outcome === 'lobby' && page.url().endsWith('/Select/index.html');
      },
    };

    try {
      await use(game);
    } finally {
      api.releaseHeld();
    }
    expect(pageErrors, '頁面不應有 JavaScript 錯誤').toEqual([]);
  },
});

function stageOf(payload) {
  return payload.data.stats.find((stat) => stat.apiname === 'EFT_stage').value;
}
