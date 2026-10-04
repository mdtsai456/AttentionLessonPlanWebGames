import { test, expect } from './dat-double.fixture.mjs';

// 使用畫面位置與真正的鍵盤／滑鼠輸入瞄準，不直接呼叫遊戲內部方法。
async function aimAtAnimal(page, player, input) {
  const root = page.locator(`.player-${player}`);
  const keys = player === 1
    ? { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS' }
    : { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
  for (let step = 0; step < 120; step++) {
    const [aim, animal] = await Promise.all([
      root.locator('[data-ui="crosshair"]').boundingBox(),
      root.locator('[data-ui="animal"]').boundingBox(),
    ]);
    const dx = animal.x + animal.width / 2 - aim.x - aim.width / 2;
    const dy = animal.y + animal.height / 2 - aim.y - aim.height / 2;
    if (Math.hypot(dx, dy) < 6) return;
    const direction = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    if (input === 'keyboard') {
      await page.keyboard.down(keys[direction]);
      try {
        await page.waitForTimeout(30); // 持續按住，讓遊戲的動畫迴圈移動準心。
      } finally {
        await page.keyboard.up(keys[direction]);
      }
    } else {
      const button = await root.locator(`[data-move="${direction}"]`).boundingBox();
      await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
      await page.mouse.down();
      try {
        await page.waitForTimeout(30);
      } finally {
        await page.mouse.up();
      }
    }
  }
  throw new Error(`玩家 ${player} 無法用 ${input} 瞄準動物`);
}

for (const input of ['keyboard', 'pointer']) {
  test(`兩位玩家用 ${input} 完成練習：瞄準、顏色題、數學題皆能得分`, async ({ game, page }, testInfo) => {
    // 兩種練習題都產生正確敘述，預期每位玩家答對兩題，得到 2 分。
    await page.addInitScript(() => { Math.random = () => 0.25; });
    await game.open('practice');
    for (const kind of ['顏色判斷', '數學判斷']) {
      for (const player of [1, 2]) {
        const root = page.locator(`.player-${player}`);
        if (kind === '數學判斷') {
          await expect(root.locator('[data-ui="question-type"]')).toContainText(kind);
        }
        await aimAtAnimal(page, player, input);
        await expect(root.locator('[data-ui="question-type"]')).toContainText(kind);
        if (input === 'keyboard') {
          await page.keyboard.press(player === 1 ? 'Space' : 'Enter');
        } else {
          await root.locator('[data-ui="answer-true"]').click();
        }
        await expect(root.locator('[data-ui="score"]')).toHaveText(kind === '顏色判斷' ? '1 分' : '2 分');
        await expect(root.locator('[data-ui="feedback"]')).toContainText('瞄準且答對');
      }
    }
    await page.screenshot({ path: testInfo.outputPath('practice-play.png') });
    // 保留真正的每題 10 秒計時，驗證玩家能自然完成練習。
    for (const player of [1, 2]) {
      await expect(page.locator(`.player-${player} [data-ui="question-type"]`)).toHaveText('【練習完成】');
      await expect(page.locator(`.player-${player} [data-ui="results"]`)).toBeHidden();
    }
    expect(game.posted()).toEqual([]);
    expect(game.dialogs).toEqual([]);
  });
}
