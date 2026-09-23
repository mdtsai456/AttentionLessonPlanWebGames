import type { GameMode } from './game-types';
import {
  calculateAccuracy,
  calculateAverageReactionTime,
  calculateCorrectAverageReactionTime,
} from './statistics';
import type { PlayerStats } from './game-types';

export interface AppElements {
  startScreen: HTMLElement;
  playScreen: HTMLElement;
  startTestButton: HTMLButtonElement;
  startSingleButton: HTMLButtonElement;
  startMultiButton: HTMLButtonElement;
  currentDayInput: HTMLInputElement;
  restartButton: HTMLButtonElement;
  finishTestButton: HTMLButtonElement;
  leaveGameButton: HTMLButtonElement;
  instructionsOverlay: HTMLDivElement;
  closeInstructionsButton: HTMLButtonElement;
  levelOverlay: HTMLDivElement;
  levelTitle: HTMLElement;
  levelMessage: HTMLElement;
  nextLevelButton: HTMLButtonElement;
  timerDisplay: HTMLTimeElement;
  resultOverlay: HTMLDivElement;
  resultUploadStatus: HTMLElement;
  retryUploadButton: HTMLButtonElement;
  leftScoreDisplay: HTMLOutputElement;
  rightScoreDisplay: HTMLOutputElement;
  rightScoreLabel: HTMLElement;
  instructionDisplay: HTMLElement;
  leftFeedback: HTMLElement;
  rightFeedback: HTMLElement;
  leftArena: HTMLElement;
  rightArena: HTMLElement;
  rightResult: HTMLElement;
  rightPlayerPanel: HTMLElement;
  resultsGrid: HTMLElement;
  leftResultTitle: HTMLElement;
  rightResultTitle: HTMLElement;
  resultElements: Record<'left' | 'right', ResultElements>;
}

interface ResultElements {
  finalScore: HTMLOutputElement;
  accuracy: HTMLElement;
  averageReaction: HTMLElement;
  correctAverageReaction: HTMLElement;
  maxCombo: HTMLElement;
}

type PlayerId = 'left' | 'right';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function formatReactionTime(milliseconds: number | undefined): string {
  return milliseconds === undefined ? '--' : `${(milliseconds / 1000).toFixed(2)} 秒`;
}

function resultElements(id: PlayerId): ResultElements {
  return {
    finalScore: requiredElement<HTMLOutputElement>(`#${id}-final-score`),
    accuracy: requiredElement<HTMLElement>(`#${id}-accuracy-display`),
    averageReaction: requiredElement<HTMLElement>(`#${id}-average-reaction-display`),
    correctAverageReaction: requiredElement<HTMLElement>(`#${id}-correct-reaction-display`),
    maxCombo: requiredElement<HTMLElement>(`#${id}-max-combo-display`),
  };
}

export function createAppElements(): AppElements {
  return {
    startScreen: requiredElement<HTMLElement>('#start-screen'),
    playScreen: requiredElement<HTMLElement>('#play-screen'),
    startTestButton: requiredElement<HTMLButtonElement>('#start-test-button'),
    startSingleButton: requiredElement<HTMLButtonElement>('#start-single-button'),
    startMultiButton: requiredElement<HTMLButtonElement>('#start-multi-button'),
    currentDayInput: requiredElement<HTMLInputElement>('#current-day-input'),
    restartButton: requiredElement<HTMLButtonElement>('#restart-button'),
    finishTestButton: requiredElement<HTMLButtonElement>('#finish-test-button'),
    leaveGameButton: requiredElement<HTMLButtonElement>('#leave-game-button'),
    instructionsOverlay: requiredElement<HTMLDivElement>('#instructions-overlay'),
    closeInstructionsButton: requiredElement<HTMLButtonElement>('#close-instructions-button'),
    levelOverlay: requiredElement<HTMLDivElement>('#level-overlay'),
    levelTitle: requiredElement<HTMLElement>('#level-title'),
    levelMessage: requiredElement<HTMLElement>('#level-message'),
    nextLevelButton: requiredElement<HTMLButtonElement>('#next-level-button'),
    timerDisplay: requiredElement<HTMLTimeElement>('#timer-display'),
    resultOverlay: requiredElement<HTMLDivElement>('#result-overlay'),
    resultUploadStatus: requiredElement<HTMLElement>('#result-upload-status'),
    retryUploadButton: requiredElement<HTMLButtonElement>('#retry-upload-button'),
    leftScoreDisplay: requiredElement<HTMLOutputElement>('#left-score-display'),
    rightScoreDisplay: requiredElement<HTMLOutputElement>('#right-score-display'),
    rightScoreLabel: requiredElement<HTMLElement>('#right-score-label'),
    instructionDisplay: requiredElement<HTMLElement>('#instruction-display'),
    leftFeedback: requiredElement<HTMLElement>('#left-feedback'),
    rightFeedback: requiredElement<HTMLElement>('#right-feedback'),
    leftArena: requiredElement<HTMLElement>('#left-arena'),
    rightArena: requiredElement<HTMLElement>('#right-arena'),
    rightResult: requiredElement<HTMLElement>('#right-result'),
    rightPlayerPanel: requiredElement<HTMLElement>('.player-panel--right'),
    resultsGrid: requiredElement<HTMLElement>('.results-grid'),
    leftResultTitle: requiredElement<HTMLElement>('#left-result-title'),
    rightResultTitle: requiredElement<HTMLElement>('#right-result-title'),
    resultElements: {
      left: resultElements('left'),
      right: resultElements('right'),
    },
  };
}

