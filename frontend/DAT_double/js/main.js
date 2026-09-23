// js/main.js
import { generateUUID } from './api.js';
import { createPlayer } from './game.js';

let playerPracticeFinished = [false, false];
let currentGamePairId = "";

const state = {
  get playerPracticeFinished() { return playerPracticeFinished; },
  get currentGamePairId() { return currentGamePairId; },
  get players() { return players; },
  safeNavigateTo
};

export const players = [
  createPlayer(document.querySelector('.player-1'),
    { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }, ['Space'], '空白鍵', 0, () => state),
  createPlayer(document.querySelector('.player-2'),
    { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }, ['Enter', 'NumpadEnter'], 'Enter', 1, () => state)
];

document.getElementById('start-practice-btn').addEventListener('click', () => {
  currentGamePairId = generateUUID();
  document.getElementById('tutorial-overlay').hidden = true;
  players.forEach((player) => player.startPractice());
});

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
    safeNavigateTo('../games.html');
  });
});

const btnConfirmLeave = document.getElementById('btn-confirm-leave');
if (btnConfirmLeave) {
  btnConfirmLeave.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    safeNavigateTo('../games.html');
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
  document.querySelectorAll('[data-ui="feedback"]').forEach((f) => f.textContent = '請閱讀教學頁面後點擊開始');
}).catch(() => {
  document.querySelectorAll('[data-ui="feedback"]').forEach((feedback) => {
    feedback.textContent = '圖片載入失敗，請重新整理';
  });
});

players.forEach((player) => requestAnimationFrame(player.tick));