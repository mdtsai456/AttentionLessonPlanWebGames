import { test as base, expect } from '@playwright/test';

export { expect };

export const test = base.extend({
  game: async ({ page }, use) => {
    const payloads = [], delivered = [], dialogs = [], pageErrors = [], held = [];
    const api = {
      holdNext: 0,
      failNext: 0,
      acceptLeave: false,
      releaseHeld() { held.splice(0).forEach((release) => release()); },
    };
    let answered = 0;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.type());
      if (api.acceptLeave) await dialog.accept();
      else await dialog.dismiss();
    });
    await page.addInitScript(() => {
      window.__skew = 0;
      const realNow = Date.now;
      Date.now = () => realNow() + window.__skew;
    });
    await page.route('https://attention-lesson-plan-assets.zeabur.app/**', (route) => route.abort());
    await page.route('**/api/sessions', async (route) => {
      const payload = JSON.parse(route.request().postData());
      payloads.push(payload);
      const fail = api.failNext > 0;
      if (fail) api.failNext--;
      if (api.holdNext > 0) {
        api.holdNext--;
        await new Promise((resolve) => held.push(resolve));
      }
      try {
        await route.fulfill({
          status: fail ? 500 : 201,
          contentType: 'application/json',
          body: JSON.stringify(fail ? { detail: 'error' } : { sessionId: 'test-session' }),
        });
        if (!fail) delivered.push(stageOf(payload));
      } catch {
        // 已離開頁面而中斷的請求不算送達。
      }
      answered++;
    });
    const game = {
      page, api, dialogs,
      posted: () => payloads.map(stageOf),
      delivered: () => delivered.slice(),
      async waitForSaves(count) {
        await expect.poll(() => answered).toBeGreaterThanOrEqual(count);
      },
      async open(mode = 'game') {
        await page.goto(`/DAT_single/DAT_single.html?mode=${mode}`);
        await expect(page.locator('#feedback')).not.toHaveText('素材載入中…');
      },
      async startQuestions() {
        await page.evaluate(() => showQuestion());
      },
      // 只加速關卡計時；換關、結算及存檔都使用頁面原本的處理流程。
      async playThrough(lastStage, firstStage = 1) {
        for (let stage = firstStage; stage <= lastStage; stage++) {
          await game.startQuestions();
          await page.evaluate(() => { window.__skew += 61000; });
          if (stage === 6) {
            await expect(page.locator('#results')).toBeVisible();
          } else if (stage === 3) {
            await expect(page.locator('#stage-clear-modal')).toBeVisible();
            if (lastStage > 3) await page.click('#btn-next-stage');
          } else {
            await page.click('.shared-stage-clear-btn');
          }
        }
      },
      async cancelLeave() {
        const dialog = page.waitForEvent('dialog');
        await page.click('#leave-btn', { noWaitAfter: true });
        await dialog;
        await expect(page).toHaveURL(/\/DAT_single\/DAT_single\.html/);
      },
    };
    try { await use(game); }
    finally { api.releaseHeld(); }
    expect(pageErrors, '頁面不應有 JavaScript 錯誤').toEqual([]);
  },
});

function stageOf(payload) {
  return payload.data.stats.find((stat) => stat.apiname === 'EFT_stage').value;
}
