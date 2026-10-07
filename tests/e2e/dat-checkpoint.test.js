import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStaticServer, launchBrowser, openGame } from './helpers.js';

async function waitNotice(session, predicate) {
  for (let i = 0; i < 200; i++) {
    if (await session.page.evaluate(predicate)) return;
    await session.page.clock.runFor(100);
  }
  throw new Error('等待中場存檔狀態逾時');
}

for (const game of ['single', 'double']) {
  test(`${game}：第三關離開失敗留在中場，重試成功後離開不重送伙伴成績`, async () => {
    const server = await startStaticServer();
    const browser = await launchBrowser();
    let session;
    try {
      session = await openGame(browser, server.origin, {
        game,
        routeOverride: async ({ route, request, url, sessionPosts }) => {
          if (request.method() !== 'POST' || !url.endsWith('/api/sessions')) return false;
          const id = request.postDataJSON().data.caseId;
          const count = sessionPosts.filter((post) => post.data.caseId === id).length;
          const failed = id === (game === 'single' ? 'S03' : 'S01') && count === 1;
          await route.fulfill({ status: failed ? 500 : 201, contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(failed ? { detail: '測試失敗' } : { sessionId: 'checkpoint-test' }) });
          return true;
        },
      });
      for (let i = 0; i < 18; i++) await session.driver.playQuestion('correct', 'correct');
      await waitNotice(session, () => {
        const panel = document.querySelector('#mid-break, #stage-clear-modal');
        return panel && !panel.hidden;
      });
      const lobby = game === 'single' ? '#btn-lobby' : '#mid-lobby';
      await session.page.locator(lobby).click();
      await waitNotice(session, () => document.querySelector('#checkpoint-save-status').textContent.includes('成績儲存失敗，請重試'));
      assert.ok(await session.page.locator('#save-notice').isVisible());
      assert.ok(session.page.url().includes(`DAT_${game}.html`));
      assert.equal(session.sessionPosts.length, game === 'single' ? 1 : 2);
      const original = structuredClone(session.sessionPosts.find((post) => post.data.caseId === (game === 'single' ? 'S03' : 'S01')));
      await session.page.locator('#checkpoint-retry-save').click();
      await waitNotice(session, () => document.querySelector('#save-notice').hidden);
      assert.deepEqual(session.sessionPosts.at(-1), original, '重試保存原始時間與成績');
      for (const post of session.sessionPosts) {
        assert.equal(post.data.stats.find((stat) => stat.apiname === 'EFT_stage').value, 3);
        assert.equal(post.data.stats.find((stat) => stat.apiname === 'EFT_levelAccuracy').value, '1,1,1');
      }
      const count = session.sessionPosts.length;
      await session.page.locator(lobby).click();
      await session.page.waitForURL('**/Select/index.html');
      assert.equal(session.sessionPosts.length, count);
    } finally {
      await session?.context.close();
      await browser.close();
      await server.close();
    }
  });
}
