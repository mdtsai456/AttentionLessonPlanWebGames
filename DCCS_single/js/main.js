// 獨立執行的入口。學生資料來自 Home 登入，此處不顯示選單。

import { mountDCCS } from './dccs.js?v=9';
import { readLobbySession, returnToLobby } from './lobby.js?v=2';
import { readSessionSecondsOverride, markDebugSession } from './debugParams.js';

function goHome() {
  window.location.href = '../Home/index.html';
}

function studentFromHome() {
  const session = readLobbySession();
  if (!session || !session.players[0]) return null;
  if (session.mode === 'double') {
    window.location.href = '../DCCS_double/index.html';
    return 'redirect';
  }

  const player = session.players[0];
  if (!player.grade || !player.caseId || !player.school || !player.currentDay) {
    return null;
  }

  return {
    grade: player.grade,
    caseId: player.caseId,
    school: player.school,
    currentDay: player.currentDay,
  };
}

function parseSeed() {
  const seedParam = new URLSearchParams(window.location.search).get('seed');
  if (seedParam === null || seedParam === '') return undefined;
  const n = Number(seedParam);
  return Number.isNaN(n) ? undefined : n;
}

async function main() {
  const student = studentFromHome();
  if (student === 'redirect') return;
  if (!student) {
    goHome();
    return;
  }

  const sessionSeconds = readSessionSecondsOverride();
  if (sessionSeconds !== null) markDebugSession(sessionSeconds);

  // 當天已完成前半（後端有今天的 stage 3）就從第 4 關開始；最多等 5 秒，不會 reject。
  // 不在這裡等：先掛上遊戲顯示載入畫面、綁好離開，查詢和載入關卡資料、圖片同時進行。
  const startLevel = window.WebGameSecondHalf ? window.WebGameSecondHalf.startStage('DCCS', { mode: 'single', slots: [1] }) : 1;

  const handle = mountDCCS({
    container: document.getElementById('game-root'),
    student,
    startLevel,
    seed: parseSeed(),
    showTutorial: false,
    autoStart: true,
    viewportAspect: null,
    ...(sessionSeconds !== null ? { sessionSeconds } : {}),
  });

  document.getElementById('leave-btn').addEventListener('click', () => {
    handle.leave();
  });

  await handle.done;
  returnToLobby();
}

main().catch((err) => {
  console.error(err);
});
