// 完整生命週期與存檔契約；openGame 攔截全部外部流量。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { GameDriver, RESULT_RE, startStaticServer, launchBrowser, openGame } from './helpers.js';
import { expectNoErrors } from './expect.js';

const SAVED = '成績已儲存';
const FAILED = '成績儲存失敗，請重試';
const SAVING = '儲存中…';
const UNKNOWN = '存檔結果未確認，請先確認紀錄，避免重複送出';
const selector = (game, id, p = 0) => game === 'single' ? `#${id}` : `.player-${p + 1} [data-ui="${id}"]`;
const isSessionPost = (request, url) => request.method() === 'POST' && new URL(url).pathname.endsWith('/api/sessions');

async function fulfillSession(route, status = 201) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(status === 201 ? { sessionId: 'lifecycle-test' } : { detail: '測試存檔失敗' }),
  });
}

async function waitStatus(session, game, text, players = game === 'double' ? [0, 1] : [0]) {
  await session.driver.waitFor(
    ({ selectors, text }) => selectors.every((s) => document.querySelector(s)?.textContent === text),
    text,
    { arg: { selectors: players.map((p) => selector(game, 'save-status', p)), text }, maxMs: 30000 },
  );
  for (const p of players) assert.equal(await session.page.locator(selector(game, 'save-status', p)).isVisible(), true, `P${p + 1} 存檔提示必須實際可見`);
}

async function resetDriver(session, game) {
  const counts = await session.page.evaluate((re) => ({
    questions: window.__qa.questions.map((list) => list.length),
    results: window.__qa.feedback.map((list) => list.filter((text) => new RegExp(re).test(text)).length),
    marks: window.__qa.resultMarks.map((list) => list.length),
  }), RESULT_RE.source);
  const players = game === 'double' ? [0, 1] : [0];
  session.driver = new GameDriver(session.page, game, players);
  session.driver.seenQuestions = players.map((p) => counts.questions[p]);
  session.driver.seenResults = players.map((p) => counts.results[p]);
  session.driver.seenMarks = players.map((p) => counts.marks[p]);
}

async function completeSixStages(session, game, questionsRemaining = 36) {
  // 每關 60 秒、每題 10 秒：逐題用桌面鍵盤答對，包含過關及第 3 關的繼續操作。
  for (let question = 0; question < questionsRemaining; question++) await session.driver.playQuestion('correct', 'correct');
  await session.driver.waitFor(
    (selectors) => selectors.every((s) => document.querySelector(s)?.hidden === false),
    '六關結果畫面',
    { arg: (game === 'double' ? [0, 1] : [0]).map((p) => selector(game, 'results', p)), maxMs: 20000 },
  );
}

function assertPayloads(posts, game) {
  assert.equal(posts.length, game === 'double' ? 2 : 1, '每位玩家同局只送一次');
  assert.deepEqual(posts.map((post) => post.data.caseId).sort(), game === 'double' ? ['S01', 'S02'] : ['S03']);
  for (const post of posts) {
    assert.equal(post.lessonId, '1140908_EFT', '動物追擊令網頁版分類為 EFT');
    assert.equal(post.data.mode, game);
    assert.ok(post.data.endTime >= post.data.startTime);
    const stats = Object.fromEntries(post.data.stats.map(({ apiname, value }) => [apiname, value]));
    assert.equal(stats.EFT_stage, 6);
    assert.deepEqual(stats.EFT_levelAccuracy.split(',').map(Number), [1, 1, 1, 1, 1, 1]);
    assert.equal(stats.EFT_questionCount, 36);
    assert.equal(stats.EFT_correct, 36);
    assert.equal(stats.EFT_wrong, 0);
    assert.ok(post.data.stats.every(({ apiname }) => apiname.startsWith('EFT_')));
  }
  if (game === 'double') {
    assert.ok(posts[0].data.pairId);
    assert.equal(posts[0].data.pairId, posts[1].data.pairId);
  }
}

