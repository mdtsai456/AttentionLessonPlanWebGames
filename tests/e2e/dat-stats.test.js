// 成績統計內容：平均反應時間只算有按鍵的題目（#9）；第 4–5 關離開時的第 3 關檢查點只含前三關（#10）
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStaticServer, launchBrowser, openGame, leaveDialog } from './helpers.js';
import { expectNoErrors } from './expect.js';

const statsOf = (post) => Object.fromEntries(post.data.stats.map(({ apiname, value }) => [apiname, value]));

// 只快轉時鐘等待條件，不自動按「繼續」，讓測試停在第 3 關中場
async function waitPage(session, predicate, label, arg) {
  for (let i = 0; i < 300; i++) {
    if (await session.page.evaluate(predicate, arg)) return;
    await session.page.clock.runFor(100);
  }
  throw new Error(`等待逾時：${label}`);
}

describe('動物追擊令成績統計', () => {
  let server;
  let browser;
  before(async () => { server = await startStaticServer(); browser = await launchBrowser(); });
  after(async () => { await browser?.close(); await server?.close(); });

  for (const game of ['single', 'double']) {
    const players = game === 'double' ? ['S01', 'S02'] : ['S03'];

    test(`${game}：平均反應時間只計算有按鍵的題目，不含「不要按」的 10 秒等待（#9）`, async () => {
      const session = await openGame(browser, server.origin, { game });
      try {
        // 三關共 18 題全部正確作答：題目正確立刻按鍵，不正確就等滿 10 秒
        for (let i = 0; i < 18; i++) await session.driver.playQuestion('correct', 'correct');
        await waitPage(session, () => {
          const panel = document.querySelector('#mid-break, #stage-clear-modal');
          return panel && !panel.hidden;
        }, '第 3 關中場');
        await session.page.locator(game === 'single' ? '#btn-lobby' : '#mid-lobby').click();
        await session.page.waitForURL('**/Select/index.html');
        // 中場「返回遊戲大廳」是明確選擇：不再確認，也不可跳出瀏覽器的離開詢問
        assert.deepEqual(session.dialogs, []);
        assert.equal(session.sessionPosts.length, players.length);
        for (const post of session.sessionPosts) {
          const stats = statsOf(post);
          assert.equal(stats.DAT_stage, 3);
          assert.equal(stats.DAT_correct, 18);
          // 立即按鍵的反應時間只有數百毫秒；若把 10 秒等待也算進去，平均會接近 5 秒
          assert.ok(stats.DAT_avgReactionMs > 0, `至少有一題按鍵：${stats.DAT_avgReactionMs}`);
          assert.ok(stats.DAT_avgReactionMs < 1000, `${post.data.caseId} 平均反應時間應只含按鍵題：${stats.DAT_avgReactionMs}`);
        }
      } finally { await session.context.close(); }
    });

    test(`${game}：第 4 關離開時，第 3 關檢查點只含前三關的 18 題（#10）`, async () => {
      const session = await openGame(browser, server.origin, { game });
      try {
        for (let i = 0; i < 18; i++) await session.driver.playQuestion('correct', 'correct');
        // 第 19 題起進入第 4 關（driver 會自動按中場「繼續」），故意答錯兩題
        await session.driver.playQuestion('miss', 'miss');
        await session.driver.playQuestion('miss', 'miss');
        const round = await session.page.locator(game === 'single' ? '#round' : '.player-1 [data-ui="round"]').textContent();
        assert.match(round, /第 4 \/ 6 關/);
        // 假時鐘停住，確認框開著時頁面時間不變；離開時刻即為此刻
        const leaveAt = await session.page.evaluate(() => Date.now());
        await session.page.locator('#leave-btn').click();
        await leaveDialog(session.page).getByRole('button', { name: '離開', exact: true }).click();
        await session.page.waitForURL('**/Select/index.html');
        assert.deepEqual(session.dialogs, []);
        assert.equal(session.sessionPosts.length, players.length);
        for (const post of session.sessionPosts) {
          const stats = statsOf(post);
          const who = post.data.caseId;
          assert.equal(stats.DAT_stage, 3);
          assert.equal(stats.DAT_levelAccuracy, '1,1,1');
          assert.equal(stats.DAT_questionCount, 18, `${who} 第 3 關檢查點題數`);
          assert.equal(stats.DAT_correct, 18, `${who} 第 3 關檢查點答對數`);
          assert.equal(stats.DAT_wrong, 0, `${who} 第 4 關的錯題不可算進第 3 關檢查點`);
          assert.equal(stats.DAT_accuracy, 1);
          assert.ok(stats.DAT_avgReactionMs < 1000, `${who} 平均反應時間：${stats.DAT_avgReactionMs}`);
          // 第 4 關第 1 題已完整結束（10 秒），第 2 題已判定；檢查點的時長與結束時間要停在第 3 關結束
          const played = leaveAt - post.data.startTime;
          assert.ok(stats.DAT_duration <= played - 10000, `${who} 時長 ${stats.DAT_duration} 應不含第 4 關（離開時已 ${played}）`);
          assert.ok(post.data.endTime <= leaveAt - 10000, `${who} 結束時間應為第 3 關結束`);
          assert.ok(post.data.endTime >= post.data.startTime);
        }
        expectNoErrors(session);
      } finally { await session.context.close(); }
    });
  }
});
