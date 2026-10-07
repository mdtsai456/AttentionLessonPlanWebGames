// js/main.js
import { generateUUID } from './api.js';
import { createPlayer, TOTAL_STAGES, MID_STAGE } from './game.js?v=9';

let playerPracticeFinished = [false, false];
let currentGamePairId = "";

const midWait = [false, false];
const midResume = [null, null];
let exitPending = false;

async function withExitLock(action) {
  if (exitPending) return;
  exitPending = true;
  const buttons = [...document.querySelectorAll('#leave-btn, #enter-formal-btn, #mid-continue, #mid-lobby, .shared-stage-clear-btn, [data-ui="restart"], [data-ui="back-home"]')];
  const disabled = buttons.map((button) => button.disabled);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await action();
  } finally {
    buttons.forEach((button, index) => { button.disabled = disabled[index]; });
    exitPending = false;
  }
}

function waitForMidBreak(playerIndex, resume) {
  midWait[playerIndex] = true;
  midResume[playerIndex] = resume;
  if (midWait[0] && midWait[1]) {
    const panel = document.getElementById('mid-break');
    if (panel) panel.hidden = false;
  }
}

const stageWait = [null, null];
const stageResume = [null, null];

function waitForStageClear(playerIndex, level, resume) {
  stageWait[playerIndex] = level;
  stageResume[playerIndex] = resume;
  if (stageWait[0] !== level || stageWait[1] !== level) return;
  window.showStageClear(level).then(() => {
    const resumes = stageResume.slice();
    stageWait[0] = stageWait[1] = null;
    stageResume[0] = stageResume[1] = null;
    resumes.forEach((fn) => fn && fn());
  });
}

function clearMidBreak() {
  midWait[0] = midWait[1] = false;
  midResume[0] = midResume[1] = null;
  const panel = document.getElementById('mid-break');
  if (panel) panel.hidden = true;
}

// 任一玩家瞄準動物，兩位玩家同時開始出題
function syncStart() {
  players.forEach((player) => player.forceStart());
}

const state = {
  get playerPracticeFinished() { return playerPracticeFinished; },
  get currentGamePairId() { return currentGamePairId; },
  get players() { return players; },
  get playMode() { return playMode; },
  syncStart,
  waitForMidBreak,
  waitForStageClear,
  restartSession,
  refreshSaveControls
};

export const players = [
  createPlayer(document.querySelector('.player-1'),
    { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }, ['Space'], '空白鍵', 0, () => state),
  createPlayer(document.querySelector('.player-2'),
    { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }, ['Enter', 'NumpadEnter'], 'Enter', 1, () => state)
];

let playMode = new URLSearchParams(window.location.search).get('mode') === 'game'
  ? 'game'
  : 'practice';

// 依兩位玩家都已完成的關卡數存 checkpoint（TOTAL_STAGES 或 MID_STAGE）；每局已存過同一關或更後面的關卡就不再存
async function saveCheckpoint() {
  const completed = Math.min(...players.map((player) => player.completedStages()));
  const stage = completed >= TOTAL_STAGES ? TOTAL_STAGES : completed >= MID_STAGE ? MID_STAGE : 0;
  if (playMode === 'game' && stage) {
    await Promise.all(players.map((player) => player.saveRun(stage)));
  }
  return completed;
}

// 兩位玩家都玩完六關才直接回大廳；否則照舊跳確認框
async function leaveToLobby() {
  await withExitLock(async () => {
    const completed = await saveCheckpoint();
    if (playMode === 'game' && completed >= TOTAL_STAGES) {
    await Promise.all(players.map((player) => player.whenSaved()));
      safeNavigateTo('../Select/index.html');
    } else {
      const stage = completed >= 3 ? 3 : 0;
      if (playMode === 'game' && stage && !(await saveBeforeLeaving(stage))) return;
      window.askLeave('../Select/index.html');
    }
  });
}

document.getElementById('leave-btn').addEventListener('click', leaveToLobby);

