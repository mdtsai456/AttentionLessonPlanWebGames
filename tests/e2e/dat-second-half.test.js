// 後半那一局：當天同模式只完成前 3 關時，進遊戲直接從第 4 關開始，打完只送一筆只含第 4～6 關的 stage 6。
// 用 routeOverride 模擬後端報表（/api/students/{key}/report）。openGame 登入的課次是 1。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { GameDriver, RESULT_RE, startStaticServer, launchBrowser, openGame, leaveDialog } from './helpers.js';
import { expectNoErrors } from './expect.js';

const SAVED = '成績已儲存';
const FAILED = '成績儲存失敗，請重試';
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEYS = { single: ['G1_S03'], double: ['G1_S01', 'G1_S02'] };
const TOKENS = { G1_S01: 'student-S01', G1_S02: 'student-S02', G1_S03: 'student-S03' };
const selector = (game, id, p = 0) => game === 'single' ? `#${id}` : `.player-${p + 1} [data-ui="${id}"]`;
const statsOf = (post) => Object.fromEntries(post.data.stats.map(({ apiname, value }) => [apiname, value]));

// 今天在 mode 模式只完成前半的紀錄
const firstHalf = (mode, stats = {}) => ({ gameType: 'DAT', mode, currentDay: 1, stats: { stage: 3, ...stats } });

/**
 * 模擬報表與成績 API。reports 以 studentKey 對應紀錄；reportRequests 記錄被查詢的 studentKey。
 * failFirstStage6 指定的 caseId 第一次送 stage 6 時回 500。
 */
function backend(reports, { failFirstStage6 = null } = {}) {
  const reportRequests = [];
  const routeOverride = async ({ route, request, url, sessionPosts }) => {
    const { pathname } = new URL(url);
    const match = pathname.match(/\/api\/students\/([^/]+)\/report$/);
    if (match) {
      const key = decodeURIComponent(match[1]);
      reportRequests.push(key);
      assert.equal(request.headers().authorization, `Bearer ${TOKENS[key]}`, `${key} 用自己的 token 讀報表`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ records: reports[key] || [] }),
      });
      return true;
    }
    if (request.method() !== 'POST' || !pathname.endsWith('/api/sessions')) return false;
    const { data } = request.postDataJSON();
    const stage6 = sessionPosts.filter((post) => post.data.caseId === data.caseId && statsOf(post).DAT_stage === 6);
    const failed = data.caseId === failFirstStage6 && stage6.length === 1;
    await route.fulfill({
      status: failed ? 500 : 201,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(failed ? { detail: '測試存檔失敗' } : { sessionId: 'second-half-test' }),
    });
    return true;
  };
  return { reportRequests, routeOverride };
}

async function rounds(session, game) {
  const players = game === 'double' ? [0, 1] : [0];
  return Promise.all(players.map((p) => session.page.locator(selector(game, 'round', p)).textContent()));
}

async function assertStage(session, game, stage, label) {
  for (const round of await rounds(session, game)) assert.match(round, new RegExp(`第 ${stage} / 6 關`), label);
}

async function waitStatus(session, game, text) {
  const selectors = (game === 'double' ? [0, 1] : [0]).map((p) => selector(game, 'save-status', p));
  await session.driver.waitFor(
    ({ selectors, text }) => selectors.every((s) => document.querySelector(s)?.textContent === text),
    text,
    { arg: { selectors, text }, maxMs: 30000 },
  );
}

// 從第 4 關打到第 6 關結束：每關 6 題，共 18 題全部答對。
async function playSecondHalf(session, game) {
  for (let i = 0; i < 18; i++) await session.driver.playQuestion('correct', 'correct');
  await session.driver.waitFor(
    (selectors) => selectors.every((s) => document.querySelector(s)?.hidden === false),
    '六關結果畫面',
    { arg: (game === 'double' ? [0, 1] : [0]).map((p) => selector(game, 'results', p)), maxMs: 20000 },
  );
}

