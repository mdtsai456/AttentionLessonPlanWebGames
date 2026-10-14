// 漂浮泡泡、指令出擊、勇闖迷宮：遊戲進行中直接關分頁／重新整理／按上一頁，
// 先跳瀏覽器的離開詢問（和動物追擊令、賽道攔截一樣），避免一不小心就丟掉成績。
// 已在頁面內確認離開、打完六關、登入逾時登出時不問。
import { test, expect } from '@playwright/test';
import { STUDENT, DOUBLE, loginAs, recordWrites } from './helpers.mjs';

const ASSET_HOST = 'https://attention-lesson-plan-assets.zeabur.app/**';
const leaveDialog = (page) => page.getByRole('dialog', { name: '確定要離開嗎？' });

// 瀏覽器要有使用者互動過，才會顯示離開詢問；點一下畫面角落（不會按到按鈕）。
async function touch(page) {
  await page.mouse.click(2, 2);
}

/** 關掉分頁（會跑 beforeunload）。有跳出離開詢問就按「留下」，回傳詢問類型；沒問則回傳 null。 */
async function closeAndStay(page) {
  const prompt = page.waitForEvent('dialog', { timeout: 3000 }).catch(() => null);
  await page.close({ runBeforeUnload: true });
  const dialog = await prompt;
  if (!dialog) return null;
  const type = dialog.type();
  await dialog.dismiss();
  return type;
}

function watchNativeDialogs(page) {
  const seen = [];
  page.on('dialog', (dialog) => {
    seen.push(dialog.type());
    dialog.dismiss().catch(() => {});
  });
  return seen;
}

async function confirmLeave(page) {
  await page.click('#leave-btn');
  await leaveDialog(page).getByRole('button', { name: '離開', exact: true }).click();
  await page.waitForURL('**/Select/index.html');
}

const GAMES = [
  {
    name: '漂浮泡泡單人',
    session: STUDENT,
    url: 'EFT_single/EFT_single.html',
    ready: (page) => expect(page.locator('#bubble-field .bubble')).toHaveCount(3),
  },
  {
    name: '漂浮泡泡雙人',
    session: DOUBLE,
    url: 'EFT_double/EFT_double.html',
    ready: (page) => expect(page.locator('.player-2 [data-ui="bubble-field"] .bubble')).toHaveCount(3),
  },
  {
    name: '指令出擊',
    session: STUDENT,
    url: 'IM_single/index.html',
    ready: (page) => page.waitForFunction(() => typeof state !== 'undefined' && state.playing && state.rooms.length),
  },
  {
    name: '勇闖迷宮單人',
    session: STUDENT,
    url: 'TGame_single/index.html',
    ready: (page) => page.waitForFunction(() => typeof state !== 'undefined' && state.startedAt !== 0),
  },
  {
    name: '勇闖迷宮雙人',
    session: DOUBLE,
    url: 'TGame_double/index.html',
    ready: (page) => page.waitForFunction(() => typeof session !== 'undefined' && session.startedAt !== 0),
  },
];

async function open(page, game) {
  await recordWrites(page);
  await page.route(ASSET_HOST, (route) => route.fulfill({ status: 404, body: '' }));
  await loginAs(page, game.session);
  await page.goto(game.url);
  await game.ready(page);
  await touch(page);
}

for (const game of GAMES) {
  test(`${game.name}：遊戲進行中關分頁會先問，按留下就留在遊戲頁`, async ({ page }) => {
    await open(page, game);
    expect(await closeAndStay(page)).toBe('beforeunload');
    expect(page.isClosed()).toBe(false);
    expect(new URL(page.url()).pathname).toBe(`/${game.url}`);
  });

  test(`${game.name}：在頁面內確認離開後導頁，不再跳瀏覽器的離開詢問`, async ({ page }) => {
    await open(page, game);
    const dialogs = watchNativeDialogs(page);
    await confirmLeave(page);
    expect(dialogs).toEqual([]);
  });

  test(`${game.name}：登入逾時登出（sessionStorage 已清空）時不問，免得擋住登出`, async ({ page }) => {
    await open(page, game);
    await page.evaluate(() => sessionStorage.clear());
    expect(await closeAndStay(page)).toBeNull();
  });
}

test('漂浮泡泡單人：打完六關後關分頁不問', async ({ page }) => {
  await page.clock.install();
  await open(page, GAMES[0]);
  for (let stage = 1; stage <= 6; stage++) {
    await page.clock.runFor(65_000);
    if (stage === 3) await page.click('#btn-continue');
    else if (stage < 6) await page.click('.shared-stage-clear-btn');
  }
  await expect(page.locator('#results')).toBeVisible();
  expect(await closeAndStay(page)).toBeNull();
});

test('漂浮泡泡單人：中場按「返回遊戲大廳」不跳瀏覽器的離開詢問', async ({ page }) => {
  await page.clock.install();
  await open(page, GAMES[0]);
  const dialogs = watchNativeDialogs(page);
  for (let stage = 1; stage <= 3; stage++) {
    await page.clock.runFor(65_000);
    if (stage < 3) await page.click('.shared-stage-clear-btn');
  }
  await page.click('#btn-lobby');
  await page.waitForURL('**/Select/index.html');
  expect(dialogs).toEqual([]);
});

test('指令出擊：打完六關後關分頁不問', async ({ page }) => {
  await open(page, GAMES[2]);
  for (let stage = 1; stage <= 6; stage++) {
    await expect(page.locator('#problem-title')).toHaveText(`第 ${stage} 關`);
    await page.locator('#start-stage-btn').click();
    await page.waitForFunction(() => state.stageLive && !state.busy);
    await page.evaluate(() => passStage());
    if (stage === 3) await page.locator('#continue-btn').click();
    else if (stage < 6) await page.locator('.shared-stage-clear-btn').click();
  }
  await expect(page.locator('#result')).toBeVisible();
  expect(await closeAndStay(page)).toBeNull();
});
