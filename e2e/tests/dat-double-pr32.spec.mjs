import { test, expect } from './dat-double.fixture.mjs';

test.describe('題型', () => {
  for (const { random, kind } of [
    { random: 0.25, kind: '顏色判斷' },
    { random: 0.75, kind: '數學判斷' },
  ]) {
    test(`正式模式可以出${kind}題`, async ({ game, page }) => {
      await page.addInitScript((value) => { Math.random = () => value; }, random);
      await game.open();
      await game.startQuestions();
      for (const player of [1, 2]) {
        await expect(page.locator(`.player-${player} [data-ui="question-type"]`)).toContainText(kind);
        if (kind === '數學判斷') {
          await expect(page.locator(`.player-${player} [data-ui="question-text"]`))
            .toHaveText(/\d+ [＋+−] \d+ = \d+/);
        }
      }
    });
  }

  test('練習題仍交替出顏色與數學題', async ({ game, page }) => {
    await game.open('practice');
    const kinds = await page.evaluate(async () => {
      const { generateQuestionSet } = await import('/DAT_double/js/questions.js');
      return generateQuestionSet(4, true).map((question) => question.type);
    });
    expect(kinds).toEqual([
      '【練習 1/4】顏色判斷：色名與字色是否相同？',
      '【練習 2/4】數學判斷：算式答案是否正確？',
      '【練習 3/4】顏色判斷：色名與字色是否相同？',
      '【練習 4/4】數學判斷：算式答案是否正確？',
    ]);
  });
});

test.describe('結算返回按鈕的鍵盤操作', () => {
  for (const player of [1, 2]) {
    for (const key of ['Space', 'Enter', 'NumpadEnter']) {
      test(`玩家 ${player} 用 ${key} 返回：等待存檔、不重送、不跳確認框`, async ({ game, page }) => {
        await game.open();
        game.api.delayMs = 800;
        await game.playThrough(6);
        const button = page.locator(`.player-${player} [data-ui="back-home"]`);
        await button.focus();
        await page.keyboard.press(key);
        await expect(page).toHaveURL(/\/Select\/index\.html$/, { timeout: 3000 });
        expect(game.posted()).toEqual([6, 6]);
        expect(game.delivered()).toEqual([6, 6]);
        expect(game.dialogs).toEqual([]);
      });
    }
  }
});
