// 按「離開」先在頁面內確認，確定後才存檔並離開（#41）。
// 以前先存第 3 關檢查點再跳出瀏覽器的離開詢問；按取消後繼續玩完，同一局會多一筆中場成績。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStaticServer, launchBrowser, openGame, leaveDialog } from './helpers.js';
import { expectNoErrors } from './expect.js';

const stageOf = (post) => post.data.stats.find((stat) => stat.apiname === 'DAT_stage').value;

async function waitUntil(session, predicate, label) {
  for (let i = 0; i < 100; i++) {
    if (await session.page.evaluate(predicate)) return;
    await session.page.clock.runFor(100);
  }
  throw new Error(`等待逾時：${label}`);
}

describe('動物追擊令離開確認', () => {
  let server;
  let browser;
  before(async () => { server = await startStaticServer(); browser = await launchBrowser(); });
  after(async () => { await browser?.close(); await server?.close(); });

  for (const game of ['single', 'double']) {
    const players = game === 'double' ? 2 : 1;

    test(`${game}：第 4 關按離開→繼續遊戲不送成績；再按離開→確定才送第 3 關檢查點並回選遊戲頁`, async () => {
      const session = await openGame(browser, server.origin, { game });
      session.page.setDefaultTimeout(5000);
      try {
        for (let i = 0; i < 19; i++) await session.driver.playQuestion('correct', 'correct');
        const round = await session.page.locator(game === 'single' ? '#round' : '.player-1 [data-ui="round"]').textContent();
        assert.match(round, /第 4 \/ 6 關/);

        await session.page.locator('#leave-btn').click();
        const dialog = leaveDialog(session.page);
        await dialog.waitFor({ state: 'visible' });
        await session.page.clock.runFor(1000);
        assert.equal(session.sessionPosts.length, 0, '確認框開著時不可先存檔');

        await dialog.getByRole('button', { name: '繼續遊戲', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        await session.page.clock.runFor(1000);
        assert.equal(session.sessionPosts.length, 0, '取消離開不可送出任何成績');
        assert.ok(session.page.url().includes(`DAT_${game}.html`), '取消後留在遊戲頁');
        assert.equal(await session.page.locator('#leave-btn').isEnabled(), true, '取消後離開鈕可以再按');
        // 焦點留在離開鈕時，空白鍵會再按到離開而不是作答
        assert.notEqual(await session.page.evaluate(() => document.activeElement?.id), 'leave-btn', '取消後焦點要離開「離開」鈕');
        // 遊戲照常繼續：下一題可以正常作答
        await session.driver.playQuestion('correct', 'correct');
        assert.equal(session.sessionPosts.length, 0);

        await session.page.locator('#leave-btn').click();
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByRole('button', { name: '離開', exact: true }).click();
        await session.page.waitForURL('**/Select/index.html');
        assert.equal(session.sessionPosts.length, players, '確定離開後每位玩家送一筆第 3 關檢查點');
        for (const post of session.sessionPosts) assert.equal(stageOf(post), 3);
        assert.deepEqual(session.dialogs, [], '不可跳出瀏覽器的離開詢問');
      } finally { await session.context.close(); }
    });

    test(`${game}：第 1 關按離開→確定，不送成績直接回選遊戲頁，不跳出瀏覽器的離開詢問`, async () => {
      const session = await openGame(browser, server.origin, { game });
      session.page.setDefaultTimeout(5000);
      try {
        await session.driver.playQuestion('correct', 'correct');
        await session.page.locator('#leave-btn').click();
        const dialog = leaveDialog(session.page);
        await dialog.getByRole('button', { name: '離開', exact: true }).click();
        await session.page.waitForURL('**/Select/index.html');
        assert.equal(session.sessionPosts.length, 0, '未達第 3 關不送成績');
        assert.deepEqual(session.dialogs, [], '不可跳出瀏覽器的離開詢問');
      } finally { await session.context.close(); }
    });

    test(`${game}：第 1 關按離開→Esc 取消，遊戲繼續且不送成績`, async () => {
      const session = await openGame(browser, server.origin, { game });
      session.page.setDefaultTimeout(5000);
      try {
        await session.driver.playQuestion('correct', 'correct');
        await session.page.locator('#leave-btn').click();
        await leaveDialog(session.page).waitFor({ state: 'visible' });
        await session.page.keyboard.press('Escape');
        await leaveDialog(session.page).waitFor({ state: 'detached' });
        await session.driver.playQuestion('correct', 'correct');
        await waitUntil(session, () => !document.querySelector('#leave-btn').disabled, '離開鈕恢復');
        assert.equal(session.sessionPosts.length, 0);
        assert.deepEqual(session.dialogs, []);
        expectNoErrors(session);
      } finally { await session.context.close(); }
    });
  }
});
