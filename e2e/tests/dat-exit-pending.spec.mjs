import { test as single, expect } from './dat-single.fixture.mjs';
import { test as double } from './dat-double.fixture.mjs';

for (const [name, test, saveCount, returnButton, restartButton] of [
  ['單人', single, 1, '#btn-start-game', '#restart'],
  ['雙人', double, 2, '.player-1 [data-ui="back-home"]', '.player-1 [data-ui="restart"]'],
]) {
  for (const button of ['#leave-btn', returnButton]) {
    test(`${name} ${button} 返回等待期間不能再玩一次`, async ({ game, page }) => {
      await game.open();
      game.api.holdNext = saveCount;
      await game.playThrough(6);
      await expect.poll(() => game.posted().length).toBe(saveCount);
      await page.click(button, { noWaitAfter: true });
      await expect(page.locator(restartButton)).toBeDisabled({ timeout: 2000 });
      game.api.releaseHeld();
      await expect(page).toHaveURL(/\/Select\/index\.html$/);
      expect(game.delivered()).toEqual(Array(saveCount).fill(6));
      expect(game.posted()).toEqual(Array(saveCount).fill(6));
    });
  }

  for (const key of ['Space', 'Enter']) {
    test(`${name} 一般換關可用 ${key} 啟動離開按鈕`, async ({ game, page }) => {
      await game.open();
      // Firefox 的 beforeunload 確認需要先有使用者操作；實際遊玩也會先瞄準／作答。
      await page.locator('.score').first().click();
      await game.startQuestions();
      await page.evaluate(() => { window.__skew += 61000; });
      await expect(page.locator('.shared-stage-clear')).toBeVisible();
      game.api.acceptLeave = true;
      await page.locator('#leave-btn').focus();
      await page.keyboard.press(key);
      await expect(page).toHaveURL(/\/Select\/index\.html$/, { timeout: 2000 });
      expect(game.dialogs).toEqual(['beforeunload']);
    });
  }

  test(`${name} 中途返回等待期間不能用快捷鍵繼續換關`, async ({ game, page }) => {
    await game.open();
    await game.playThrough(3);
    await page.click(name === '單人' ? '#btn-next-stage' : '#mid-continue');
    await game.startQuestions();
    await page.evaluate(() => { window.__skew += 61000; });
    await expect(page.locator('.shared-stage-clear')).toBeVisible();
    game.api.holdNext = saveCount;
    game.api.acceptLeave = true;
    await page.click('#leave-btn', { noWaitAfter: true });
    await expect.poll(() => game.posted().length).toBe(saveCount);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    await expect(page.locator('.shared-stage-clear')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.shared-stage-clear-btn')).toBeDisabled();
    game.api.releaseHeld();
    await expect(page).toHaveURL(/\/Select\/index\.html$/);
    expect(game.delivered()).toEqual(Array(saveCount).fill(3));
  });
}

for (const key of ['Space', 'Enter']) {
  double(`雙人六關結算可用 ${key} 啟動離開按鈕`, async ({ game, page }) => {
    await game.open();
    await game.playThrough(6);
    await game.waitForSaves(2);
    await page.locator('#leave-btn').focus();
    await page.keyboard.press(key);
    await expect(page).toHaveURL(/\/Select\/index\.html$/, { timeout: 2000 });
    expect(game.dialogs).toEqual([]);
    expect(game.posted()).toEqual([6, 6]);
  });
}
