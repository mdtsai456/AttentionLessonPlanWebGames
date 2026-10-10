// 動物追擊令 E2E 測試共用工具
// 內建靜態伺服器，不需要 Python。
// Playwright 模擬時鐘加速遊戲時間，使每題 10 秒的流程在數百毫秒內完成。
// 攔截所有外部請求。素材 API 回傳指定清單，成績 API 僅記錄請求，並阻止字型請求。
// 在頁面注入觀測函式，記錄回饋文字、動物圖片、data-result 與準心的瞄準狀態。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
// SITE_ROOT 可指定其他版本的程式碼，用於回歸比對。
export const SITE_ROOT = process.env.SITE_ROOT ? path.resolve(process.env.SITE_ROOT) : REPO_ROOT;

const ASSET_HOST = 'https://attention-lesson-plan-assets.zeabur.app';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

// recordResult 設定的單題判定訊息。
export const RESULT_RE = /^(瞄準且答對|正確等待且保持瞄準|漏答|誤按|判斷正確，但準心未對到動物)/;

export async function startStaticServer(root = SITE_ROOT) {
  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    const file = path.join(root, decodeURIComponent(pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function launchBrowser() {
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined);
  return chromium.launch({ executablePath, headless: process.env.HEADED !== '1' });
}

// 測試用的每幀間隔。遊戲使用時間差 delta 計算，增加間隔可縮短測試時間。
const FRAME_MS = Number(process.env.FRAME_MS || 100);

// 在頁面腳本執行前，注入觀測函式。
function installProbes({ frameMs, realAim, realClock, randomValue }) {
  if (typeof randomValue === 'number') Math.random = () => randomValue;
  // 使用模擬時鐘的 setTimeout 執行 requestAnimationFrame，降低每幀更新頻率。
  if (!realClock) window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), frameMs);
  if (!realClock) window.cancelAnimationFrame = (id) => clearTimeout(id);

  const qa = {
    feedback: [[], []],      // 每位玩家的回饋文字設定記錄。
    questions: [[], []],     // 每位玩家每次出題的題型
    resultMarks: [[], []],   // 動物 data-result 每次設定的非空值：correct／wrong。
    offTarget: [false, false],
  };
  window.__qa = qa;

  const playerOf = (el) => (el.closest('.player-2') ? 1 : 0);
  const is = (el, id) => el.matches?.(`[data-ui="${id}"], #${id}`);

  const textDesc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  Object.defineProperty(Node.prototype, 'textContent', {
    configurable: true,
    get() { return textDesc.get.call(this); },
    set(value) {
      if (this.nodeType === 1) {
        if (is(this, 'feedback')) qa.feedback[playerOf(this)].push(String(value));
        if (is(this, 'question-type') && /判斷/.test(value)) qa.questions[playerOf(this)].push(String(value));
      }
      textDesc.set.call(this, value);
    },
  });

  // 準心固定瞄準動物。offTarget 為 true 時，固定未瞄準，使測試結果只取決於作答。
  const rectOf = Element.prototype.getBoundingClientRect;
  if (!realAim) Element.prototype.getBoundingClientRect = function () {
    if (is(this, 'animal') || is(this, 'animal-image')) {
      const p = playerOf(this);
      const root = p === 1 ? document.querySelector('.player-2') : (document.querySelector('.player-1') || document);
      const field = root.querySelector('[data-ui="field"], #field');
      const cross = root.querySelector('[data-ui="crosshair"], #crosshair');
      if (qa.offTarget[p]) return new DOMRect(-9999, -9999, 0, 0);
      if (is(this, 'animal-image')) return rectOf.call(this);
      const f = rectOf.call(field);
      const cx = f.left + parseFloat(cross.style.left || '50') / 100 * f.width;
      const cy = f.top + parseFloat(cross.style.top || '50') / 100 * f.height;
      return new DOMRect(cx - 50, cy - 50, 100, 100);
    }
    return rectOf.call(this);
  };

  // 記錄 data-result 的紅光與綠光值，使用 oldValue 還原設定順序。
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'interactive') return;
    document.querySelectorAll('[data-ui="animal"], #animal').forEach((el) => {
      const p = playerOf(el);
      const history = [];
      new MutationObserver((records) => {
        for (const r of records) history.push(r.oldValue ?? '');
        const values = [...history.slice(1), el.dataset.result ?? ''];
        qa.resultMarks[p] = values.filter(Boolean);
      }).observe(el, { attributes: true, attributeFilter: ['data-result'], attributeOldValue: true });
    });
  });
}

/**
 * 開啟遊戲頁面。
 * @param {object} opts
 * @param {'double'|'single'} opts.game
 * @param {'game'|'practice'} opts.mode
 * @param {string[]|null} opts.assetFiles 素材 API 回傳的檔案清單。null 表示使用預設的兔、貓、狗與鳥圖片。
 */
