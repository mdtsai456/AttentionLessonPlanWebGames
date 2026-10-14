// DCCS 瀏覽器測試共用的登入設定、成績攔截與關卡推進工具。

import { expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const FULL_LENGTH = process.env.DCCS_FULL_LENGTH === '1';
export const LEVEL_SECONDS = FULL_LENGTH ? 60 : 10;
export const QUERY = FULL_LENGTH ? '' : '?sessionSeconds=60';
export const SUBMIT_PATH = '/__test__/api/sessions';
export const screenshotPath = (name) => fileURLToPath(new URL(`../../.context/${name}.png`, import.meta.url));

// 一關的時間加上等待題目離場的餘裕。機器忙時影格變慢，遊戲時間會落後實際時間，所以抓寬一點。
export const LEVEL_TIMEOUT = (LEVEL_SECONDS * 2 + 30) * 1000;

// 假的登入 token 與後端 /auth/me 回傳的學生身分。
const STUDENTS = {
  'token-1': { caseId: 'T01' },
  'token-2': { caseId: 'T02' },
};

/**
 * 寫入大廳登入資料、攔截登入驗證，並把成績送出位址改到可攔截的同源路徑。
 * @param {import('@playwright/test').Page} page
 * @param {'single' | 'double'} mode
 * @param {{delayMs?: number, fail?: boolean, hang?: boolean}} [submitOptions]
 */
export async function setup(page, mode, submitOptions = {}) {
  const posts = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.addInitScript(({ mode, submitPath }) => {
    const s = window.sessionStorage;
    s.setItem('user_role', 'student');
    s.setItem('game_mode', mode);
    s.setItem('school', 'TEST');
    s.setItem('student1_case', 'T01');
    s.setItem('student1_grade', 'G1');
    s.setItem('student1_school', 'TEST');
    s.setItem('student1_day', '1');
    s.setItem('student1_token', 'token-1');
    if (mode === 'double') {
      s.setItem('student2_case', 'T02');
      s.setItem('student2_grade', 'G1');
      s.setItem('student2_school', 'TEST');
      s.setItem('student2_day', '1');
      s.setItem('student2_token', 'token-2');
    }
    s.setItem('login_expires_at', String(Date.now() + 3600e3));
    // 登入驗證改打同源，由下面的 route 回應，不需要真的後端。
    window.API_BASE_URL = `${location.origin}/api`;
    window.DCCS_SUBMIT_URL = submitPath;
  }, { mode, submitPath: SUBMIT_PATH });

  await page.route('**/api/auth/me', async (route) => {
    const token = (route.request().headers().authorization || '').replace(/^Bearer /, '');
    const student = STUDENTS[token];
    if (!student) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        role: 'student',
        grade: 'G1',
        caseId: student.caseId,
        school: 'TEST',
        studentKey: `G1_${student.caseId}`,
        expiresAt: new Date(Date.now() + 3600e3).toISOString(),
        expiresIn: 3600,
      }),
    });
  });

  await page.route(`**${SUBMIT_PATH}`, async (route) => {
    posts.push(route.request().postDataJSON());
    if (submitOptions.hang) return;
    if (submitOptions.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, submitOptions.delayMs));
    }
    if (submitOptions.fail) {
      await route.abort();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return { posts, pageErrors };
}

// 六關都可出題，整場打完最高到第 6 關（SPEC 4.11）。
export const FULL_SESSION_STAGE = 6;
export const FULL_SESSION_LEVELS = '1,2,3,4,5,6';

/** 讀出 payload 裡某個 stats 欄位的值。 */
export function stat(payload, name) {
  const entry = payload.data.stats.find((item) => item.apiname === `DCCS_${name}`);
  return entry ? entry.value : undefined;
}

/**
 * 處理關卡提示與關間畫面，直到 stopWhen 成立。
 * @param {import('@playwright/test').Page} page
 * @param {'single' | 'double'} mode
 * @param {string} stopWhen 'break' | 'level4-clear' | 'session-end'
 * @param {number} timeoutMs
 */
