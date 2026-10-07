// 真實 HTTP + MariaDB 驗收；先按 README 準備獨立 _test 庫並啟動本機後端。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.LIVE_BASE_URL || 'http://127.0.0.1:19368';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), '只允許本機測試服務');
const browser = await chromium.launch();
const result = { flows: [], sessions: [] };
const games = [
  ['DCCS', '賽道攔截', 'DCCS/index.html', 'DCCS/double.html'],
  ['EFT', '瓢蟲追擊令', 'DAT_single/DAT_single.html', 'DAT_double/DAT_double.html'],
  ['DAT', '漂浮泡泡', 'EFT_single/EFT_single.html', 'EFT_double/EFT_double.html'],
  ['TGame', '勇闖迷宮', 'TGame1/index.html', 'TGame2/index.html'],
  ['InstructionGame', '指令出擊', 'IM1/index.html', null],
];
async function ready(page) {
  await page.waitForFunction(() => window.WebGameAuth?.active && document.querySelectorAll('script[type="application/x-webgame-script"]').length === 0);
}
async function login(page, mode) {
  await page.goto(base + '/app/Home/index.html');
  await page.click('[data-role="student"]');
  await page.click(`[data-mode="${mode === 'double' ? 'dual' : 'single'}"]`);
  for (let index = 0; index < (mode === 'double' ? 2 : 1); index++) {
    await page.fill(`[name="username-${index}"]`, index ? 'browser-two' : 'browser-one');
    await page.fill(`[name="password-${index}"]`, 'browser-test-pw');
    await page.fill(`[name="day-${index}"]`, '3');
  }
  await page.click('#login-form [type="submit"]');
  await page.waitForURL('**/app/Select/index.html');
  await ready(page);
}
try {
  for (const mode of ['single', 'double']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    const saves = [];
    page.on('response', async (response) => {
      if (response.request().method() === 'POST' && response.url() === base + '/api/sessions') {
        const saved = { status: response.status(), request: response.request().postDataJSON() };
        saves.push(saved);
        saved.body = await response.json().catch(() => null);
      }
    });
    await login(page, mode);
    for (const [id, label, single, double] of games) {
      if (mode === 'double' && !double) continue;
      await page.goto(base + '/app/Select/index.html');
      await ready(page);
      if (mode === 'single') {
        await page.click(`#game-list [data-select-game="${id}"]`);
        await page.click('#enter-btn');
      } else {
        for (const slot of [1, 2]) {
          await page.click(`[data-game-list="${slot}"] [data-select-game="${id}"]`);
          await page.click(`[data-enter="${slot}"]`);
        }
      }
      await page.waitForURL('**/app/tutorial/*');
      await ready(page);
      await page.click('a.btn-green');
      const gamePath = mode === 'single' ? single : double;
      await page.waitForURL((url) => url.pathname === '/app/' + gamePath);
      await ready(page);
      const before = saves.length;
      if (id === 'DCCS') {
        await page.goto(base + '/app/' + gamePath + '?sessionSeconds=5');
        if (mode === 'single') {
          await page.click('.dccs-level-continue');
          await page.click('[data-result="lobby"]', { timeout: 20000 });
        } else await page.click('#shared-continue');
        await page.waitForURL('**/app/Select/index.html', { timeout: 20000 });
      } else if (mode === 'single') {
        await page.waitForFunction((id) => id === 'DAT' ? !!window.EFTSingle : typeof startGame === 'function' && (id === 'EFT' ? typeof saveGameDataToBackend === 'function' : typeof submitResult === 'function'), id);
        await page.evaluate(async (id) => {
          const data = { score: 3, wrong: 1, accuracy: 0.75, duration: 1000, stage: 3, levelAccuracy: '1,0.5,0.75', avgReactionMs: 500, questionCount: 4, aimRatio: 0.5, focusMs: 500 };
          if (id === 'DAT') { EFTSingle.startGame(); await EFTSingle.saveGameDataToBackend(data); }
          else if (id === 'EFT') { startGame(); await saveGameDataToBackend(data); }
          else { startGame(); await submitResult(data); }
        }, id);
      } else if (id === 'EFT') {
        await page.evaluate(async () => { const { players } = await import('/app/DAT_double/js/main.js?v=5'); await Promise.all(players.map((player) => player.saveRun(3))); });
      } else if (id === 'DAT') {
        await page.evaluate(async () => { const { players } = await import('/app/EFT_double/EFT_double.js'); await Promise.all(players.map((player) => player.saveRun(3))); });
      } else {
        await page.waitForFunction(() => typeof saveBoth === 'function');
        await page.evaluate(() => saveBoth(3));
      }
      await page.waitForFunction(() => true); // 讓 response body promise 完成。
      const deadline = Date.now() + 10000;
      while (saves.length < before + (mode === 'double' ? 2 : 1) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      const mine = saves.slice(before);
      assert.equal(mine.length, mode === 'double' ? 2 : 1, label);
      assert.ok(mine.every((save) => save.status === 201), JSON.stringify(mine));
      assert.deepEqual(mine.map((save) => save.request.data.caseId).sort(), mode === 'double' ? ['S88', 'S99'] : ['S99']);
      result.flows.push({ mode, game: label, records: mine.length });
      result.sessions.push(...mine.map((save) => ({ sessionId: save.body?.sessionId, ...save.request.data, stats: undefined })));
      console.log(`${mode} ${label}：${mine.length} 筆 201`);
    }
    await context.close();
  }
  const teacherContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(base + '/app/Home/index.html');
  await teacherPage.click('[data-role="teacher"]');
  await teacherPage.fill('[name="username-0"]', 'browser-teacher');
  await teacherPage.fill('[name="password-0"]', 'browser-test-pw');
  await teacherPage.click('#login-form [type="submit"]');
  await teacherPage.waitForURL('**/app/Back/index.html');
  await teacherPage.waitForFunction(() => document.querySelectorAll('#student-select option').length > 1);
  result.teacher = await teacherPage.locator('#student-select').innerText();
  await teacherContext.close();
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