export async function openGame(browser, origin, { game, mode = 'game', assetFiles = null, routeOverride, realAim = false, realClock = false, randomValue }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const pageErrors = [];
  const sessionPosts = [];
  const blocked = [];

  page.on('pageerror', (err) => { pageErrors.push(err.message); errors.push(`pageerror: ${err.message}`); });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });

  const placeholderPng = await readFile(path.join(SITE_ROOT, 'DAT_double/assets/animals/rabbit.png'));
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    const pathname = new URL(url).pathname;
    if (pathname === '/api/auth/me') {
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization',
        'Access-Control-Allow-Methods': 'GET',
        'Cache-Control': 'no-store',
      };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const token = (req.headers().authorization || '').replace(/^Bearer\s+/i, '');
      const caseId = token.split('-').pop() || 'S03';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers,
        body: JSON.stringify({
          role: 'student',
          grade: 'G1',
          caseId,
          school: 'KMU',
          studentKey: `G1_${caseId}`,
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      });
    }
    if (/\/api\/sessions$/.test(pathname) && req.method() === 'POST') sessionPosts.push(req.postDataJSON());
    if (routeOverride && await routeOverride({ route, request: req, url, origin, sessionPosts, placeholderPng })) return;
    if (url.startsWith(origin)) return route.continue();
    if (url.startsWith(`${ASSET_HOST}/api/students/`)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        // 未指定素材時，回傳空清單。遊戲使用預設的兔、貓、狗與鳥圖片。
        body: JSON.stringify(assetFiles ? { DAT: { assets: { files: assetFiles } } } : {}),
      });
    }
    if (url.startsWith(`${ASSET_HOST}/`)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: placeholderPng });
    }
    if (/\/api\/sessions$/.test(new URL(url).pathname) && req.method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ sessionId: 'e2e-test' }),
      });
    }
    // 其他外部資源，例如 Google Fonts，回傳空內容，不連線至外部服務。
    blocked.push(url);
    return route.fulfill({ status: 200, body: '' });
  });

  // 載入前暫停模擬時鐘，之後只使用 runFor 推進，使每次執行流程一致。
  const start = new Date('2026-10-04T09:00:00+08:00').getTime();
  if (!realClock) {
    await page.clock.install({ time: start });
    await page.clock.pauseAt(start + 1000);
  }
  await page.addInitScript(installProbes, { frameMs: FRAME_MS, realAim, realClock, randomValue });
  await page.addInitScript((mode) => {
    const players = mode === 'double'
      ? [{ slot: 1, caseId: 'S01' }, { slot: 2, caseId: 'S02' }]
      : [{ slot: 1, caseId: 'S03' }];
    sessionStorage.setItem('user_role', 'student');
    sessionStorage.setItem('game_mode', mode);
    for (const player of players) {
      sessionStorage.setItem(`student${player.slot}_token`, `student-${player.caseId}`);
      sessionStorage.setItem(`student${player.slot}_key`, `G1_${player.caseId}`);
      sessionStorage.setItem(`student${player.slot}_case`, player.caseId);
      sessionStorage.setItem(`student${player.slot}_grade`, 'G1');
      sessionStorage.setItem(`student${player.slot}_school`, 'KMU');
      sessionStorage.setItem(`student${player.slot}_day`, '1');
    }
    if (mode === 'single') {
      sessionStorage.setItem('token', 'student-S03');
      sessionStorage.setItem('grade', 'G1');
      sessionStorage.setItem('caseId', 'S03');
      sessionStorage.setItem('school', 'KMU');
      sessionStorage.setItem('currentDay', '1');
      sessionStorage.setItem('current_day', '1');
    }
  }, game);
  const file = game === 'double' ? 'DAT_double/DAT_double.html' : 'DAT_single/DAT_single.html';
  await page.goto(`${origin}/${file}?mode=${mode}`, { waitUntil: 'domcontentloaded' });

  const players = game === 'double' ? [0, 1] : [0];
  const driver = new GameDriver(page, game, players);
  if (realClock) await page.waitForFunction(() => window.__qa.feedback[0].some((t) => /動物身上/.test(t)));
  else await driver.waitFor(() => window.__qa.feedback[0].some((t) => /動物身上/.test(t)), '遊戲載入完成');
  return { page, context, driver, errors, pageErrors, sessionPosts, blocked };
}

export class GameDriver {
  constructor(page, game, players) {
    this.page = page;
    this.game = game;
    this.players = players;
    this.keys = game === 'double' ? ['Space', 'Enter'] : ['Space'];
    this.seenQuestions = players.map(() => 0);
    this.seenResults = players.map(() => 0);
    this.seenMarks = players.map(() => 0);
  }

  // 推進時鐘並等待條件成立。出現過關畫面時，自動按繼續。
  async waitFor(predicate, label, { stepMs = 500, maxMs = 120000, arg } = {}) {
    for (let t = 0; t <= maxMs; t += stepMs) {
      const done = await this.page.evaluate(({ src, arg }) => {
        // eslint-disable-next-line no-new-func
        if (new Function(`return (${src})`)()(arg)) return true;
        const visible = (el) => el && el.getClientRects().length && !el.disabled && !el.closest('[hidden]');
        for (const sel of ['.shared-stage-clear-btn', '#btn-next-stage', '#mid-continue']) {
          const btn = document.querySelector(sel);
          if (visible(btn)) btn.click();
        }
        return false;
      }, { src: predicate.toString(), arg });
      if (done) return;
      await this.page.clock.runFor(stepMs);
    }
    throw new Error(`等待逾時：${label}`);
  }