function refreshSaveControls() {
  const restartable = players.every((player) => player.canRestart());
  document.querySelectorAll('[data-ui="restart"]').forEach((button) => { button.disabled = !restartable; });
  const statuses = players.map((player) => player.saveStatus());
  const messages = players.map((player, index) => `玩家${index + 1}：${document.querySelector(`.player-${index + 1} [data-ui="save-status"]`).textContent}`);
  document.getElementById('checkpoint-save-status').textContent = messages.join('　');
  document.getElementById('checkpoint-retry-save').hidden = !statuses.includes('failed');
  const resultsVisible = [...document.querySelectorAll('[data-ui="results"]')].every((panel) => !panel.hidden);
  document.getElementById('save-notice').hidden = resultsVisible || statuses.every((status) => status === 'idle' || status === 'saved');
}
document.getElementById('checkpoint-retry-save').addEventListener('click', () => {
  players.filter((player) => player.saveStatus() === 'failed').forEach((player) => player.retrySave());
});

function restartSession() {
  if (!players.every((player) => player.canRestart())) return;
  beginSession();
}

function beginSession() {
  stageWait[0] = stageWait[1] = null;
  stageResume[0] = stageResume[1] = null;
  playerPracticeFinished = [false, false];
  document.getElementById('save-notice').hidden = true;
  clearMidBreak();
  currentGamePairId = generateUUID();
  const formalButton = document.getElementById('enter-formal-btn');
  if (playMode === 'game') {
    if (formalButton) formalButton.hidden = true;
    document.querySelectorAll('[data-ui="pause"]').forEach((button) => {
      button.hidden = true;
    });
    players.forEach((player) => player.startGame());
    return;
  }
  if (formalButton) formalButton.hidden = false;
  players.forEach((player) => player.startPractice());
}

const enterFormalButton = document.getElementById('enter-formal-btn');
if (enterFormalButton) {
  enterFormalButton.addEventListener('click', () => {
    enterFormalButton.hidden = true;
    playMode = 'game';
    document.querySelectorAll('[data-ui="pause"]').forEach((button) => {
      button.hidden = true;
    });
    currentGamePairId = generateUUID();
    players.forEach((player) => player.startGame());
  });
}

const btnCancelLeave = document.getElementById('btn-cancel-leave');
if (btnCancelLeave) {
  btnCancelLeave.addEventListener('click', () => {
    const warningOverlay = document.getElementById('leave-warning-overlay');
    if (warningOverlay) warningOverlay.hidden = true;
    players.forEach(p => {
      if (p.resumeGame) p.resumeGame();
    });
  });
}

function preventLeaveHandler(event) {
  event.preventDefault();
  event.returnValue = '';
}

window.addEventListener('beforeunload', preventLeaveHandler);

export function safeNavigateTo(url) {
  window.removeEventListener('beforeunload', preventLeaveHandler);
  window.onbeforeunload = null;
  // askLeave() 設過的旗標要清掉，否則在確認框選「留在此頁」之後，
  // 之後每次導頁都還會被 leave-confirm.js 攔下再跳一次確認框
  window.__askLeave = false;
  window.location.href = url;
}

document.querySelectorAll('[data-ui="back-home"]').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await leaveToLobby();
  });
});

const midContinue = document.getElementById('mid-continue');
const midLobby = document.getElementById('mid-lobby');
if (midContinue) {
  midContinue.addEventListener('click', () => {
    const resumes = midResume.slice();
    clearMidBreak();
    resumes.forEach((resume) => resume && resume());
  });
}
if (midLobby) {
  midLobby.addEventListener('click', async () => {
    await withExitLock(async () => {
      await saveCheckpoint();
      safeNavigateTo('../Select/index.html');
    });
  });
}

const btnConfirmLeave = document.getElementById('btn-confirm-leave');
if (btnConfirmLeave) {
  btnConfirmLeave.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    safeNavigateTo('../Select/index.html');
  });
}


