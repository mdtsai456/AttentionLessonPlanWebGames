// 確定離開後遊戲時鐘維持暫停（review R3）：存檢查點期間遊戲不能往下打、不能多送一筆；
// 存檔的逾時要用原生計時器，否則暫停中的請求永遠等不到逾時；
// 存檔沒成功、學生留在頁面時要解除暫停，遊戲照常繼續。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStaticServer, launchBrowser, openGame, leaveDialog } from './helpers.js';

const stageOf = (post) => post.data.stats.find((stat) => stat.apiname === 'DAT_stage').value;
const isSessionPost = (request) => /\/api\/sessions$/.test(new URL(request.url()).pathname) && request.method() === 'POST';

// 到中場時遊戲會自動先送第 3 關。這裡讓那一筆先回 500，確定離開時才要重送檢查點，
// 測的是離開當下的那次送出。
const MIDWAY_FAILS = 500;

// 成績 API：中場那筆回 500；之後 slow 延遲 1.5 秒（真實時間）才回 201；hang 永不回應；fail 回 500
function sessionRoute(kind) {
  return async ({ route, request, sessionPosts }) => {
    if (!isSessionPost(request)) return false;
    const headers = { 'Access-Control-Allow-Origin': '*' };
    const caseId = request.postDataJSON().data.caseId;
    if (sessionPosts.filter((post) => post.data.caseId === caseId).length === 1) {
      await route.fulfill({ status: MIDWAY_FAILS, contentType: 'application/json', headers, body: '{}' });
      return true;
    }
    if (kind === 'hang') return true;
    if (kind === 'fail') {
      await route.fulfill({ status: 500, contentType: 'application/json', headers, body: '{}' });
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ status: 201, contentType: 'application/json', headers, body: JSON.stringify({ sessionId: 'slow' }) });
    return true;
  };
}

