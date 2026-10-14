// 漂浮泡泡雙人：存檔時機、重複送出、中場離開、startTime。
// 用 page.clock 快轉關卡時間；兩位玩家都不作答，每關固定 5 題逾時算錯。
import { test, expect } from '@playwright/test';
import { DOUBLE, loginAs, recordWrites } from './helpers.mjs';

const ASSET_HOST = 'https://attention-lesson-plan-assets.zeabur.app/**';
// 一關 60 秒，最後一題回饋最晚 60.5 秒結束；多留幾秒確保兩人都停在過關畫面。
const STAGE_RUN_MS = 65_000;

// 按「離開」先在頁面內確認（第 41 項）：取消什麼都不送，確定才存檔並回大廳。
const leaveDialog = (page) => page.getByRole('dialog', { name: '確定要離開嗎？' });
// 記下瀏覽器原生的對話框；確定離開時不可再跳出「離開網站？」。
function watchNativeDialogs(page) {
  const seen = [];
  page.on('dialog', (dialog) => {
    seen.push(dialog.type());
    dialog.dismiss().catch(() => {});
  });
  return seen;
}
async function leaveAndConfirm(page, options = {}) {
  await page.click('#leave-btn', options);
  await leaveDialog(page).getByRole('button', { name: '離開', exact: true }).click();
  await page.waitForURL('**/Select/index.html');
}
const sessionsOf = (writes) => writes.filter((request) => /\/api\/sessions$/.test(request.url));
const stat = (body, name) => body.data.stats.find((item) => item.apiname === name)?.value;

async function openDouble(page, { clock = true } = {}) {
  const writes = await recordWrites(page);
  // 素材 API 一律 404，改用內建箭頭，避免測試依賴外部網路。
  await page.route(ASSET_HOST, (route) => route.fulfill({ status: 404, body: '' }));
  await loginAs(page, DOUBLE);
  if (clock) await page.clock.install();
  await page.goto('EFT_double/EFT_double.html');
  await expect(page.locator('.player-1 [data-ui="bubble-field"] .bubble')).toHaveCount(3);
  await expect(page.locator('.player-2 [data-ui="bubble-field"] .bubble')).toHaveCount(3);
  return writes;
}

// 快轉一關並確認兩人都停在該關結束畫面（第 3 關是中場，第 6 關是結果）。
async function runStage(page, stage) {
  await page.clock.runFor(STAGE_RUN_MS);
  if (stage === 3) {
    await expect(page.locator('#mid-break')).toBeVisible();
  } else if (stage === 6) {
    await expect(page.locator('.player-1 [data-ui="results"]')).toBeVisible();
    await expect(page.locator('.player-2 [data-ui="results"]')).toBeVisible();
  } else {
    await expect(page.locator('.shared-stage-clear')).toBeVisible();
  }
}

async function continueAfter(page, stage) {
  if (stage === 3) await page.click('#mid-continue');
  else await page.click('.shared-stage-clear-btn');
}

// 從頭打到第 lastStage 關結束；第 6 關之前的每關都按繼續。
async function playStages(page, fromStage, lastStage) {
  for (let stage = fromStage; stage <= lastStage; stage++) {
    await runStage(page, stage);
    if (stage < lastStage && stage < 6) await continueAfter(page, stage);
  }
}

test('#5 六關打完兩位玩家各送一筆第 6 關成績，共用 pairId 且只送一次', async ({ page }) => {
  const writes = await openDouble(page);
  const nativeDialogs = watchNativeDialogs(page);
  await playStages(page, 1, 6);
  await expect.poll(() => sessionsOf(writes).length, { timeout: 5000 }).toBe(2);
  const sessions = sessionsOf(writes);
  expect(sessions.map((request) => stat(request.body, 'EFT_stage'))).toEqual([6, 6]);
  expect(sessions.map((request) => request.body.data.caseId).sort()).toEqual(['S88', 'S99']);
  expect(sessions.map((request) => stat(request.body, 'EFT_questionCount'))).toEqual([30, 30]);
  expect(sessions[0].body.data.pairId).toBe(sessions[1].body.data.pairId);

  // 打完後再按離開並確定，不可重送第 6 關。
  await leaveAndConfirm(page);
  expect(sessionsOf(writes)).toHaveLength(2);
  expect(nativeDialogs).toEqual([]);
});

