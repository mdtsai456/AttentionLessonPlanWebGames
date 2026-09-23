// 獨立執行殼（SPEC 4.14）。可嵌入的公開 API 在 dccs.js。

import { mountDCCS } from './dccs.js';
import { readLobbySession, resolveCurrentDay, returnToLobby } from './lobby.js';
import { readSessionSecondsOverride, markDebugSession } from './debugParams.js';

function parseQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    grade: params.get('grade'),
    caseId: params.get('caseId'),
    school: params.get('school'),
    currentDay: params.get('currentDay'),
    seed: params.get('seed'),
  };
}

function needsForm(query) {
  return !query.grade || !query.caseId || !query.school || !query.currentDay;
}

function showFormNotice(message) {
  const form = document.getElementById('setup-form');
  const hint = form.querySelector('.hint');
  if (!hint || !message) return;
  hint.textContent = message;
  hint.classList.add('notice');
}

/**
 * 讀取大廳玩家並查詢 currentDay；查不到時回傳表單預填資料，不猜測值。
 *
 * @returns {Promise<{student: object, fromLobby: boolean} | {prefill: object}>}
 */
async function resolveStudentFromLobby(session) {
  const player = session.players[0];
  const base = {
    grade: player.grade,
    caseId: player.caseId,
    school: player.school,
  };

  try {
    const currentDay = await resolveCurrentDay(player);
    return { student: { ...base, currentDay }, fromLobby: true };
  } catch (err) {
    console.warn('無法自動判斷 currentDay，改由人工填寫：', err);
    return { prefill: base };
  }
}

function waitForForm(initial) {
  return new Promise((resolve) => {
    const form = document.getElementById('setup-form');
    form.hidden = false;

    if (initial.grade) form.grade.value = initial.grade;
    if (initial.caseId) form.caseId.value = initial.caseId;
    if (initial.school) form.school.value = initial.school;
    if (initial.currentDay) form.currentDay.value = initial.currentDay;

    form.addEventListener(
      'submit',
      (e) => {
        e.preventDefault();
        form.hidden = true;
        resolve({
          grade: form.grade.value.trim(),
          caseId: form.caseId.value.trim(),
          school: form.school.value.trim(),
          currentDay: form.currentDay.value.trim(),
        });
      },
      { once: true }
    );
  });
}

function parseSeed(seedParam) {
  if (seedParam === null || seedParam === '') return undefined;
  const n = Number(seedParam);
  return Number.isNaN(n) ? undefined : n;
}

async function main() {
  const query = parseQuery();

  // 資料來源優先序：網址參數 > 大廳 sessionStorage > 手動表單。
  let student = null;
  let fromLobby = false;
  let prefill = query;

  if (!needsForm(query)) {
    student = {
      grade: query.grade,
      caseId: query.caseId,
      school: query.school,
      currentDay: query.currentDay,
    };
  } else {
    const session = readLobbySession();
    if (session) {
      const resolved = await resolveStudentFromLobby(session);
      if (resolved.student) {
        student = resolved.student;
        fromLobby = true;
      } else {
        prefill = { ...query, ...resolved.prefill };
        showFormNotice(
          '已帶入登入資訊，但無法自動判斷第幾天，請確認後填寫。'
        );
      }
    }
  }

  if (!student) {
    student = await waitForForm(prefill);
  }

  const seed = parseSeed(query.seed);
  const container = document.getElementById('game-root');

  const sessionSeconds = readSessionSecondsOverride();
  if (sessionSeconds !== null) markDebugSession(sessionSeconds);

  const handle = mountDCCS({
    container,
    student,
    seed,
    ...(sessionSeconds !== null ? { sessionSeconds } : {}),
  });

  await handle.done;

  // 從大廳進來的，玩完自己走回去；獨立執行則留在結算畫面。
  if (fromLobby) returnToLobby();
}

main().catch((err) => {
  // mountDCCS 會顯示遊戲內錯誤；這裡只捕捉殼層錯誤。
  console.error(err);
});