// 打到第 4 關，按離開→確定
async function confirmLeaveAtStage4(session, game) {
  for (let i = 0; i < 19; i++) await session.driver.playQuestion('correct', 'correct');
  const round = await session.page.locator(game === 'single' ? '#round' : '.player-1 [data-ui="round"]').textContent();
  assert.match(round, /第 4 \/ 6 關/);
  await session.page.locator('#leave-btn').click();
  const dialog = leaveDialog(session.page);
  await dialog.getByRole('button', { name: '離開', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}

const progress = (page) => page.evaluate(() => ({
  questions: window.__qa.questions.map((list) => list.length),
  feedback: window.__qa.feedback.map((list) => list.length),
}));

// 依每位玩家第幾次送出決定回應：'hang' 不回應（逾時）、數字為 HTTP 狀態
function sequenceRoute(steps) {
  return async ({ route, request, sessionPosts }) => {
    if (!isSessionPost(request)) return false;
    const caseId = request.postDataJSON().data.caseId;
    const step = steps[sessionPosts.filter((post) => post.data.caseId === caseId).length - 1] ?? 201;
    if (step === 'hang') return true;
    await route.fulfill({
      status: step, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(step === 201 ? { sessionId: `seq-${caseId}` } : { detail: '測試失敗' }),
    });
    return true;
  };
}

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('確定離開後的存檔與暫停', () => {
  let server;
  let browser;
  before(async () => { server = await startStaticServer(); browser = await launchBrowser(); });
  after(async () => { await browser?.close(); await server?.close(); });

  for (const game of ['single', 'double']) {
    const players = game === 'double' ? 2 : 1;

    test(`${game}：存檔慢（1.5 秒）時遊戲維持暫停、不多送，存好後回選遊戲頁`, async () => {
      const session = await openGame(browser, server.origin, { game, routeOverride: sessionRoute('slow') });
      session.page.setDefaultTimeout(8000);
      try {
        await confirmLeaveAtStage4(session, game);
        const before = await progress(session.page);
        assert.equal(await session.page.evaluate(() => window.WebGameRuntime.paused), true, '存檔中遊戲暫停');
        // 遊戲時間快轉 9 秒（存檔逾時 10 秒之內）：暫停中不出新題、不判定、不送第 4 關以後的成績
        await session.page.clock.runFor(9000);
        assert.deepEqual(await progress(session.page), before, '存檔期間遊戲不能往下打');
        await session.page.waitForURL('**/Select/index.html');
        assert.equal(session.sessionPosts.length, players * 2, '每位玩家只在中場與離開各送一次第 3 關檢查點');
        for (const post of session.sessionPosts) assert.equal(stageOf(post), 3);
        assert.deepEqual(session.dialogs, []);
        assert.deepEqual(session.pageErrors, []);
      } finally { await session.context.close(); }
    });

    test(`${game}：存檔沒回應時，暫停中仍會逾時，顯示未確認並恢復遊戲`, async () => {
      const session = await openGame(browser, server.origin, { game, routeOverride: sessionRoute('hang') });
      session.page.setDefaultTimeout(8000);
      try {
        await confirmLeaveAtStage4(session, game);
        const before = await progress(session.page);
        await session.page.clock.runFor(9000);
        assert.deepEqual(await progress(session.page), before, '逾時前遊戲維持暫停');
        assert.equal(await session.page.evaluate(() => window.WebGameRuntime.paused), true);
        // 存檔逾時 10 秒；用的是原生計時器，遊戲暫停時照樣會到
        await session.page.clock.runFor(2000);
        await session.page.locator('#checkpoint-save-status').filter({ hasText: '存檔結果未確認' }).waitFor();
        assert.ok(session.page.url().includes(`DAT_${game}.html`), '結果不明時留在遊戲頁');
        assert.equal(await session.page.evaluate(() => window.WebGameRuntime.paused), false, '留在頁面時遊戲恢復');
        await session.driver.playQuestion('correct', 'correct');
        assert.equal(session.sessionPosts.length, players * 2, '不自動重送檢查點');
        assert.deepEqual(session.dialogs, []);
        assert.deepEqual(session.pageErrors, []);
      } finally { await session.context.close(); }
    });

    test(`${game}：確定離開後存檔還沒回應時，按作答鍵、點作答鈕、方向鍵都不改變分數與狀態`, async () => {
      const session = await openGame(browser, server.origin, { game, routeOverride: sessionRoute('hang') });
      session.page.setDefaultTimeout(8000);
      try {
        for (let i = 0; i < 19; i++) await session.driver.playQuestion('correct', 'correct');
        // 等下一題出現（作答階段），作答鈕可按
        await session.driver.waitFor((n) => window.__qa.questions[0].length > n, '第 20 題出現', { arg: 19 });
        await session.page.locator('#leave-btn').click();
        const dialog = leaveDialog(session.page);
        await dialog.getByRole('button', { name: '離開', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        const state = () => session.page.evaluate(() => ({
          scores: [...document.querySelectorAll('#score, [data-ui="score"]')].map((el) => el.textContent),
          feedback: window.__qa.feedback.map((list) => list.length),
          marks: window.__qa.resultMarks.map((list) => list.length),
          aims: [...document.querySelectorAll('#crosshair, [data-ui="crosshair"]')].map((el) => `${el.style.left},${el.style.top}`),
        }));
        const before = await state();
        assert.equal(await session.page.evaluate(() => window.WebGameRuntime.paused), true);
        for (const key of session.driver.keys) await session.page.keyboard.press(key);
        await session.page.evaluate(() => document.querySelectorAll('#answer-true, [data-ui="answer-true"]').forEach((button) => button.click()));
        for (const key of ['KeyD', 'ArrowRight']) await session.page.keyboard.down(key);
        await session.page.clock.runFor(3000);
        for (const key of ['KeyD', 'ArrowRight']) await session.page.keyboard.up(key);
        assert.deepEqual(await state(), before, '存檔中（遊戲暫停）作答與移動準心都無效');
        assert.equal(session.sessionPosts.length, players * 2);
      } finally { await session.context.close(); }
    });

    test(`${game}：檢查點逾時後再按離開，用同一個 submissionId 重送；重送失敗留在頁面，再按一次成功才回選遊戲頁（#42）`, async () => {
      const session = await openGame(browser, server.origin, { game, routeOverride: sequenceRoute([MIDWAY_FAILS, 'hang', 500, 201]) });
      session.page.setDefaultTimeout(8000);
      const dialog = leaveDialog(session.page);
      const leave = async () => {
        await session.page.locator('#leave-btn').click();
        await dialog.getByRole('button', { name: '離開', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
      };
      try {
        await confirmLeaveAtStage4(session, game);
        // 第一次：逾時，結果不明，留在頁面；重試鈕可按（重送不會多一筆）
        await session.page.clock.runFor(11000);
        await session.page.locator('#checkpoint-save-status').filter({ hasText: '存檔結果未確認' }).waitFor();
        await session.page.locator('#checkpoint-retry-save').waitFor({ state: 'visible' });
        assert.equal(session.sessionPosts.length, players * 2);
        assert.equal(await session.page.evaluate(() => window.WebGameRuntime.paused), false);

        // 第二次：按離開→確定，自動重送同一筆，伺服器回 500 → 留在頁面、遊戲恢復
        await leave();
        await session.page.locator('#checkpoint-save-status').filter({ hasText: '成績儲存失敗' }).waitFor();
        assert.equal(session.sessionPosts.length, players * 3);
        assert.ok(session.page.url().includes(`DAT_${game}.html`), '重送失敗留在遊戲頁');
        assert.equal(await session.page.evaluate(() => window.WebGameRuntime.paused), false, '重送失敗後遊戲恢復');
        await session.driver.playQuestion('correct', 'correct');

        // 第三次：再按離開→確定，重送成功才回選遊戲頁
        await leave();
        await session.page.waitForURL('**/Select/index.html');
        assert.equal(session.sessionPosts.length, players * 4);
        for (const caseId of new Set(session.sessionPosts.map((post) => post.data.caseId))) {
          const posts = session.sessionPosts.filter((post) => post.data.caseId === caseId);
          // 中場那一筆加上離開時的三次重送，都是同一筆。
          assert.equal(posts.length, 4);
          assert.match(posts[0].data.submissionId, V4);
          for (const post of posts) {
            assert.equal(stageOf(post), 3, '只送第 3 關檢查點');
            assert.deepEqual(post, posts[0], `${caseId} 每次重送都是同一筆（同一個 submissionId、同樣內容）`);
          }
        }
        if (game === 'double') {
          const ids = new Set(session.sessionPosts.map((post) => post.data.submissionId));
          assert.equal(ids.size, 2, '兩位玩家各自一個 submissionId');
        }
        assert.deepEqual(session.dialogs, []);
        assert.deepEqual(session.pageErrors, []);
      } finally { await session.context.close(); }
    });

    test(`${game}：確定離開後存檔失敗，留在頁面並恢復遊戲`, async () => {
      const session = await openGame(browser, server.origin, { game, routeOverride: sessionRoute('fail') });
      session.page.setDefaultTimeout(8000);
      try {
        await confirmLeaveAtStage4(session, game);
        await session.page.locator('#checkpoint-retry-save').waitFor({ state: 'visible' });
        assert.ok(session.page.url().includes(`DAT_${game}.html`), '存檔失敗留在遊戲頁');
        assert.equal(await session.page.evaluate(() => window.WebGameRuntime.paused), false, '存檔失敗後遊戲恢復');
        assert.equal(await session.page.locator('#leave-btn').isEnabled(), true);
        await session.driver.playQuestion('correct', 'correct');
        assert.equal(session.sessionPosts.length, players * 2);
        assert.deepEqual(session.dialogs, []);
        assert.deepEqual(session.pageErrors, []);
      } finally { await session.context.close(); }
    });
  }
});
