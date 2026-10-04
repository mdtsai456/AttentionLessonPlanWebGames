import { test, expect } from './dat-single.fixture.mjs';

test('六關後停留結算畫面，可直接返回大廳，不必再玩一次', async ({ game, page }) => {
  await game.open();
  await game.playThrough(6);
  await game.waitForSaves(1);
  await expect(page.locator('#result-title')).toHaveText('挑戰完成！');
  await expect(page.locator('#restart')).toHaveText('再玩一次');
  await expect(page.locator('#btn-start-game')).toHaveText('返回遊戲大廳');
  if (test.info().project.name === 'chromium') {
    await page.screenshot({ path: '../.context/dat-single-six-stage-results.png' });
  }
  await page.click('#btn-start-game');
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
  expect(game.posted()).toEqual([6]);
  expect(game.dialogs).toEqual([]);
});

test('六關後按離開直接返回大廳，不再跳確認框', async ({ game, page }) => {
  await game.open();
  await game.playThrough(6);
  await game.waitForSaves(1);
  await page.click('#leave-btn', { noWaitAfter: true });
  await expect(page).toHaveURL(/\/Select\/index\.html$/, { timeout: 2000 });
  expect(game.posted()).toEqual([6]);
  expect(game.dialogs).toEqual([]);
});

for (const button of ['#leave-btn', '#btn-start-game']) {
  test(`六關後 ${button} 等結算存檔送達才返回`, async ({ game, page }) => {
    await game.open();
    game.api.holdNext = 1;
    await game.playThrough(6);
    await expect.poll(() => game.posted()).toEqual([6]);
    await page.click(button, { noWaitAfter: true });
    await page.waitForTimeout(250);
    expect(page.url()).toContain('/DAT_single/DAT_single.html');
    expect(game.dialogs).toEqual([]);
    game.api.releaseHeld();
    await expect(page).toHaveURL(/\/Select\/index\.html$/);
    expect(game.delivered()).toEqual([6]);
    expect(game.posted()).toEqual([6]);
  });
}

test('取消遊戲中離開後，離開按鈕仍可再次使用', async ({ game, page }) => {
  await game.open();
  await game.startQuestions();
  await game.cancelLeave();
  await expect(page.locator('#leave-btn')).toBeEnabled({ timeout: 2000 });
  game.api.acceptLeave = true;
  await page.click('#leave-btn', { noWaitAfter: true });
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
  expect(game.posted()).toEqual([]);
});

test('取消離開再完成六關，返回大廳不會受舊確認旗標阻擋', async ({ game, page }) => {
  await game.open();
  await game.startQuestions();
  await game.cancelLeave();
  await game.playThrough(6);
  await game.waitForSaves(1);
  await page.click('#btn-start-game', { noWaitAfter: true });
  await expect(page).toHaveURL(/\/Select\/index\.html$/, { timeout: 2000 });
  expect(game.dialogs).toEqual(['beforeunload']);
});

test('第3關中場的離開按鈕未被遮罩蓋住', async ({ game, page }) => {
  await game.open();
  await game.playThrough(3);
  expect(await page.evaluate(() => {
    const rect = document.getElementById('leave-btn').getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).id;
  })).toBe('leave-btn');
  game.api.acceptLeave = true;
  await page.click('#leave-btn', { noWaitAfter: true });
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
  expect(game.delivered()).toEqual([3]);
});

test('一般換關畫面也能按離開返回大廳', async ({ game, page }) => {
  await game.open();
  await game.startQuestions();
  await page.evaluate(() => { window.__skew += 61000; });
  await expect(page.locator('.shared-stage-clear')).toBeVisible();
  expect(await page.evaluate(() => {
    const rect = document.getElementById('leave-btn').getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).id;
  })).toBe('leave-btn');
  game.api.acceptLeave = true;
  await page.click('#leave-btn', { noWaitAfter: true });
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
  expect(game.posted()).toEqual([]);
});

test('第3關中場返回大廳，先存檔再離開', async ({ game, page }) => {
  await game.open();
  await game.playThrough(3);
  await page.click('#btn-lobby');
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
  expect(game.delivered()).toEqual([3]);
  expect(game.dialogs).toEqual([]);
});

test('再玩一次的新局中場仍會存stage 3', async ({ game, page }) => {
  await game.open();
  await game.playThrough(6);
  await game.waitForSaves(1);
  await page.click('#restart');
  await game.playThrough(3);
  await page.click('#btn-lobby');
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
  expect(game.delivered()).toEqual([6, 3]);
});

test('結算存檔失敗後，返回按鈕會重試再離開', async ({ game, page }) => {
  await game.open();
  game.api.failNext = 1;
  await game.playThrough(6);
  await game.waitForSaves(1);
  expect(game.delivered()).toEqual([]);
  await page.click('#btn-start-game');
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
  expect(game.posted()).toEqual([6, 6]);
  expect(game.delivered()).toEqual([6]);
});

test('舊局失敗回應不會回退新局已成功的存檔狀態', async ({ game, page }) => {
  const failures = [];
  page.on('console', (message) => {
    if (message.text().includes('[API 錯誤 500]')) failures.push(message.text());
  });
  await game.open();
  game.api.holdNext = 1;
  game.api.failNext = 1;
  await game.playThrough(6);
  await expect.poll(() => game.posted()).toEqual([6]);
  await page.click('#restart');
  await game.playThrough(6);
  await game.waitForSaves(1);
  expect(game.delivered()).toEqual([6]);
  game.api.releaseHeld();
  await game.waitForSaves(2);
  await expect.poll(() => failures.length).toBe(1);
  await page.click('#btn-start-game');
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
  expect(game.posted()).toEqual([6, 6]);
});

for (const key of ['Space', 'Enter', 'NumpadEnter']) {
  test(`六關後可用 ${key} 操作返回大廳`, async ({ game, page }) => {
    await game.open();
    await game.playThrough(6);
    await game.waitForSaves(1);
    await page.locator('#btn-start-game').focus();
    await page.keyboard.press(key);
    await expect(page).toHaveURL(/\/Select\/index\.html$/);
    expect(game.posted()).toEqual([6]);
  });
}

test('六關結算後可以用Tab鍵移到返回大廳', async ({ game, page }) => {
  await game.open();
  await game.playThrough(6);
  await game.waitForSaves(1);
  await page.locator('#restart').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#btn-start-game')).toBeFocused({ timeout: 2000 });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
});