async function assertReset(session, game) {
  await session.driver.waitFor(
    (selectors) => selectors.every((s) => {
      const image = document.querySelector(s);
      return image?.getAttribute('src')?.endsWith('rabbit.png') && image.naturalWidth > 0;
    }),
    '新局初始動物圖片預載完成',
    { arg: (game === 'double' ? [0, 1] : [0]).map((p) => selector(game, 'animal-image', p)), maxMs: 3000, stepMs: 100 },
  );
  const state = await session.page.evaluate((game) => {
    const roots = game === 'double' ? [...document.querySelectorAll('.player')] : [document];
    return roots.map((root) => {
      const q = (id) => root.querySelector(`[data-ui="${id}"], #${id}`);
      return { resultsHidden: q('results').hidden, score: q('score').textContent, round: q('round').textContent, image: q('animal-image').getAttribute('src') };
    });
  }, game);
  assert.equal(state.length, game === 'double' ? 2 : 1);
  for (const player of state) {
    assert.equal(player.resultsHidden, true, '雙方結算畫面都關閉');
    assert.equal(player.score, '0 分');
    assert.match(player.round, /第 1 \/ 6 關/);
    assert.match(player.image, /rabbit\.png$/);
  }
}

async function assertReplayRetainsResult(session, game) {
  await session.page.evaluate((s) => document.querySelector(s).click(), selector(game, 'restart'));
  const resultVisible = await session.page.evaluate((s) => !document.querySelector(s).hidden, selector(game, 'results'));
  assert.equal(resultVisible, true, '未存成績尚未解決前重玩必須保留結果');
}