export async function drive(page, mode, stopWhen, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (stopWhen === 'session-end' && /\/Select\/index\.html/.test(page.url())) {
      return 'navigated';
    }

    const step = await page
      .evaluate(({ mode, stopWhen }) => {
        const visible = (el) => !!el && el.checkVisibility();
        const stageClear = document.querySelector('.shared-stage-clear');

        if (stageClear && !stageClear.hidden) {
          const text = stageClear.textContent;
          if (stopWhen === 'level4-clear' && text.includes('第 4 關結束')) {
            return 'level4-clear';
          }
          document.querySelector('.shared-stage-clear-btn').click();
          return 'stage-clear';
        }

        if (mode === 'double') {
          if (visible(document.getElementById('shared-break'))) return 'break';
          if (visible(document.getElementById('shared-title'))) return 'title';
          if (visible(document.getElementById('shared-level'))) {
            document.getElementById('shared-continue').click();
            return 'level-prompt';
          }
          return 'running';
        }

        if ([...document.querySelectorAll('[data-break="continue"]')].some(visible)) return 'break';
        const resultLobby = [...document.querySelectorAll('[data-result="lobby"]')].find(visible);
        if (resultLobby) {
          if (stopWhen === 'session-end') resultLobby.click();
          return 'result';
        }
        const levelButton = [...document.querySelectorAll('.dccs-level-continue:not([data-break])')]
          .find(visible);
        if (levelButton) {
          levelButton.click();
          return 'level-prompt';
        }
        return 'running';
      }, { mode, stopWhen })
      // 導頁途中 evaluate 可能失敗，下一輪再看。
      .catch(() => 'navigating');

    if (step === 'title') await page.keyboard.press('Space');
    if (step === stopWhen) return step;
    if (stopWhen === 'session-end' && step === 'break') {
      throw new Error('session-end 不應再遇到中場休息畫面');
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`drive: ${timeoutMs}ms 內沒有等到 ${stopWhen}`);
}

export async function reachBreak(page, mode) {
  await page.goto(`${mode === 'double' ? '/DCCS_double/index.html' : '/DCCS_single/index.html'}${QUERY}`);
  await drive(page, mode, 'break', 3 * LEVEL_TIMEOUT + 15_000);
}

/** 頁面內的離開確認框（shared/leave-confirm.js）。 */
export function leaveDialog(page) {
  return page.getByRole('dialog', { name: '確定要離開嗎？' });
}

/** 確認框裡的按鈕：'stay' 是「繼續遊戲」，'leave' 是「離開」。 */
export async function answerLeave(page, answer) {
  const name = answer === 'leave' ? '離開' : '繼續遊戲';
  await leaveDialog(page).getByRole('button', { name, exact: true }).click({ timeout: 10_000 });
  await expect(leaveDialog(page)).toHaveCount(0);
}

/**
 * 記錄瀏覽器原生對話框（beforeunload 的「離開網站？」等）。
 * 一律接受，讓導頁照常進行，測試再檢查清單是否為空。
 */
export function recordNativeDialogs(page) {
  const dialogs = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.accept();
  });
  return dialogs;
}

/** 模擬離頁：beforeunload 被 preventDefault 代表離開保護有作用。 */
export function unloadGuardActive(page) {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

/**
 * 開始收集頁面上的 Track 實例（雙人頁要用 DCCS_double 那份引擎），之後用 trackStates 讀進度。
 * 只包一層 render 記下實例，不改題目、計時或判定。
 * @param {import('@playwright/test').Page} page
 * @param {'single' | 'double'} mode
 */
export async function watchTracks(page, mode) {
  await page.evaluate(async (mode) => {
    const { Track } = await import(`/DCCS_${mode}/js/game/track.js`);
    const render = Track.prototype.render;
    window.watchedTracks = new Set();
    Track.prototype.render = function (...args) {
      window.watchedTracks.add(this);
      return render.apply(this, args);
    };
  }, mode);
  await expect.poll(() => page.evaluate(() => window.watchedTracks.size))
    .toBe(mode === 'double' ? 2 : 1);
}

/** 每個 Track 目前的遊戲時間、關卡、這題轉了幾格與已記錄的題數。 */
export function trackStates(page) {
  return page.evaluate(() => [...window.watchedTracks].map((track) => ({
    elapsed: track.elapsed,
    level: track.currentLevelNo,
    shapePresses: track._shapePressCount,
    objectPresses: track._objectPressCount,
    rows: track.stats.rows().length,
  })));
}

/**
 * 取出每個 Track 的輸入裡還沒套用的按鍵次數（會清掉）。
 * 不是 0 代表遊戲恢復後會補轉。
 */
export function takeQueuedPresses(page) {
  return page.evaluate(() => [...window.watchedTracks].map((track) =>
    track.input.takePresses('rotateShape') + track.input.takePresses('rotateObject')));
}

/** 按下兩位玩家（單人版同一組）所有轉動輪盤的鍵。 */
export async function pressAllValveKeys(page) {
  for (const key of ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight']) {
    await page.keyboard.press(key);
  }
}

/** localStorage 裡等著重送的 DCCS 成績。 */
export function pendingResults(page) {
  return page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('dccs_pending_'))
    .map((key) => JSON.parse(localStorage.getItem(key))));
}
