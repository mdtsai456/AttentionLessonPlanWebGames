// 桌面 Chrome 實際幾何：保留真實準心與動物位置，使用鍵盤、滑鼠操控。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStaticServer, launchBrowser, openGame, RESULT_RE } from './helpers.js';
import { expectNoErrors } from './expect.js';

const selector = (game, id, p = 0) => game === 'single' ? `#${id}` : `.player-${p + 1} [data-ui="${id}"]`;

async function positions(page, game) {
  return page.evaluate((game) => {
    const roots = game === 'double' ? [...document.querySelectorAll('.player')] : [document];
    return roots.map((root) => {
      const cross = root.querySelector('#crosshair, [data-ui="crosshair"]');
      return { x: parseFloat(cross.style.left), y: parseFloat(cross.style.top) };
    });
  }, game);
}

async function holdMouseDirection(session, game, player, direction, duration) {
  const button = session.page.locator(game === 'single' ? `[data-move="${direction}"]` : `.player-${player + 1} [data-move="${direction}"]`);
  const box = await button.boundingBox();
  assert.ok(box, '滑鼠方向按鈕必須在桌面畫面可見');
  await session.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await session.page.mouse.down();
  await session.page.clock.runFor(duration);
  await session.page.mouse.up();
}

describe('動物追擊令桌面鍵盤滑鼠', () => {
  let server;
  let browser;
  before(async () => { server = await startStaticServer(); browser = await launchBrowser(); });
  after(async () => { await browser?.close(); await server?.close(); });

  for (const game of ['single', 'double']) {
    test(`${game}：方向按鈕按住移動與放開停止、鍵盤瞄準、連按計一次、失焦清鍵`, async () => {
      const session = await openGame(browser, server.origin, { game, mode: game === 'double' ? 'practice' : 'game', realAim: true });
      const players = game === 'double' ? [0, 1] : [0];
      const movementKeys = game === 'double' ? ['KeyD', 'ArrowRight'] : ['ArrowRight'];
      try {
        await session.page.evaluate(() => { Math.random = () => 0.25; });
        // 雙人於開始正式局時已產生首題；先固定亂數再以畫面按鈕開始正式局。
        if (game === 'double') await session.page.locator('#enter-formal-btn').click({ timeout: 5000 });
        assert.deepEqual(await positions(session.page, game), players.map(() => ({ x: 25, y: 50 })));
        for (const p of players) {
          const before = await positions(session.page, game);
          await holdMouseDirection(session, game, p, 'left', 300);
          const after = await positions(session.page, game);
          assert.ok(after[p].x < before[p].x, `P${p + 1} 按住滑鼠方向鈕必須移動`);
          for (const other of players.filter((i) => i !== p)) assert.deepEqual(after[other], before[other], '玩家方向操作互不影響');
          await session.page.clock.runFor(300);
          assert.deepEqual(await positions(session.page, game), after, '滑鼠放開後準心停止');
        }
        assert.ok((await session.page.locator(selector(game, 'question-type')).textContent()).includes('等待瞄準'));
        for (const key of movementKeys) await session.page.keyboard.down(key);
        await session.driver.waitFor(
          (count) => window.__qa.questions.slice(0, count).every((list) => list.length === 1),
          '以實際準心碰到動物開始題目', { arg: players.length, stepMs: 20, maxMs: 3000 },
        );
        // 剛進入命中邊緣時仍持續移動一個畫格，讓兩人的準心都進到動物內部。
        await session.page.clock.runFor(100);
        for (const key of movementKeys) await session.page.keyboard.up(key);
        const aimed = await positions(session.page, game);
        assert.ok(aimed.every((position) => position.x > 40), '須實際移到動物附近，不能靠假命中');

        for (const key of game === 'double' ? ['Space', 'Enter'] : ['Space']) {
          await session.page.keyboard.press(key);
          await session.page.keyboard.press(key);
        }
        const scores = await Promise.all(players.map((p) => session.page.locator(selector(game, 'score', p)).textContent()));
        assert.deepEqual(scores, players.map(() => '1 分'), '同題連按兩次只計一次分');
        const results = await session.page.evaluate(({ count, re }) => window.__qa.feedback.slice(0, count).map((list) => list.filter((text) => new RegExp(re).test(text)).length), { count: players.length, re: RESULT_RE.source });
        assert.deepEqual(results, players.map(() => 1), '每玩家同題只判定一次');

        for (const key of game === 'double' ? ['KeyA', 'ArrowLeft'] : ['ArrowLeft']) await session.page.keyboard.down(key);
        await session.page.clock.runFor(200);
        await session.page.evaluate(() => window.dispatchEvent(new Event('blur')));
        const afterBlur = await positions(session.page, game);
        await session.page.clock.runFor(300);
        assert.deepEqual(await positions(session.page, game), afterBlur, '失焦後不得持續移動');
        expectNoErrors(session);
        assert.deepEqual(session.sessionPosts, [], '操控測試未完成六關，不寫入成績');
      } finally { await session.context.close(); }
    });
  }

  test('single：真實 requestAnimationFrame 與時鐘可用鍵盤開始及作答', async () => {
    const session = await openGame(browser, server.origin, { game: 'single', realAim: true, realClock: true });
    try {
      await session.page.evaluate(() => { Math.random = () => 0.25; });
      await session.page.keyboard.down('ArrowRight');
      await session.page.waitForFunction(() => window.__qa.questions[0].length === 1, null, { timeout: 5000 });
      await session.page.keyboard.up('ArrowRight');
      await session.page.keyboard.press('Space');
      await session.page.keyboard.press('Space');
      assert.equal(await session.page.locator('#score').textContent(), '1 分');
      const started = await session.page.evaluate(() => ({ question: document.querySelector('#question-type').textContent, timer: document.querySelector('#time-text').textContent }));
      assert.match(started.question, /判斷/);
      assert.doesNotMatch(started.timer, /尚未開始/);
      expectNoErrors(session);
      assert.deepEqual(session.sessionPosts, []);
    } finally { await session.context.close(); }
  });
});