test('#41 離開→繼續遊戲什麼都不送、遊戲照常；再離開並確定才送兩人第 3 關', async ({ page }) => {
  const writes = await openDouble(page);
  const nativeDialogs = watchNativeDialogs(page);
  await playStages(page, 1, 3);
  await page.click('#mid-continue');
  await page.clock.runFor(10_000);
  const round = page.locator('.player-1 [data-ui="round"]');
  await page.click('#leave-btn');
  await expect(leaveDialog(page)).toBeVisible();
  // 確認框開著時本關時間不走。
  const frozen = await round.textContent();
  await page.clock.runFor(10_000);
  await expect(round).toHaveText(frozen);
  await leaveDialog(page).getByRole('button', { name: '繼續遊戲', exact: true }).click();
  await expect(leaveDialog(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(sessionsOf(writes)).toHaveLength(0);
  expect(new URL(page.url()).pathname).toBe('/EFT_double/EFT_double.html');
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(false);
  await expect(page.locator('#leave-btn')).toBeEnabled();
  // 取消後第 4 關照常進行。
  await page.clock.runFor(10_000);
  await expect(round).not.toHaveText(frozen);

  await leaveAndConfirm(page);
  expect(sessionsOf(writes).map((request) => stat(request.body, 'EFT_stage'))).toEqual([3, 3]);
  expect(nativeDialogs).toEqual([]);
});

test('#6 連點兩下離開只開一個確認框，確定後每位玩家只送一筆', async ({ page }) => {
  const writes = await openDouble(page);
  const nativeDialogs = watchNativeDialogs(page);
  await playStages(page, 1, 3);
  await page.click('#mid-continue');
  await page.clock.runFor(10_000);
  // 直接派送兩次 click，不等第一次的確認框。
  await page.evaluate(() => {
    const button = document.getElementById('leave-btn');
    button.click();
    button.click();
  });
  await expect(leaveDialog(page)).toHaveCount(1);
  await leaveDialog(page).getByRole('button', { name: '離開', exact: true }).click();
  await page.waitForURL('**/Select/index.html');
  expect(sessionsOf(writes)).toHaveLength(2);
  expect(nativeDialogs).toEqual([]);
});

test('#6 再玩一次之後送的成績換新的 pairId', async ({ page }) => {
  const writes = await openDouble(page);
  await playStages(page, 1, 6);
  await expect.poll(() => sessionsOf(writes).length, { timeout: 5000 }).toBe(2);
  const firstPairId = sessionsOf(writes)[0].body.data.pairId;

  // 任一人按「再玩一次」兩人一起開新局（與 tianjin 分支的規則一致）。
  await page.click('.player-1 [data-ui="restart"]');
  await expect(page.locator('.player-1 [data-ui="results"]')).toBeHidden();
  await expect(page.locator('.player-2 [data-ui="results"]')).toBeHidden();
  await playStages(page, 1, 3);
  await page.click('#mid-continue');
  await leaveAndConfirm(page);
  expect(sessionsOf(writes)).toHaveLength(4);
  const second = sessionsOf(writes).slice(2);
  expect(second.map((request) => stat(request.body, 'EFT_stage'))).toEqual([3, 3]);
  expect(second[0].body.data.pairId).toBe(second[1].body.data.pairId);
  expect(second[0].body.data.pairId).not.toBe(firstPairId);
});

test('#20 中場畫面上仍點得到離開，並送出兩人第 3 關成績', async ({ page }) => {
  const writes = await openDouble(page);
  await playStages(page, 1, 3);
  const onTop = await page.evaluate(() => {
    const rect = document.getElementById('leave-btn').getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id;
  });
  expect(onTop).toBe('leave-btn');
  await leaveAndConfirm(page, { timeout: 3000 });
  expect(sessionsOf(writes).map((request) => stat(request.body, 'EFT_stage'))).toEqual([3, 3]);
});

test('#10 第 4 關中途離開，第 3 關檢查點只含前 3 關的資料', async ({ page }) => {
  const writes = await openDouble(page);
  await playStages(page, 1, 3);
  await page.click('#mid-continue');
  // 第 4 關再跑 30 秒：每人多 2 題逾時算錯。
  await page.clock.runFor(30_000);
  await leaveAndConfirm(page);
  expect(sessionsOf(writes)).toHaveLength(2);
  for (const request of sessionsOf(writes)) {
    expect(stat(request.body, 'EFT_stage')).toBe(3);
    expect(stat(request.body, 'EFT_questionCount')).toBe(15);
    expect(stat(request.body, 'EFT_wrong')).toBe(15);
    expect(stat(request.body, 'EFT_levelAccuracy')).toBe('0,0,0');
    // 3 關約 181.5 秒加上兩次過關等待；不可含第 4 關的 30 秒。
    expect(stat(request.body, 'EFT_duration')).toBeLessThan(3 * STAGE_RUN_MS);
    // R8：endTime 也停在第 3 關結束當下，endTime − startTime 要等於時長。
    const { startTime, endTime } = request.body.data;
    expect(Math.abs(endTime - startTime - stat(request.body, 'EFT_duration'))).toBeLessThan(1000);
  }
});

test('#28 startTime 是牆上時間，不是暫停後的遊戲時鐘', async ({ page }) => {
  const writes = await openDouble(page, { clock: false });
  // 模擬返回 bfcache 等驗證時暫停 1.5 秒。
  await page.evaluate(() => window.WebGameRuntime.pause());
  await page.waitForTimeout(1500);
  const wallStart = await page.evaluate(async () => {
    window.WebGameRuntime.resume();
    const { players } = await import('/EFT_double/EFT_double.js');
    const startedAt = Date.now();
    players.forEach((player) => player.startGame());
    await players[0].saveRun(3);
    return startedAt;
  });
  await expect.poll(() => sessionsOf(writes).length).toBe(1);
  const startTime = sessionsOf(writes)[0].body.data.startTime;
  expect(Math.abs(startTime - wallStart)).toBeLessThan(300);
});

test('中場「返回遊戲大廳」不用確認，送出兩人第 3 關成績一次後直接回大廳', async ({ page }) => {
  const writes = await openDouble(page);
  const nativeDialogs = watchNativeDialogs(page);
  await playStages(page, 1, 3);
  await page.click('#mid-lobby');
  await page.waitForURL('**/Select/index.html');
  expect(sessionsOf(writes).map((request) => stat(request.body, 'EFT_stage'))).toEqual([3, 3]);
  expect(sessionsOf(writes).map((request) => request.body.data.caseId).sort()).toEqual(['S88', 'S99']);
  expect(nativeDialogs).toEqual([]);
});

test('pairId 是 UUID', async ({ page }) => {
  const writes = await openDouble(page);
  await playStages(page, 1, 3);
  await leaveAndConfirm(page);
  expect(sessionsOf(writes)).toHaveLength(2);
  expect(sessionsOf(writes)[0].body.data.pairId)
    .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('R10 pairId 由共用的 WebGameApi.uuid() 產生', async ({ page }) => {
  const FIXED = '12345678-1234-4123-8123-123456789abc';
  // shared/api.js 設定 window.WebGameApi 時換掉 uuid，確認雙人頁沒有自己另做一套。
  await page.addInitScript((fixed) => {
    let api;
    Object.defineProperty(window, 'WebGameApi', {
      configurable: true,
      get: () => api,
      set: (value) => { api = value; if (api) api.uuid = () => fixed; },
    });
  }, FIXED);
  const writes = await openDouble(page);
  await playStages(page, 1, 3);
  await leaveAndConfirm(page);
  expect(sessionsOf(writes).map((request) => request.body.data.pairId)).toEqual([FIXED, FIXED]);
});

// 確定離開後不論存檔結果都會導頁，重送只能在同一頁再存一次時發生（例如中場返回失敗後再按離開）。
test('伺服器明確拒絕（400）的檢查點，下次存檔可以重送', async ({ page }) => {
  const writes = await openDouble(page);
  let reject = true;
  await page.route('**/api/sessions', (route) => (reject
    ? route.fulfill({ status: 400, contentType: 'application/json', body: '{"detail":"x"}' })
    : route.fallback()));
  await playStages(page, 1, 3);
  await page.evaluate(async () => {
    const { players } = await import('/EFT_double/EFT_double.js');
    await Promise.all(players.map((player) => player.saveRun(3)));
  });
  reject = false;
  await page.click('#mid-continue');
  await leaveAndConfirm(page);
  expect(sessionsOf(writes).map((request) => stat(request.body, 'EFT_stage'))).toEqual([3, 3]);
});

test('R3 確定離開後存檔還在路上：兩位玩家的按鍵與按鈕都不算作答', async ({ page }) => {
  const writes = await openDouble(page);
  await playStages(page, 1, 3);
  await page.click('#mid-continue');
  await page.clock.runFor(1_200);
  const feedback = (n) => page.locator(`.player-${n} [data-ui="feedback"]`);
  await expect(feedback(1)).toHaveText('回答剛才位置的泡泡');
  await expect(feedback(2)).toHaveText('回答剛才位置的泡泡');
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/sessions', async (route) => {
    await released;
    await route.fallback();
  });
  await page.click('#leave-btn');
  await leaveDialog(page).getByRole('button', { name: '離開', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.WebGameRuntime.paused)).toBe(true);
  await page.keyboard.press('KeyA');
  await page.keyboard.press('ArrowRight');
  await page.locator('.player-1 [data-direction="right"]').dispatchEvent('click');
  await page.locator('.player-2 [data-direction="left"]').dispatchEvent('click');
  for (const n of [1, 2]) {
    await expect(feedback(n)).toHaveText('回答剛才位置的泡泡');
    await expect(page.locator(`.player-${n} [data-ui="score"]`)).toHaveText('0 分');
  }
  release();
  await page.waitForURL('**/Select/index.html');
  expect(sessionsOf(writes).map((request) => stat(request.body, 'EFT_stage'))).toEqual([3, 3]);
});