  async snapshot() {
    return this.page.evaluate(() => {
      const roots = document.querySelector('.player-1')
        ? [document.querySelector('.player-1'), document.querySelector('.player-2')]
        : [document];
      return roots.map((root) => {
        const q = (id) => root.querySelector(`[data-ui="${id}"], #${id}`);
        return {
          questionType: q('question-type').textContent,
          questionText: q('question-text').textContent,
          questionColor: q('question-text').style.color,
          image: q('animal-image').getAttribute('src'),
          feedback: q('feedback').textContent,
        };
      });
    });
  }

  // 依 DOM 中的題目計算答案。雙人模式未對外提供題目資料。
  async solve(p) {
    if (this.game === 'single') {
      // 單人版的題目是全域變數
      return this.page.evaluate(() => questions[index].answer); // eslint-disable-line no-undef
    }
    const snap = (await this.snapshot())[p];
    if (/顏色判斷/.test(snap.questionType)) {
      return this.page.evaluate(async ({ text, color }) => {
        const { COLOR_POOL } = await import('/DAT_double/js/questions.js');
        const hex = COLOR_POOL.find((c) => c.name === text)?.hex;
        if (!hex) throw new Error(`未知色名 ${text}`);
        const el = document.createElement('span');
        el.style.color = hex;
        return el.style.color === color;
      }, { text: snap.questionText, color: snap.questionColor });
    }
    const m = snap.questionText.match(/^(\d+) ([+−]) (\d+) = (\d+)$/);
    if (!m) throw new Error(`無法解析題目：${snap.questionText}`);
    const actual = m[2] === '+' ? Number(m[1]) + Number(m[3]) : Number(m[1]) - Number(m[3]);
    return actual === Number(m[4]);
  }

  /**
   * 執行一題。actions 依玩家順序指定。
   * 'correct'：正確作答。正確題按鍵，不正確題不按鍵。
   * 'miss'：錯誤作答。正確題漏答，不正確題誤按。
   * 'offTarget'：正確作答，但準心未瞄準動物。
   * 回傳各玩家的判定訊息、紅綠光、動物圖片與判定後的畫面回饋文字。
   */
  async playQuestion(...actions) {
    const { players } = this;
    await this.waitFor(
      (seen) => seen.every((n, p) => window.__qa.questions[p].length > n),
      '下一題出現',
      { arg: this.seenQuestions },
    );
    const questionTypes = await this.page.evaluate(
      (seen) => seen.map((n, p) => window.__qa.questions[p][n]),
      this.seenQuestions,
    );
    this.seenQuestions = this.seenQuestions.map((n) => n + 1);

    for (const p of players) {
      const action = actions[p] ?? 'correct';
      const answer = await this.solve(p);
      if (action === 'offTarget') await this.page.evaluate((i) => { window.__qa.offTarget[i] = true; }, p);
      const press = action === 'miss' ? !answer : answer;
      if (press) await this.page.keyboard.press(this.keys[p]);
    }

    await this.waitFor(
      ({ seen, re }) => seen.every((n, p) => window.__qa.feedback[p].filter((t) => new RegExp(re).test(t)).length > n),
      '判定結果',
      { arg: { seen: this.seenResults, re: RESULT_RE.source } },
    );
    await this.page.evaluate(() => { window.__qa.offTarget = [false, false]; });
    // 換圖前，須等待非同步預載完成。推進 300 ms 不代表 HTTP 請求或圖片解碼已完成。
    await this.page.clock.runFor(300);
    await this.waitFor(() => [...document.querySelectorAll('#animal-image, [data-ui="animal-image"]')]
      .every((img) => img.complete && img.naturalWidth > 0 && img.style.opacity !== '0.2'),
    '動物圖片預載或回退完成', { stepMs: 100, maxMs: 6000 });

    const state = await this.page.evaluate(
      ({ seenResults, seenMarks, re }) => seenResults.map((n, p) => ({
        message: window.__qa.feedback[p].filter((t) => new RegExp(re).test(t))[n],
        mark: window.__qa.resultMarks[p][seenMarks[p]],
        markCount: window.__qa.resultMarks[p].length,
      })),
      { seenResults: this.seenResults, seenMarks: this.seenMarks, re: RESULT_RE.source },
    );
    const snaps = await this.snapshot();
    for (const p of players) {
      const marks = state[p].markCount - this.seenMarks[p];
      if (marks !== 1) throw new Error(`P${p + 1} 這一題的紅綠光應設定 1 次，實際 ${marks} 次`);
    }
    this.seenResults = this.seenResults.map((n) => n + 1);
    this.seenMarks = state.map((s) => s.markCount);
    return players.map((p) => ({
      questionType: questionTypes[p],
      message: state[p].message,
      mark: state[p].mark,
      image: path.basename(snaps[p].image),
      visibleFeedback: snaps[p].feedback,
    }));
  }
}

export function hintFor(remaining) {
  return `（再連續答對 ${remaining} 題變身）`;
}