describe('動物追擊令完整流程與存檔錯誤', () => {
  let server;
  let browser;
  before(async () => { server = await startStaticServer(); browser = await launchBrowser(); });
  after(async () => { await browser?.close(); await server?.close(); });

  for (const game of ['single', 'double']) {
    test(`${game}：練習進正式、六關 EFT 成績、離開不重送、同步重玩`, async () => {
      const session = await openGame(browser, server.origin, { game, mode: 'practice' });
      session.page.setDefaultTimeout(5000);
      try {
        await session.driver.playQuestion('correct', 'correct');
        await session.driver.playQuestion('correct', 'correct');
        await session.driver.waitFor(
          (game) => game === 'single' ? !document.querySelector('#results').hidden : window.__qa.feedback.every((list) => list.some((t) => t.startsWith('練習結束'))),
          '練習完成', { arg: game },
        );
        assert.equal(session.sessionPosts.length, 0, '練習不寫入成績');
        if (game === 'double') await resetDriver(session, game);
        await session.page.locator(game === 'single' ? '#btn-start-game' : '#enter-formal-btn').click();
        if (game === 'single') {
          await session.page.waitForURL('**/DAT_single.html?mode=game');
          await session.driver.waitFor(() => window.__qa?.feedback[0].some((t) => /動物身上/.test(t)), '正式模式載入');
        }
        if (game === 'single') session.driver = new GameDriver(session.page, game, [0]);
        await completeSixStages(session, game);
        await waitStatus(session, game, SAVED);
        assertPayloads(session.sessionPosts, game);

        await session.page.evaluate(() => { window.__leaveTargets = []; window.askLeave = (url) => window.__leaveTargets.push(url); document.querySelector('#leave-btn').click(); });
        await session.driver.waitFor(() => window.__leaveTargets.length === 1, '離開確認');
        assert.equal(session.sessionPosts.length, game === 'double' ? 2 : 1, '已完成成績離開時不可重複寫入');
        const firstPair = session.sessionPosts[0].data.pairId;
        await resetDriver(session, game);
        await session.page.locator(selector(game, 'restart')).click();
        await assertReset(session, game);
        if (game === 'double') {
          await session.driver.playQuestion('correct', 'correct');
          const scoresBeforeStaleClick = await session.page.locator('[data-ui="score"]').allTextContents();
          assert.deepEqual(scoresBeforeStaleClick, ['1 分', '1 分']);
          // P1 已啟動新局，P2 的上一局重玩事件晚到時不可再次清空新局。
          await session.page.evaluate((s) => document.querySelector(s).dispatchEvent(new MouseEvent('click', { bubbles: true })), selector(game, 'restart', 1));
          assert.deepEqual(await session.page.locator('[data-ui="score"]').allTextContents(), scoresBeforeStaleClick);
          await completeSixStages(session, game, 35);
          await waitStatus(session, game, SAVED);
          assertPayloads(session.sessionPosts.slice(2), game);
          assert.notEqual(session.sessionPosts[2].data.pairId, firstPair, '第二局建立新 pairId');
          assert.ok(session.sessionPosts[2].data.startTime > session.sessionPosts[0].data.startTime, '第二局有新的開始時間');
          await session.page.locator(selector(game, 'restart', 1)).click();
          await assertReset(session, game);
        } else {
          await completeSixStages(session, game);
          await waitStatus(session, game, SAVED);
          assertPayloads(session.sessionPosts.slice(1), game);
          assert.ok(session.sessionPosts[1].data.startTime > session.sessionPosts[0].data.startTime, '第二局有新的開始時間');
        }
        expectNoErrors(session);
      } finally { await session.context.close(); }
    });

    test(`${game}：HTTP 500 可人工重試、連按只送一次、成功後重玩`, async () => {
      let retryRoute;
      let notifyRetry;
      const retryArrived = new Promise((resolve) => { notifyRetry = resolve; });
      const session = await openGame(browser, server.origin, {
        game,
        routeOverride: async ({ route, request, url, sessionPosts }) => {
          if (!isSessionPost(request, url)) return false;
          const count = sessionPosts.filter((post) => post.data.caseId === request.postDataJSON().data.caseId).length;
          if (count === 1) await fulfillSession(route, 500);
          else if (request.postDataJSON().data.caseId === (game === 'single' ? 'S03' : 'S01')) { retryRoute = route; notifyRetry(); }
          else await fulfillSession(route);
          return true;
        },
      });
      try {
        await completeSixStages(session, game);
        await waitStatus(session, game, FAILED);
        const original = structuredClone(session.sessionPosts.find((post) => post.data.caseId === (game === 'single' ? 'S03' : 'S01')));
        await assertReplayRetainsResult(session, game);
        assert.equal(session.sessionPosts.length, game === 'double' ? 2 : 1);
        await session.page.evaluate((s) => { const button = document.querySelector(s); button.click(); button.click(); button.click(); }, selector(game, 'retry-save'));
        let retryDeadline;
        try {
          await Promise.race([
            retryArrived,
            new Promise((_, reject) => { retryDeadline = setTimeout(() => reject(new Error('人工重試未送出 API 請求')), 5000); }),
          ]);
        } finally { clearTimeout(retryDeadline); }
        await waitStatus(session, game, SAVING, [0]);
        await assertReplayRetainsResult(session, game);
        assert.equal(session.sessionPosts.length, game === 'double' ? 3 : 2, '連按重試不得產生並行寫入');
        assert.deepEqual(session.sessionPosts.at(-1), original, '重試保留原成績與時間戳');
        await fulfillSession(retryRoute);
        await waitStatus(session, game, SAVED, [0]);
        if (game === 'double') {
          await assertReplayRetainsResult(session, game);
          await session.page.locator(selector(game, 'retry-save', 1)).click();
          await waitStatus(session, game, SAVED);
        }
        await session.page.locator(selector(game, 'restart')).click();
        await assertReset(session, game);
        assert.deepEqual(session.pageErrors, [], '預期 HTTP 錯誤不應造成未處理例外');
      } finally { await session.context.close(); }
    });

    for (const failure of ['abort', 'timeout']) {
      test(`${game}：${failure} 結果未確認，不自動重送也不丟失結果`, async () => {
        const session = await openGame(browser, server.origin, {
          game,
          routeOverride: async ({ route, request, url }) => {
            if (!isSessionPost(request, url)) return false;
            if (failure === 'abort') await route.abort('failed');
            // timeout 故意不完成路由，讓真正 fetch 的逾時保護處理未知寫入結果。
            return true;
          },
        });
        try {
          await completeSixStages(session, game);
          await waitStatus(session, game, UNKNOWN);
          const count = session.sessionPosts.length;
          assert.equal(count, game === 'double' ? 2 : 1);
          const retryUnavailable = await session.page.evaluate((selectors) => selectors.every((s) => {
            const button = document.querySelector(s);
            return !button || button.hidden || button.disabled;
          }), (game === 'double' ? [0, 1] : [0]).map((p) => selector(game, 'retry-save', p)));
          assert.equal(retryUnavailable, true, '結果未知時不可提供會重複寫入的重試');
          await assertReplayRetainsResult(session, game);
          // 時間推進一分鐘後仍無重送，並持續顯示可供確認的成績。
          await session.page.clock.runFor(60000);
          assert.equal(session.sessionPosts.length, count);
          await waitStatus(session, game, UNKNOWN);
          assert.deepEqual(session.pageErrors, []);
        } finally { await session.context.close(); }
      });
    }
  }
});
