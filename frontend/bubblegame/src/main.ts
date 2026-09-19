import './style.css';
import { createGameController } from './controller';
import { GameController, PlayerGame, type GameMode, type GameTimingMode } from './game';
import { FORMAL_LEVEL_COUNT, FORMAL_LEVEL_DURATION_SECONDS, TEST_DURATION_SECONDS } from './game-config';
import { DomPlayerRenderer } from './renderer';
import { createAppElements, GameView } from './ui';
import { GameApiClient, type SessionPayload } from './api-client';
import { BrowserSessionAdapter, createSessionPayload } from './session-adapter';

const view = new GameView(createAppElements());
const apiClient = new GameApiClient();
const sessionAdapter = new BrowserSessionAdapter();
const gameCode = import.meta.env.VITE_GAME_CODE ?? 'EFT';

let controller: GameController | undefined;
let players: PlayerGame[] = [];
let mode: GameMode = 'single';
let timingMode: GameTimingMode = 'test';
let startTime = 0;
let pairId: string | undefined;
let pendingUploads: SessionPayload[] = [];
let uploadInProgress = false;

function showResults(): void {
  view.hideLevelPause();
  view.setEarlyFinishVisible(false);
  view.showResults(mode, players);
  void submitResults();
}

async function submitResults(): Promise<void> {
  if (!apiClient.enabled) {
    view.setResultUploadStatus('未設定後端 API，成績尚未上傳。', 'error');
    return;
  }

  const endTime = Date.now();
  const activePlayers = mode === 'single' ? [players[0]] : players;
  const contexts = activePlayers.map((_, index) => sessionAdapter.getContext(index));
  if (contexts.some((context) => !context)) {
    view.setResultUploadStatus('找不到完整的登入學生資料，成績未上傳。請返回大廳重新登入。', 'error');
    return;
  }

  pendingUploads = activePlayers.map((player, index) => createSessionPayload(
    contexts[index]!, mode, player.stats, startTime, endTime, gameCode, pairId,
  ));
  await savePendingResults();
}

async function savePendingResults(): Promise<void> {
  if (uploadInProgress || pendingUploads.length === 0) return;

  uploadInProgress = true;
  view.setUploadBusy(true);
  view.setRetryUploadVisible(false);
  view.setResultUploadStatus('成績上傳中…', 'pending');
  const attempts = pendingUploads;
  const outcomes = await Promise.allSettled(attempts.map((payload) => apiClient.submitSession(payload)));
  pendingUploads = attempts.filter((_, index) => outcomes[index].status === 'rejected');
  uploadInProgress = false;
  view.setUploadBusy(false);

  if (pendingUploads.length === 0) {
    view.setResultUploadStatus('成績已成功儲存。', 'success');
    return;
  }

  const savedCount = attempts.length - pendingUploads.length;
  view.setResultUploadStatus(
    `${savedCount > 0 ? `${savedCount} 筆已儲存；` : ''}${pendingUploads.length} 筆成績上傳失敗，請重試。`,
    'error',
  );
  view.setRetryUploadVisible(true);
}

function createPlayers(): void {
  players = [
    new PlayerGame('left', new DomPlayerRenderer(view.elements.leftArena), {
      ArrowUp: ['KeyW', 'ArrowUp'], ArrowDown: ['KeyS', 'ArrowDown'],
      ArrowLeft: ['KeyA', 'ArrowLeft'], ArrowRight: ['KeyD', 'ArrowRight'],
    }, (correct) => { view.showFeedback('left', correct); updateScores(); }),
    new PlayerGame('right', new DomPlayerRenderer(view.elements.rightArena), {
      ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
    }, (correct) => { view.showFeedback('right', correct); updateScores(); }),
  ];
}

function updateScores(): void {
  const primaryScore = players[0]?.stats.score ?? 0;
  const secondaryScore = mode === 'single'
    ? primaryScore
    : players[1]?.stats.score ?? 0;
  view.updateScores(primaryScore, secondaryScore);
}

