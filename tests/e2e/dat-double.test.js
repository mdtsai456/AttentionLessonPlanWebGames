// 動物追擊令 雙人版 E2E
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStaticServer, launchBrowser, openGame } from './helpers.js';
import { AnimalModel, expectNoErrors, expectVisibleFeedback } from './expect.js';

const DEFAULT_POOL = ['rabbit.png', 'cat.png', 'dog.png', 'bird.png'];

describe('DAT_double 雙人版', () => {
  let server;
  let browser;

  before(async () => {
    server = await startStaticServer();
    browser = await launchBrowser();
  });

  after(async () => {
    await browser?.close();
    await server?.close();
  });

  test('正式模式：連續 5 題升級，失敗只歸零連擊不降級，回饋提示規則，兩位玩家互不影響', async () => {
    const session = await openGame(browser, server.origin, { game: 'double', mode: 'game' });
    try {
      // P1 的測試順序：升級、漏答或誤按、無連擊時再次失敗、答對、未瞄準、連續答對 5 題後升級。
      const p1Plan = [
        ...Array(5).fill('correct'),
        'miss',
        'miss',
        'correct',
        'offTarget',
        ...Array(5).fill('correct'),
      ];
      // P1 失敗時，P2 答對。P1 答對時，P2 失敗。驗證兩位玩家互不影響。
      const p2Plan = [
        'correct', 'correct', 'miss',
        ...Array(5).fill('correct'),
        'offTarget',
        ...Array(5).fill('correct'),
      ];
      const p1 = new AnimalModel(DEFAULT_POOL);
      const p2 = new AnimalModel(DEFAULT_POOL);
      const questionTypes = [];

      for (const [i, a1] of p1Plan.entries()) {
        const a2 = p2Plan[i];
        const [r1, r2] = await session.driver.playQuestion(a1, a2);
        questionTypes.push(r1.questionType, r2.questionType);
        p1.check(a1, r1, `P1 第 ${i + 1} 題（${a1}）`);
        p2.check(a2, r2, `P2 第 ${i + 1} 題（${a2}）`);
        expectVisibleFeedback(r1, `P1 第 ${i + 1} 題`);
        expectVisibleFeedback(r2, `P2 第 ${i + 1} 題`);
      }

      assert.equal(p1.image, 'dog.png', 'P1 最後應升到第 3 級（狗）');
      assert.equal(p2.image, 'dog.png', 'P2 最後應升到第 3 級（狗）');
      // 14 題會跨越第 1、2 關，以驗證換關後保留動物等級。
      const feedback = await session.page.evaluate(() => window.__qa.feedback);
      for (const list of feedback) {
        assert.ok(list.some((t) => t.startsWith('恭喜通過第 1 關')), '應跨過第 1 關');
        assert.ok(list.some((t) => t.startsWith('恭喜通過第 2 關')), '應跨過第 2 關');
      }
      // 修正前正式模式只會出顏色題
      assert.ok(questionTypes.some((t) => /^數學判斷/.test(t)), `正式模式應出現數學題：${questionTypes}`);
      assert.ok(questionTypes.some((t) => /^顏色判斷/.test(t)), `正式模式應出現顏色題：${questionTypes}`);
      assert.deepEqual(session.sessionPosts, [], '遊戲尚未結束，不應送出成績');
      expectNoErrors(session);
    } finally {
      await session.context.close();
    }
  });

  test('正式模式：達最高級後不再提示「再 N 題」，每 5 題顯示維持最高級，失敗仍保留動物', async () => {
    const files = ['/uploads/T001/DAT/lv1.png', '/uploads/T001/DAT/lv2.png'];
    const session = await openGame(browser, server.origin, { game: 'double', mode: 'game', assetFiles: files });
    try {
      const images = ['lv1.png', 'lv2.png'];
      const p1 = new AnimalModel(images);
      const p2 = new AnimalModel(images);
      const p1Plan = [...Array(10).fill('correct'), 'miss', 'correct'];

      for (const [i, action] of p1Plan.entries()) {
        const [r1, r2] = await session.driver.playQuestion(action, 'correct');
        p1.check(action, r1, `P1 第 ${i + 1} 題（${action}）`);
        p2.check('correct', r2, `P2 第 ${i + 1} 題`);
        expectVisibleFeedback(r1, `P1 第 ${i + 1} 題`);
        expectVisibleFeedback(r2, `P2 第 ${i + 1} 題`);
      }
      assert.equal(p1.image, 'lv2.png');
      expectNoErrors(session);
    } finally {
      await session.context.close();
    }
  });

  test('練習模式：2 題為顏色、數學各 1 題，回饋同樣提示規則', async () => {
    const session = await openGame(browser, server.origin, { game: 'double', mode: 'practice' });
    try {
      const p1 = new AnimalModel(DEFAULT_POOL);
      const p2 = new AnimalModel(DEFAULT_POOL);
      const plan = [['correct', 'miss'], ['correct', 'correct']];
      const types = [[], []];

      for (const [i, [a1, a2]] of plan.entries()) {
        const [r1, r2] = await session.driver.playQuestion(a1, a2);
        types[0].push(r1.questionType);
        types[1].push(r2.questionType);
        p1.check(a1, r1, `P1 練習第 ${i + 1} 題`);
        p2.check(a2, r2, `P2 練習第 ${i + 1} 題`);
        expectVisibleFeedback(r1, `P1 練習第 ${i + 1} 題`);
        expectVisibleFeedback(r2, `P2 練習第 ${i + 1} 題`);
      }

      for (const t of types) {
        assert.match(t[0], /^【練習 1\/2】顏色判斷/);
        assert.match(t[1], /^【練習 2\/2】數學判斷/);
      }
      await session.driver.waitFor(
        () => window.__qa.feedback.every((list) => list.some((t) => t.startsWith('練習結束'))),
        '練習結束',
      );
      expectNoErrors(session);
    } finally {
      await session.context.close();
    }
  });
});
