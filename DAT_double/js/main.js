// js/main.js
import { generateUUID } from './api.js';
import { createPlayer } from './game.js';

let playerPracticeFinished = [false, false];
let currentGamePairId = "";

const midWait = [false, false];
const midResume = [null, null];

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

const state = {
  get playerPracticeFinished() { return playerPracticeFinished; },
  get currentGamePairId() { return currentGamePairId; },
  get players() { return players; },
  get playMode() { return playMode; },
  safeNavigateTo,
  waitForMidBreak,
  waitForStageClear
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

function beginSession() {
  clearMidBreak();
  currentGamePairId = generateUUID();
  const formalButton = document.getElementById('enter-formal-btn');
  if (playMode === 'game') {
    if (formalButton) formalButton.hidden = true;
    document.querySelectorAll('[data-ui="pause"], [data-ui="back-home"]').forEach((button) => {
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
    document.querySelectorAll('[data-ui="pause"], [data-ui="back-home"]').forEach((button) => {
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
  window.location.href = url;
}

document.querySelectorAll('[data-ui="back-home"]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    safeNavigateTo('../Select/index.html');
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
  midLobby.addEventListener('click', () => {
    safeNavigateTo('../Select/index.html');
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

Promise.all(['assets/background.png', 'assets/crosshair.png', 'assets/animals/rabbit.png'].map((src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  })
)).then(() => {
  beginSession();
}).catch(() => {
  document.querySelectorAll('[data-ui="feedback"]').forEach((feedback) => {
    feedback.textContent = '圖片載入失敗，請重新整理';
  });
});

players.forEach((player) => requestAnimationFrame(player.tick));