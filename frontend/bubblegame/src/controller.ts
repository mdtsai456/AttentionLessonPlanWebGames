import { GameController, PlayerGame } from './game';
import type { GameTimingMode } from './game-types';

export interface ControllerElements {
  timerDisplay: HTMLTimeElement;
  onFinish: () => void;
  onLevelPause?: (level: number) => void;
}

export function createGameController(
  durationSeconds: number,
  players: PlayerGame[],
  elements: ControllerElements,
  timingMode: GameTimingMode = 'test',
  levelCount = 1,
  levelDurationSeconds = durationSeconds,
): GameController {
  return new GameController(
    durationSeconds,
    players,
    (seconds) => {
      const minutes = Math.floor(seconds / 60);
      const remainder = seconds % 60;
      const value = `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
      elements.timerDisplay.textContent = value;
      elements.timerDisplay.dateTime = `PT${Math.max(0, seconds)}S`;
    },
    elements.onFinish,
    undefined,
    timingMode,
    elements.onLevelPause,
    levelCount,
    levelDurationSeconds,
  );
}
