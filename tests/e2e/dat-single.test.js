// 動物追擊令 單人版 E2E
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStaticServer, launchBrowser, openGame } from './helpers.js';
import { AnimalModel, expectNoErrors } from './expect.js';

const DEFAULT_POOL = ['rabbit.png', 'cat.png', 'dog.png', 'bird.png'];

describe('DAT_single 單人版', () => {
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

  test('正式模式：正確等待後，下一題仍顯示上一題的連擊提示', async () => {
    const session = await openGame(browser, server.origin, { game: 'single', mode: 'game' });
    try {
      // 固定亂數讓遊戲產生不成立的算式，必須不按鍵等待逾時才能答對。
      await session.page.evaluate(() => { Math.random = () => 0.75; });
      const [result] = await session.driver.playQuestion('correct');
      assert.equal(result.visibleFeedback, '上一題：正確等待且保持瞄準！＋1 分（再連續答對 4 題變身）');
      const state = await session.page.evaluate(() => ({ index, score, phase }));
      assert.deepEqual(state, { index: 1, score: 1, phase: 'answer' }, '下一題應已開始，上一題只計分一次');
      expectNoErrors(session);
    } finally {
      await session.context.close();
    }
  });

  test('正式模式：漏答後，下一題仍顯示上一題的連擊歸零提示', async () => {
    const session = await openGame(browser, server.origin, { game: 'single', mode: 'game' });
    try {
      // 固定亂數讓遊戲產生正確的顏色題，先答對建立連擊，再漏答。
      await session.page.evaluate(() => { Math.random = () => 0.25; });
      await session.driver.playQuestion('correct');
      const [result] = await session.driver.playQuestion('miss');
      assert.equal(result.visibleFeedback, '上一題：漏答：正確的題目要按 空白鍵（連擊歸零）');
      const state = await session.page.evaluate(() => ({ index, score, timedOut, consecutiveCorrect, phase }));
      assert.deepEqual(state, { index: 2, score: 1, timedOut: 1, consecutiveCorrect: 0, phase: 'answer' });
      expectNoErrors(session);
    } finally {
      await session.context.close();
    }
  });

  test('正式模式：連續 5 題升級，失敗只歸零連擊不降級，回饋提示規則', async () => {
    const session = await openGame(browser, server.origin, { game: 'single', mode: 'game' });
    try {
      const plan = [
        ...Array(5).fill('correct'),
        'miss',
        'miss',
        'correct',
        'offTarget',
        ...Array(5).fill('correct'),
      ];
      const model = new AnimalModel(DEFAULT_POOL);

      for (const [i, action] of plan.entries()) {
        const [r] = await session.driver.playQuestion(action);
        model.check(action, r, `第 ${i + 1} 題（${action}）`);
      }

      assert.equal(model.image, 'dog.png', '最後應升到第 3 級（狗）');
      // 內部狀態也要和畫面一致
      const internal = await session.page.evaluate(() => ({
        currentAssetIndex, // eslint-disable-line no-undef
        consecutiveCorrect, // eslint-disable-line no-undef
        hasPrev: typeof switchToPrevAnimal !== 'undefined', // eslint-disable-line no-undef
      }));
      assert.deepEqual(internal, { currentAssetIndex: 2, consecutiveCorrect: 5, hasPrev: false });
      // 14 題會跨過第 1、2 關，確認動物等級跨關保留的情境確實有被測到
      const nextStage = await session.page.evaluate(
        () => window.__qa.feedback[0].filter((t) => t === '將準心移到動物身上，開始下一關').length,
      );
      assert.ok(nextStage >= 2, `應至少跨過 2 個關卡，實際 ${nextStage}`);
      assert.deepEqual(session.sessionPosts, [], '遊戲尚未結束，不應送出成績');
      expectNoErrors(session);
    } finally {
      await session.context.close();
    }
  });

  test('正式模式：達最高級後不再提示「再 N 題」，每 5 題顯示維持最高級，失敗仍保留動物', async () => {
    const files = ['/uploads/T001/DAT/lv1.png', '/uploads/T001/DAT/lv2.png'];
    const session = await openGame(browser, server.origin, { game: 'single', mode: 'game', assetFiles: files });
    try {
      const model = new AnimalModel(['lv1.png', 'lv2.png']);
      const plan = [...Array(10).fill('correct'), 'miss', 'correct'];
      for (const [i, action] of plan.entries()) {
        const [r] = await session.driver.playQuestion(action);
        model.check(action, r, `第 ${i + 1} 題（${action}）`);
      }
      assert.equal(model.image, 'lv2.png');
      expectNoErrors(session);
    } finally {
      await session.context.close();
    }
  });

  test('練習模式：回饋同樣提示規則，失敗只歸零連擊', async () => {
    const session = await openGame(browser, server.origin, { game: 'single', mode: 'practice' });
    try {
      const model = new AnimalModel(DEFAULT_POOL);
      for (const [i, action] of ['correct', 'miss'].entries()) {
        const [r] = await session.driver.playQuestion(action);
        model.check(action, r, `練習第 ${i + 1} 題（${action}）`);
      }
      expectNoErrors(session);
    } finally {
      await session.context.close();
    }
  });
});