export class GameView {
  private readonly feedbackTimeoutIds: Partial<Record<PlayerId, number>> = {};

  constructor(readonly elements: AppElements) {}

  closeInstructions(): void {
    this.elements.instructionsOverlay.classList.add('is-hidden');
    this.elements.startTestButton.focus();
  }

  showLevelPause(level: number, message = '準備進入下一關。'): void {
    this.elements.levelTitle.textContent = `第 ${level} 關完成`;
    this.elements.levelMessage.textContent = message;
    this.elements.levelOverlay.classList.remove('is-hidden');
    this.elements.nextLevelButton.focus();
  }

  hideLevelPause(): void {
    this.elements.levelOverlay.classList.add('is-hidden');
  }

  showPlay(mode: GameMode): void {
    const isSingle = mode === 'single';
    this.elements.rightResult.classList.toggle('is-hidden', isSingle);
    this.elements.rightPlayerPanel.classList.toggle('is-hidden', isSingle);
    this.elements.playScreen.classList.toggle('play-screen--single', isSingle);
    this.elements.startScreen.classList.add('is-hidden');
    this.elements.playScreen.classList.remove('is-hidden');
    this.elements.resultOverlay.classList.add('is-hidden');
    this.elements.resultsGrid.classList.remove('results-grid--single');
    this.elements.instructionDisplay.textContent = isSingle
      ? '操作：WASD 或方向鍵'
      : '左側：WASD 或方向鍵；右側：方向鍵';
    this.elements.rightScoreLabel.textContent = isSingle ? '分數' : '右側分數';
  }

  setEarlyFinishVisible(isVisible: boolean): void {
    this.elements.finishTestButton.classList.toggle('is-hidden', !isVisible);
  }

  setResultUploadStatus(message: string, state: 'pending' | 'success' | 'error'): void {
    this.elements.resultUploadStatus.textContent = message;
    this.elements.resultUploadStatus.dataset.state = state;
  }

  getCurrentDay(): number | undefined {
    const value = Number(this.elements.currentDayInput.value);
    if (!this.elements.currentDayInput.checkValidity() || !Number.isInteger(value) || value < 1) {
      this.elements.currentDayInput.reportValidity();
      return undefined;
    }
    return value;
  }

  setUploadBusy(isBusy: boolean): void {
    this.elements.restartButton.disabled = isBusy;
    this.elements.retryUploadButton.disabled = isBusy;
  }

  setRetryUploadVisible(isVisible: boolean): void {
    this.elements.retryUploadButton.classList.toggle('is-hidden', !isVisible);
  }

  showSetup(): void {
    this.elements.resultOverlay.classList.add('is-hidden');
    this.hideLevelPause();
    this.setEarlyFinishVisible(false);
    this.elements.playScreen.classList.add('is-hidden');
    this.elements.playScreen.classList.remove('play-screen--single');
    this.elements.startScreen.classList.remove('is-hidden');
    this.elements.startSingleButton.focus();
  }

  updateScores(leftScore: number, rightScore: number): void {
    this.elements.leftScoreDisplay.value = String(leftScore);
    this.elements.rightScoreDisplay.value = String(rightScore);
  }

  showFeedback(playerId: PlayerId, isCorrect: boolean): void {
    const element = playerId === 'left' ? this.elements.leftFeedback : this.elements.rightFeedback;
    const previousTimeout = this.feedbackTimeoutIds[playerId];
    if (previousTimeout !== undefined) window.clearTimeout(previousTimeout);
    element.textContent = isCorrect ? '正確' : '錯誤';
    element.className = `player-feedback ${isCorrect ? 'player-feedback--correct' : 'player-feedback--incorrect'}`;
    this.feedbackTimeoutIds[playerId] = window.setTimeout(() => {
      element.textContent = '';
      element.className = 'player-feedback';
    }, 800);
  }

  showResults(mode: GameMode, players: readonly { stats: PlayerStats }[]): void {
    this.renderPlayerResult('left', players[0].stats);
    this.renderPlayerResult('right', players[1].stats);
    const isSingle = mode === 'single';
    this.elements.rightResult.classList.toggle('is-hidden', isSingle);
    this.elements.resultsGrid.classList.toggle('results-grid--single', isSingle);
    this.elements.leftResultTitle.textContent = isSingle ? '玩家' : '左側玩家';
    this.elements.rightResultTitle.textContent = '右側玩家';
    this.elements.resultOverlay.classList.remove('is-hidden');
    this.elements.restartButton.focus();
  }

  private renderPlayerResult(id: PlayerId, stats: PlayerStats): void {
    const elements = this.elements.resultElements[id];
    elements.finalScore.value = String(stats.score);
    elements.accuracy.textContent = `${(calculateAccuracy(stats) * 100).toFixed(1)}%`;
    elements.averageReaction.textContent = formatReactionTime(calculateAverageReactionTime(stats));
    elements.correctAverageReaction.textContent = formatReactionTime(calculateCorrectAverageReactionTime(stats));
    elements.maxCombo.textContent = String(stats.maxCombo);
  }
}
