// 獨立執行殼。學生資料只來自 Home 登入，這裡不再顯示選單。

import { mountDCCS } from './dccs.js';
import { readLobbySession, returnToLobby } from './lobby.js';
import { readSessionSecondsOverride, markDebugSession } from './debugParams.js';

function goHome() {
  window.location.href = '../Home/index.html';
}

function studentFromHome() {
  const session = readLobbySession();
  if (!session || !session.players[0]) return null;
  if (session.mode === 'double') {
    window.location.href = './double.html';
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

  const handle = mountDCCS({
    container: document.getElementById('game-root'),
    student,
    seed: parseSeed(),
    ...(sessionSeconds !== null ? { sessionSeconds } : {}),
  });

  await handle.done;
  returnToLobby();
}

main().catch((err) => {
  console.error(err);
});
