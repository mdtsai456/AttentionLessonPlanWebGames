// 雙人版：六關最終成績第一次送出失敗，人工重試成功後，「離開」與「返回遊戲大廳」都要能回選遊戲頁（#11）
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStaticServer, launchBrowser, openGame } from './helpers.js';

const SAVED = '成績已儲存';
const FAILED = '成績儲存失敗，請重試';

async function waitStatus(session, p, text) {
  await session.driver.waitFor(
    ({ selector, text }) => document.querySelector(selector)?.textContent === text,
    `P${p + 1} ${text}`,
    { arg: { selector: `.player-${p + 1} [data-ui="save-status"]`, text }, maxMs: 30000 },
  );
}

describe('雙人版最終存檔重試後可以離開', () => {
  let server;
  let browser;
  before(async () => { server = await startStaticServer(); browser = await launchBrowser(); });
  after(async () => { await browser?.close(); await server?.close(); });

  for (const exit of ['leave-btn', 'back-home']) {
    test(`第一次送出 500 → 重試成功 → 按 ${exit} 回選遊戲頁`, async () => {
      const session = await openGame(browser, server.origin, {
        game: 'double',
        routeOverride: async ({ route, request, url, sessionPosts }) => {
          if (request.method() !== 'POST' || !new URL(url).pathname.endsWith('/api/sessions')) return false;
          // 只讓 P1 第一次送的第 6 關最終成績失敗（中場先送的第 3 關照常成功）。
          const stageOf = (post) => post.data.stats.find((stat) => stat.apiname === 'DAT_stage').value;
          const body = request.postDataJSON();
          const id = body.data.caseId;
          const count = sessionPosts.filter((post) => post.data.caseId === id && stageOf(post) === 6).length;
          const failed = id === 'S01' && stageOf(body) === 6 && count === 1;
          await route.fulfill({
            status: failed ? 500 : 201, contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(failed ? { detail: '測試失敗' } : { sessionId: 'retry-test' }),
          });
          return true;
        },
      });
      try {
        for (let i = 0; i < 36; i++) await session.driver.playQuestion('correct', 'correct');
        await waitStatus(session, 0, FAILED);
        await waitStatus(session, 1, SAVED);
        await session.page.locator('.player-1 [data-ui="retry-save"]').click();
        await waitStatus(session, 0, SAVED);
        // 中場兩筆第 3 關 + 兩筆第 6 關 + P1 重試一筆。
        assert.equal(session.sessionPosts.length, 5);
        const target = exit === 'leave-btn' ? '#leave-btn' : '.player-1 [data-ui="back-home"]';
        await session.page.locator(target).click();
        await session.page.waitForURL('**/Select/index.html', { timeout: 5000 });
        assert.equal(session.sessionPosts.length, 5, '離開時不可重送已儲存的成績');
        // 六關已打完：不再確認，也不可跳出瀏覽器的離開詢問
        assert.deepEqual(session.dialogs, []);
      } finally { await session.context.close(); }
    });
  }
});
