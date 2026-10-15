// 完整生命週期與存檔契約測試。openGame 攔截所有外部流量。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { GameDriver, RESULT_RE, startStaticServer, launchBrowser, openGame, leaveDialog } from './helpers.js';
import { expectNoErrors } from './expect.js';

const SAVED = '成績已儲存';
const FAILED = '成績儲存失敗，請重試';
const SAVING = '儲存中…';
const UNKNOWN = '存檔結果未確認，請按重試（不會重複記錄）';
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const selector = (game, id, p = 0) => game === 'single' ? `#${id}` : `.player-${p + 1} [data-ui="${id}"]`;
const isSessionPost = (request, url) => request.method() === 'POST' && new URL(url).pathname.endsWith('/api/sessions');
const stageOf = (post) => post.data.stats.find((stat) => stat.apiname === 'DAT_stage').value;

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

// 同一局每位玩家送兩次：中場先送第 3 關，打完再用同一個 submissionId 送第 6 關（後端更新同一列）。
function assertPayloads(all, game) {
  const midway = all.filter((post) => stageOf(post) === 3);
  const posts = all.filter((post) => stageOf(post) === 6);
  assert.equal(all.length, midway.length + posts.length, '只送第 3 關與第 6 關');
  assert.equal(midway.length, game === 'double' ? 2 : 1, '每位玩家中場只送一次');
  for (const post of posts) {
    const own = midway.find((item) => item.data.caseId === post.data.caseId);
    assert.equal(own?.data.submissionId, post.data.submissionId, '第 6 關沿用中場的 submissionId');
  }
  assert.equal(posts.length, game === 'double' ? 2 : 1, '每位玩家同局只送一次第 6 關');
  assert.deepEqual(posts.map((post) => post.data.caseId).sort(), game === 'double' ? ['S01', 'S02'] : ['S03']);
  for (const post of posts) {
    assert.equal(post.lessonId, '1140908_DAT', '瓢蟲追擊令成績代號為 DAT');
    assert.equal(post.data.mode, game);
    assert.ok(post.data.endTime >= post.data.startTime);
    const stats = Object.fromEntries(post.data.stats.map(({ apiname, value }) => [apiname, value]));
    assert.equal(stats.DAT_stage, 6);
    assert.deepEqual(stats.DAT_levelAccuracy.split(',').map(Number), [1, 1, 1, 1, 1, 1]);
    assert.equal(stats.DAT_questionCount, 36);
    assert.equal(stats.DAT_correct, 36);
    assert.equal(stats.DAT_wrong, 0);
    assert.ok(post.data.stats.every(({ apiname }) => apiname.startsWith('DAT_')));
    assert.match(post.data.submissionId, V4, '每筆成績帶 UUID v4 的 submissionId（#42）');
  }
  assert.equal(new Set(posts.map((post) => post.data.submissionId)).size, posts.length, '每位玩家各自一個 submissionId');
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

        // 六關成績已儲存後，離開直接返回選單，不再詢問。導覽回傳 204，讓頁面留在原地，接著測試重玩。
        let lobbyNavigations = 0;
        await session.page.route('**/Select/index.html', (route) => { lobbyNavigations++; return route.fulfill({ status: 204 }); });
        await session.page.locator('#leave-btn').click();
        for (let i = 0; i < 50 && lobbyNavigations === 0; i++) await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(lobbyNavigations, 1, '離開要導向選遊戲頁');
        assert.deepEqual(session.dialogs, [], '六關已打完離開：不跳出瀏覽器的離開詢問');
        assert.equal(await leaveDialog(session.page).count(), 0, '六關已打完離開：不再確認');
        await session.page.unroute('**/Select/index.html');
        assert.equal(session.sessionPosts.length, game === 'double' ? 4 : 2, '已完成成績離開時不可重複寫入');
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
          assertPayloads(session.sessionPosts.slice(4), game);
          assert.notEqual(session.sessionPosts[4].data.pairId, firstPair, '第二局建立新 pairId');
          assert.equal(new Set(session.sessionPosts.map((post) => post.data.submissionId)).size, 4, '第二局是新的 submissionId');
          assert.ok(session.sessionPosts[4].data.startTime > session.sessionPosts[0].data.startTime, '第二局有新的開始時間');
          await session.page.locator(selector(game, 'restart', 1)).click();
          await assertReset(session, game);
        } else {
          await completeSixStages(session, game);
          await waitStatus(session, game, SAVED);
          assertPayloads(session.sessionPosts.slice(2), game);
          assert.ok(session.sessionPosts[2].data.startTime > session.sessionPosts[0].data.startTime, '第二局有新的開始時間');
          assert.notEqual(session.sessionPosts[2].data.submissionId, session.sessionPosts[0].data.submissionId, '第二局是新的 submissionId');
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
          const body = request.postDataJSON();
          // 中場先送的第 3 關照常成功；第一次送的第 6 關回 500，之後 P1 的重試卡住由測試放行。
          if (stageOf(body) === 3) { await fulfillSession(route); return true; }
          const count = sessionPosts.filter((post) => post.data.caseId === body.data.caseId && stageOf(post) === 6).length;
          if (count === 1) await fulfillSession(route, 500);
          else if (request.postDataJSON().data.caseId === (game === 'single' ? 'S03' : 'S01')) { retryRoute = route; notifyRetry(); }
          else await fulfillSession(route);
          return true;
        },
      });
      try {
        await completeSixStages(session, game);
        await waitStatus(session, game, FAILED);
        const original = structuredClone(session.sessionPosts.find((post) => post.data.caseId === (game === 'single' ? 'S03' : 'S01') && stageOf(post) === 6));
        await assertReplayRetainsResult(session, game);
        assert.equal(session.sessionPosts.length, game === 'double' ? 4 : 2);
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
        assert.equal(session.sessionPosts.length, game === 'double' ? 5 : 3, '連按重試不得產生並行寫入');
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

    // #42：結果不明不會自己重送；成績帶 submissionId，重送不會多一筆，所以可以重試，
    // 打完六關按「離開」也會用同一個 submissionId 再送一次，成功才回選遊戲頁。
    for (const failure of ['abort', 'timeout']) {
      test(`${game}：${failure} 結果未確認，不自動重送；${failure === 'abort' ? '按重試' : '按離開'}用同一個 submissionId 重送後可以離開`, async () => {
        let serverBack = false;
        const session = await openGame(browser, server.origin, {
          game,
          routeOverride: async ({ route, request, url }) => {
            if (!isSessionPost(request, url)) return false;
            if (serverBack) await fulfillSession(route);
            else if (failure === 'abort') await route.abort('failed');
            // timeout 情況不完成路由回應，讓 fetch 的逾時處理應對未知的寫入結果。
            return true;
          },
        });
        try {
          await completeSixStages(session, game);
          await waitStatus(session, game, UNKNOWN);
          // 中場的第 3 關與打完的第 6 關都結果不明。
          const players = game === 'double' ? 2 : 1;
          const count = session.sessionPosts.length;
          assert.equal(count, players * 2);
          const retryAvailable = await session.page.evaluate((selectors) => selectors.every((s) => {
            const button = document.querySelector(s);
            return button && !button.hidden && !button.disabled;
          }), (game === 'double' ? [0, 1] : [0]).map((p) => selector(game, 'retry-save', p)));
          assert.equal(retryAvailable, true, '結果未知時可以重試（同一個 submissionId 不會重複寫入）');
          await assertReplayRetainsResult(session, game);
          // 時間推進一分鐘後仍無自動重送，並持續顯示可供確認的成績。
          await session.page.clock.runFor(60000);
          assert.equal(session.sessionPosts.length, count);
          await waitStatus(session, game, UNKNOWN);

          serverBack = true;
          if (failure === 'abort') {
            for (const p of game === 'double' ? [0, 1] : [0]) await session.page.locator(selector(game, 'retry-save', p)).click();
            await waitStatus(session, game, SAVED);
            assert.equal(session.sessionPosts.length, count + players);
          }
          // 打完六關按離開：不再確認；未存好的成績用同一個 submissionId 再送一次，成功才導頁
          await session.page.locator('#leave-btn').click();
          await session.page.waitForURL('**/Select/index.html', { timeout: 5000 });
          // 只重送第 6 關：它和中場的第 3 關是同一個 submissionId，後端會以第 6 關為準。
          assert.equal(session.sessionPosts.length, count + players, '每位玩家只重送一次，已存好的不再送');
          for (const caseId of new Set(session.sessionPosts.map((post) => post.data.caseId))) {
            const posts = session.sessionPosts.filter((post) => post.data.caseId === caseId && stageOf(post) === 6);
            assert.equal(posts.length, 2);
            assert.match(posts[0].data.submissionId, V4);
            assert.deepEqual(posts[1], posts[0], `${caseId} 重送同一筆（同一個 submissionId、同樣內容）`);
          }
          assert.deepEqual(session.dialogs, []);
          assert.deepEqual(session.pageErrors, []);
        } finally { await session.context.close(); }
      });
    }
  }
});
