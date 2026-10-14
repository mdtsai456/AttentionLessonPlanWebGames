import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

// 可使用專案外已安裝的 Playwright，避免將測試依賴加入靜態網站。
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const baseUrl = process.env.DCCS_BASE_URL || 'http://127.0.0.1:8765';
const screenshotDir = process.env.DCCS_SCREENSHOT_DIR;

async function playDouble(choice) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const payloads = [];
    const errors = [];
    // 成績只在測試內接收，所有外部請求皆攔截，不寫入資料庫。
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        assert.equal(new URL(request.url()).pathname, '/api/sessions');
        payloads.push(request.postDataJSON());
        await route.fulfill({ status: 201, contentType: 'application/json', body: '{"sessionId":"browser-test"}' });
      } else if (new URL(request.url()).origin === new URL(baseUrl).origin) {
        await route.continue();
      } else {
        await route.abort();
      }
    });
    await context.addInitScript(() => {
      sessionStorage.setItem('student1_key', 'G1_S03');
      sessionStorage.setItem('student2_key', 'G1_S04');
      sessionStorage.setItem('school', 'KMU');
      sessionStorage.setItem('current_day', '1');
      sessionStorage.setItem('student1_day', '1');
      sessionStorage.setItem('student2_day', '1');
      sessionStorage.setItem('game_mode', 'double');
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/DCCS_double/index.html?sessionSeconds=30`);
    await page.locator('#shared-continue').click();

    // 第 1、2 關過關提示只用滑鼠繼續。
    for (let level = 1; level <= 2; level++) {
      await page.locator('.shared-stage-clear-btn').click({ timeout: 12000 });
    }
    const button = choice === 'continue' ? '#shared-break-continue' : '#shared-break-lobby';
    await page.locator(button).click({ timeout: 12000 });
    if (choice === 'continue') {
      try {
        await page.waitForFunction(() => document.getElementById('shared-overlay').hidden, null, { timeout: 2000 });
      } catch {
        if (screenshotDir) {
          await mkdir(screenshotDir, { recursive: true });
          await page.screenshot({ path: path.join(screenshotDir, 'double-break-stuck.png') });
        }
        assert.fail('選擇繼續遊玩後，共用休息提示仍遮住遊戲');
      }
      // 後續過關提示須能直接點擊，不使用 Enter 或強制 click。
      for (let level = 4; level <= 5; level++) {
        await page.locator('.shared-stage-clear-btn').click({ timeout: 12000 });
      }
    }
    await page.waitForURL('**/Select/index.html', { timeout: 15000 });
    assert.equal(payloads.length, 2);
    assert.deepEqual(errors, []);
    assert.equal(payloads[0].data.mode, 'double');
    assert.equal(payloads[1].data.mode, 'double');
    assert.ok(payloads[0].data.pairId);
    assert.equal(payloads[0].data.pairId, payloads[1].data.pairId);
    assert.deepEqual(payloads.map((payload) => payload.data.caseId).sort(), ['S03', 'S04']);
    for (const payload of payloads) {
      const stats = Object.fromEntries(payload.data.stats.map(({ apiname, value }) => [apiname, value]));
      const expectedQuestions = choice === 'continue' ? 5 : 3;
      assert.equal(stats.DCCS_questionCount, expectedQuestions);
      assert.equal(stats.DCCS_correct + stats.DCCS_wrong, expectedQuestions);
      assert.equal(stats.DCCS_accuracy, stats.DCCS_correct / expectedQuestions);
      assert.equal(stats.DCCS_stage, choice === 'continue' ? 5 : 3);
      if (choice === 'continue') assert.equal(stats.DCCS_duration, 30000);
      else assert.ok(stats.DCCS_duration > 0 && stats.DCCS_duration < 30000);
    }
    return payloads;
  } finally {
    await browser.close();
  }
}

test('雙人中場繼續後移除共用提示，滑鼠可完成整場並送出兩筆逐題成績', { timeout: 60000 }, async () => {
  await playDouble('continue');
});

test('雙人中場返回大廳仍送出兩位玩家前三關的成績', { timeout: 45000 }, async () => {
  await playDouble('lobby');
});