// 後半那一局只送 stage 6：每人一筆、新的 submissionId、只含第 4～6 關
function assertSecondHalfPosts(posts, game) {
  assert.equal(posts.length, KEYS[game].length, '每位玩家只送一筆');
  for (const post of posts) {
    const stats = statsOf(post);
    const who = post.data.caseId;
    assert.equal(stats.DAT_stage, 6, `${who} 不送 stage 3`);
    assert.equal(stats.DAT_levelAccuracy, '1,1,1', `${who} levelAccuracy 只有第 4～6 關`);
    assert.equal(stats.DAT_questionCount, 18, `${who} 題數只算後半`);
    assert.equal(stats.DAT_correct, 18);
    assert.equal(stats.DAT_wrong, 0);
    assert.equal(stats.DAT_accuracy, 1);
    assert.ok(stats.DAT_duration <= 3 * 60000 + 10000, `${who} 時長只算後半：${stats.DAT_duration}`);
    assert.equal(post.data.endTime - post.data.startTime, stats.DAT_duration);
    assert.match(post.data.submissionId, V4);
    assert.equal(post.data.mode, game);
  }
  assert.equal(new Set(posts.map((post) => post.data.submissionId)).size, posts.length);
  if (game === 'double') {
    assert.ok(posts[0].data.pairId);
    assert.equal(posts[0].data.pairId, posts[1].data.pairId);
  }
}