// 雙人版動態素材與彩蛋清單載入流程
const ASSET_SERVER_HOST = 'https://attention-lesson-plan-assets.zeabur.app';
const DEFAULT_ANIMAL_PATH = 'assets/animals/rabbit.png';

// 預設彩蛋備用圖清單（無素材時輪播用）
const DEFAULT_ANIMAL_POOL = [
  'assets/animals/rabbit.png',
  'assets/animals/cat.png',
  'assets/animals/dog.png',
  'assets/animals/bird.png',
];

function assetStudentId(rawId) {
  const id = String(rawId || '').trim();
  const caseId = id.includes('_') ? id.split('_').pop() : id;
  const match = /^([A-Za-z]+)(\d+)$/.exec(caseId);
  if (!match) return caseId;
  return `${match[1].toUpperCase()}${String(Number(match[2])).padStart(3, '0')}`;
}

// 1. 抓取玩家 (P1/P2) 素材清單，自動補充不足部分以觸發彩蛋
async function fetchStudentAssetList(playerIndex) {
  const isP1 = (playerIndex === 0);
  
  const studentKey = sessionStorage.getItem(isP1 ? 'student1_key' : 'student2_key') || '';
  const rawId = sessionStorage.getItem(isP1 ? 'student1_case' : 'student2_case') ||
                (studentKey.includes('_') ? studentKey.slice(studentKey.indexOf('_') + 1) : studentKey) ||
                (isP1 ? 'S01' : 'S02');

  const studentId = assetStudentId(rawId);
  const apiUrl = `${ASSET_SERVER_HOST}/api/students/${studentId}/assets`;

  return window.DatAssets.fetchAssetList(apiUrl, DEFAULT_ANIMAL_POOL);
}

// 3. 初始化雙人素材與啟動流程
async function initDoubleGameWorkflow() {
  console.log('🎮 雙人遊戲開始，獨立載入 P1/P2 素材與彩蛋清單...');

  const p1Elem = document.querySelector('.player-1');
  const p2Elem = document.querySelector('.player-2');

  // A. 載入前先隱藏 P1 與 P2 的動物與準心，避免畫面預設殘影
  const togglePlayerVisibility = (pElem, visible) => {
    if (!pElem) return;
    const animal = pElem.querySelector('#animal, [data-ui="animal"]');
    const crosshair = pElem.querySelector('#crosshair, [data-ui="crosshair"]');
    if (animal) animal.style.visibility = visible ? 'visible' : 'hidden';
    if (crosshair) crosshair.style.visibility = visible ? 'visible' : 'hidden';
  };

  togglePlayerVisibility(p1Elem, false);
  togglePlayerVisibility(p2Elem, false);

  // B. 並行抓取 P1 與 P2 的素材清單
  const [p1List, p2List] = await Promise.all([
    fetchStudentAssetList(0),
    fetchStudentAssetList(1)
  ]);

  // C. 預載通用與玩家首張圖片
  const [, , p1Initial, p2Initial] = await Promise.all([
    window.DatAssets.loadImage('assets/background.png', 'assets/background.png'),
    window.DatAssets.loadImage('assets/crosshair.png', 'assets/crosshair.png'),
    window.DatAssets.loadImage(p1List[0]),
    window.DatAssets.loadImage(p2List[0])
  ]);
  p1List[0] = p1Initial;
  p2List[0] = p2Initial;

  // D. 將素材清單傳送給兩位 Player 實體
  await Promise.all([
    players[0].setAnimalAssets(p1List),
    players[1].setAnimalAssets(p2List),
  ]);

  // E. 啟動遊戲 Session
  beginSession();

  // F. 載入完成並算好位置後，重新顯示兩位玩家的動物與準心
  togglePlayerVisibility(p1Elem, true);
  togglePlayerVisibility(p2Elem, true);
}

// 執行初始化並啟動動畫 Loop
initDoubleGameWorkflow();

players.forEach((player) => requestAnimationFrame(player.tick));