function startGame(selectedMode: GameMode, selectedTimingMode: GameTimingMode): void {
  const currentDay = view.getCurrentDay();
  if (currentDay === undefined) return;

  mode = selectedMode;
  timingMode = selectedTimingMode;
  startTime = Date.now();
  pairId = mode === 'multi' ? crypto.randomUUID() : undefined;
  sessionStorage.setItem('current_day', String(currentDay));
  pendingUploads = [];
  view.setResultUploadStatus('', 'pending');
  view.setRetryUploadVisible(false);
  createPlayers();
  view.showPlay(mode);
  const durationSeconds = timingMode === 'test'
    ? TEST_DURATION_SECONDS
    : FORMAL_LEVEL_COUNT * FORMAL_LEVEL_DURATION_SECONDS;
  controller = createGameController(durationSeconds, mode === 'single' ? [players[0]] : players, {
    timerDisplay: view.elements.timerDisplay,
    onFinish: showResults,
    onLevelPause: (level) => {
      view.showLevelPause(
        level,
        mode === 'multi' ? '請確認兩位玩家都準備好，再一起進入下一關。' : undefined,
      );
    },
  }, timingMode, FORMAL_LEVEL_COUNT, FORMAL_LEVEL_DURATION_SECONDS);
  view.setEarlyFinishVisible(timingMode === 'test');
  controller.start();
  updateScores();
}

function returnToSetup(): void {
  controller?.reset();
  controller = undefined;
  view.hideLevelPause();
  view.setEarlyFinishVisible(false);
  view.showSetup();
}

function finishTestGame(): void {
  if (timingMode !== 'test' || controller?.state !== 'running') return;
  if (window.confirm('確定要提前結束這次測試嗎？')) controller.finish();
}

function leaveGame(): void {
  if (!window.confirm('中途離開會導致數據遺失，是否能要離開?')) return;
  controller?.reset();
  controller = undefined;
  window.location.href = window.location.pathname.includes('/dist/')
    ? '../../games.html'
    : '../games.html';
}

document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.key === 'Escape' && controller?.state === 'running' && timingMode === 'test') {
    event.preventDefault();
    finishTestGame();
    return;
  }
  if (controller?.state !== 'running') return;
  const activePlayers = mode === 'single' ? [players[0]] : players;
  const handled = activePlayers.some((player) => player.handleKey(event.code, event.key));
  if (handled) event.preventDefault();
});

window.addEventListener('beforeunload', (event) => {
  const gameIsActive = controller?.state === 'running' || controller?.state === 'paused';
  if (!gameIsActive && pendingUploads.length === 0) return;
  event.preventDefault();
  event.returnValue = '';
});

view.elements.closeInstructionsButton.addEventListener('click', () => view.closeInstructions());
view.elements.startTestButton.addEventListener('click', () => startGame('single', 'test'));
view.elements.startSingleButton.addEventListener('click', () => startGame('single', 'formal'));
view.elements.startMultiButton.addEventListener('click', () => startGame('multi', 'formal'));
view.elements.finishTestButton.addEventListener('click', finishTestGame);
view.elements.leaveGameButton.addEventListener('click', leaveGame);
view.elements.nextLevelButton.addEventListener('click', () => {
  view.hideLevelPause();
  controller?.advanceToNextLevel();
});
view.elements.restartButton.addEventListener('click', returnToSetup);
view.elements.retryUploadButton.addEventListener('click', () => { void savePendingResults(); });
createPlayers();

const requestedMode = new URLSearchParams(window.location.search).get('mode')
  ?? sessionStorage.getItem('game_mode');
if (requestedMode === 'single' || requestedMode === 'double') {
  view.elements.startSingleButton.classList.toggle('is-hidden', requestedMode !== 'single');
  view.elements.startMultiButton.classList.toggle('is-hidden', requestedMode !== 'double');
}

if (apiClient.enabled) {
  void Promise.all([apiClient.health(), apiClient.games()]).catch(() => undefined);
}