describe('動物追擊令後半那一局', () => {
  let server;
  let browser;
  before(async () => { server = await startStaticServer(); browser = await launchBrowser(); });
  after(async () => { await browser?.close(); await server?.close(); });

  for (const game of ['single', 'double']) {
    const allFirstHalf = Object.fromEntries(KEYS[game].map((key) => [key, [firstHalf(game)]]));

    test(`${game}：今天只完成前半 → 從第 4 關開始、不出現中場，打完只送 stage 6；再玩一次從第 1 關`, async () => {
      const { reportRequests, routeOverride } = backend(allFirstHalf);
      const session = await openGame(browser, server.origin, { game, routeOverride });
      try {
        assert.deepEqual([...reportRequests].sort(), KEYS[game], '每位學生各查一次報表');
        await assertStage(session, game, 4, '一進場就是第 4 關');
        const progress = await session.page.locator(game === 'single' ? '#progress' : '.player-1 [data-ui="progress"]').getAttribute('aria-valuenow');
        assert.equal(progress, '50', '進度條從 50% 開始');

        await playSecondHalf(session, game);
        await waitStatus(session, game, SAVED);
        assertSecondHalfPosts(session.sessionPosts, game);
        if (game === 'double') {
          const midBreakShown = await session.page.evaluate(() => window.__qa.feedback.flat().some((t) => t.startsWith('第 3 關已結束')));
          assert.equal(midBreakShown, false, '不出現中場');
        }

        await session.page.locator(selector(game, 'restart')).click();
        await assertStage(session, game, 1, '再玩一次是新的一局，從第 1 關開始');
        assert.equal(reportRequests.length, KEYS[game].length, '再玩一次不再查報表');
        expectNoErrors(session);
      } finally { await session.context.close(); }
    });

    for (const leaveStage of [4, 5]) {
      test(`${game}：後半那一局在第 ${leaveStage} 關離開，什麼都不送`, async () => {
        const { routeOverride } = backend(allFirstHalf);
        const session = await openGame(browser, server.origin, { game, routeOverride });
        try {
          // 第 4 關 6 題；要在第 5 關離開就多打完第 4 關，再進第 5 關答 1 題
          const questions = leaveStage === 4 ? 1 : 7;
          for (let i = 0; i < questions; i++) await session.driver.playQuestion('correct', 'correct');
          await assertStage(session, game, leaveStage);
          await session.page.locator('#leave-btn').click();
          await leaveDialog(session.page).getByRole('button', { name: '離開', exact: true }).click();
          await session.page.waitForURL('**/Select/index.html');
          assert.deepEqual(session.sessionPosts, [], '不送 stage 3，也不送 stage 4、5');
          assert.deepEqual(session.dialogs, []);
          expectNoErrors(session);
        } finally { await session.context.close(); }
      });
    }

    test(`${game}：後半打完 stage 6 送失敗，離開時照舊重送同一筆，成功才回大廳`, async () => {
      const failing = game === 'single' ? 'S03' : 'S01';
      const { routeOverride } = backend(allFirstHalf, { failFirstStage6: failing });
      const session = await openGame(browser, server.origin, { game, routeOverride });
      try {
        await playSecondHalf(session, game);
        await session.driver.waitFor(
          ({ s, text }) => document.querySelector(s)?.textContent === text,
          FAILED,
          { arg: { s: selector(game, 'save-status'), text: FAILED }, maxMs: 30000 },
        );
        const count = session.sessionPosts.length;
        assert.equal(count, KEYS[game].length);
        // 打完六關按「離開」不再確認
        await session.page.locator('#leave-btn').click();
        await session.page.waitForURL('**/Select/index.html');
        assert.equal(session.sessionPosts.length, count + 1, '只重送失敗的那一筆');
        const posts = session.sessionPosts.filter((post) => post.data.caseId === failing);
        assert.deepEqual(posts[1], posts[0], '重送同一筆 stage 6');
        assertSecondHalfPosts(session.sessionPosts.slice(0, count), game);
        assert.deepEqual(session.dialogs, []);
        assert.deepEqual(session.pageErrors, []);
      } finally { await session.context.close(); }
    });

    test(`${game}：今天已有 stage 6 → 照舊從第 1 關開始`, async () => {
      const reports = Object.fromEntries(KEYS[game].map((key) => [key, [firstHalf(game), firstHalf(game, { stage: 6 })]]));
      const { reportRequests, routeOverride } = backend(reports);
      const session = await openGame(browser, server.origin, { game, routeOverride });
      try {
        assert.equal(reportRequests.length, KEYS[game].length);
        await assertStage(session, game, 1);
        expectNoErrors(session);
      } finally { await session.context.close(); }
    });
  }

  test('single：報表沒有紀錄 → 從第 1 關開始', async () => {
    const { reportRequests, routeOverride } = backend({});
    const session = await openGame(browser, server.origin, { game: 'single', routeOverride });
    try {
      assert.deepEqual(reportRequests, ['G1_S03']);
      await assertStage(session, 'single', 1);
      expectNoErrors(session);
    } finally { await session.context.close(); }
  });

  test('single：練習模式不查報表', async () => {
    const { reportRequests, routeOverride } = backend({ G1_S03: [firstHalf('single')] });
    const session = await openGame(browser, server.origin, { game: 'single', mode: 'practice', routeOverride });
    try {
      assert.match(await session.page.locator('#round').textContent(), /練習關卡/);
      assert.deepEqual(reportRequests, []);
      expectNoErrors(session);
    } finally { await session.context.close(); }
  });

  test('double：只有一人今天完成前半 → 兩人都從第 1 關開始', async () => {
    const { reportRequests, routeOverride } = backend({ G1_S01: [firstHalf('double')] });
    const session = await openGame(browser, server.origin, { game: 'double', routeOverride });
    try {
      assert.deepEqual([...reportRequests].sort(), ['G1_S01', 'G1_S02']);
      await assertStage(session, 'double', 1);
      expectNoErrors(session);
    } finally { await session.context.close(); }
  });

  test('double：練習時不查報表，按「進入正式遊戲」才查，兩人都完成前半就從第 4 關開始', async () => {
    const { reportRequests, routeOverride } = backend({ G1_S01: [firstHalf('double')], G1_S02: [firstHalf('double')] });
    const session = await openGame(browser, server.origin, { game: 'double', mode: 'practice', routeOverride });
    try {
      await session.driver.playQuestion('correct', 'correct');
      await session.driver.playQuestion('correct', 'correct');
      await session.driver.waitFor(
        () => window.__qa.feedback.every((list) => list.some((t) => t.startsWith('練習結束'))),
        '練習完成',
      );
      assert.deepEqual(reportRequests, [], '練習模式不查報表');
      // 練習的題目與判定已經記錄過，新的 driver 從目前的數量往後算
      const counts = await session.page.evaluate((re) => ({
        questions: window.__qa.questions.map((list) => list.length),
        results: window.__qa.feedback.map((list) => list.filter((text) => new RegExp(re).test(text)).length),
        marks: window.__qa.resultMarks.map((list) => list.length),
      }), RESULT_RE.source);
      session.driver = new GameDriver(session.page, 'double', [0, 1]);
      session.driver.seenQuestions = counts.questions;
      session.driver.seenResults = counts.results;
      session.driver.seenMarks = counts.marks;
      await session.page.locator('#enter-formal-btn').click();
      await session.driver.waitFor(
        () => [...document.querySelectorAll('[data-ui="field"]')].every((field) => field.dataset.mode === 'game'),
        '進入正式模式',
      );
      assert.deepEqual([...reportRequests].sort(), ['G1_S01', 'G1_S02']);
      await assertStage(session, 'double', 4);
      await playSecondHalf(session, 'double');
      await waitStatus(session, 'double', SAVED);
      assertSecondHalfPosts(session.sessionPosts, 'double');
      expectNoErrors(session);
    } finally { await session.context.close(); }
  });
});
