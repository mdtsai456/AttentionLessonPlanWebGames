import { describe, expect, it } from 'vitest';
import { GameController, PlayerGame } from './game';
import type { GameClock, RandomSource } from './game-platform';
import type { BubbleState, PlayerRenderer } from './game-types';
import { createMockQuestionProvider } from './question-bank';
import {
  calculateAccuracy,
  calculateAverageReactionTime,
  calculateCorrectAverageReactionTime,
  createEmptyPlayerStats,
} from './statistics';

class TestRenderer implements PlayerRenderer {
  bubbles: BubbleState[] = [];

  clear(): void {
    this.bubbles = [];
  }

  createBubble(bubble: BubbleState): void {
    this.bubbles.push(bubble);
  }

  renderBubble(): void {}

  revealBubbles(): void {}
}

class TestClock implements GameClock {
  currentTime = 1000;
  intervalCallback: (() => void) | undefined;
  timeoutCallback: (() => void) | undefined;
  private nextId = 1;

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void): number {
    this.timeoutCallback = callback;
    return this.nextId++;
  }

  clearTimeout(): void {}

  setInterval(callback: () => void): number {
    this.intervalCallback = callback;
    return this.nextId++;
  }

  clearInterval(): void {}

  requestAnimationFrame(): number {
    return this.nextId++;
  }

  cancelAnimationFrame(): void {}

  tickInterval(): void {
    this.intervalCallback?.();
  }

  triggerTimeout(): void {
    const callback = this.timeoutCallback;
    this.timeoutCallback = undefined;
    callback?.();
  }
}

const fixedRandom: RandomSource = { next: () => 0 };

function createTestPlayer(onFeedback: (isCorrect: boolean) => void = (): void => {}): { player: PlayerGame; clock: TestClock; renderer: TestRenderer } {
  const clock = new TestClock();
  const renderer = new TestRenderer();
  const player = new PlayerGame(
    'left',
    renderer,
    { ArrowUp: 'KeyW', ArrowDown: 'KeyS', ArrowLeft: 'KeyA', ArrowRight: 'KeyD' },
    onFeedback,
    clock,
    fixedRandom,
  );
  return { player, clock, renderer };
}

describe('statistics', () => {
  it('calculates accuracy and reaction time averages', () => {
    const stats = createEmptyPlayerStats();
    stats.score = 3;
    stats.totalRounds = 4;
    stats.totalReactionTimeMs = 2000;
    stats.correctReactionTimeMs = 1200;

    expect(calculateAccuracy(stats)).toBe(0.75);
    expect(calculateAverageReactionTime(stats)).toBe(500);
    expect(calculateCorrectAverageReactionTime(stats)).toBe(400);
  });

  it('returns undefined averages without attempts', () => {
    const stats = createEmptyPlayerStats();

    expect(calculateAverageReactionTime(stats)).toBeUndefined();
    expect(calculateCorrectAverageReactionTime(stats)).toBeUndefined();
  });
});

describe('question bank', () => {
  it('pauses when the question list is exhausted by default', () => {
    const provider = createMockQuestionProvider([{ direction: 'ArrowUp' }]);

    expect(provider.next()?.direction).toBe('ArrowUp');
    expect(provider.next()).toBeUndefined();
  });

  it('cycles questions when the cycle strategy is selected', () => {
    const provider = createMockQuestionProvider(
      [{ direction: 'ArrowLeft' }, { direction: 'ArrowRight' }],
      'cycle',
    );

    expect(provider.next()?.direction).toBe('ArrowLeft');
    expect(provider.next()?.direction).toBe('ArrowRight');
    expect(provider.next()?.direction).toBe('ArrowLeft');
  });
});

describe('PlayerGame', () => {
  it('accepts input only after the bubbles reveal and starts timing then', () => {
    const { player, clock } = createTestPlayer();
    player.start();
    clock.currentTime = 1250;

    expect(player.handleKey('KeyW', 'w')).toBe(false);
    expect(player.stats.totalRounds).toBe(0);

    clock.currentTime = 2000;
    clock.triggerTimeout();
    clock.currentTime = 2250;

    expect(player.handleKey('KeyW', 'w')).toBe(true);
    expect(player.stats.totalRounds).toBe(1);
    expect(player.stats.totalReactionTimeMs).toBe(250);
  });

  it('accepts arrow key codes in the player key map', () => {
    const clock = new TestClock();
    const renderer = new TestRenderer();
    const player = new PlayerGame(
      'left',
      renderer,
      {
        ArrowUp: ['KeyW', 'ArrowUp'],
        ArrowDown: ['KeyS', 'ArrowDown'],
        ArrowLeft: ['KeyA', 'ArrowLeft'],
        ArrowRight: ['KeyD', 'ArrowRight'],
      },
      () => {},
      clock,
      fixedRandom,
    );

    player.start();
    clock.currentTime = 2000;
    clock.triggerTimeout();
    clock.currentTime = 2250;

    expect(player.handleKey('ArrowUp')).toBe(true);
    expect(player.stats.totalRounds).toBe(1);
  });

  it('records a correct answer and starts a transition', () => {
    const feedback: boolean[] = [];
    const { player, clock } = createTestPlayer((isCorrect) => feedback.push(isCorrect));
    player.start();
    clock.currentTime = 2000;
    clock.triggerTimeout();
    clock.currentTime = 2250;

    expect(player.handleKey('KeyW', 'w')).toBe(true);
    expect(player.stats.score).toBe(1);
    expect(player.stats.totalRounds).toBe(1);
    expect(player.stats.totalReactionTimeMs).toBe(250);
    expect(player.stats.correctReactionTimeMs).toBe(250);
    expect(feedback).toEqual([true]);
    expect(player.handleKey('KeyW', 'w')).toBe(false);
  });

  it('records an incorrect answer and resets the streak', () => {
    const feedback: boolean[] = [];
    const { player, clock } = createTestPlayer((isCorrect) => feedback.push(isCorrect));
    player.start();
    clock.currentTime = 2000;
    clock.triggerTimeout();
    clock.currentTime = 2400;

    expect(player.handleKey('KeyS', 's')).toBe(true);
    expect(player.stats.score).toBe(0);
    expect(player.stats.totalRounds).toBe(1);
    expect(player.stats.totalReactionTimeMs).toBe(400);
    expect(player.stats.correctReactionTimeMs).toBe(0);
    expect(player.stats.maxCombo).toBe(0);
    expect(feedback).toEqual([false]);
  });
});

describe('GameController', () => {
  it('calculates remaining time from the clock and finishes once', () => {
    const { player, clock } = createTestPlayer();
    const ticks: number[] = [];
    let finishCount = 0;
    const controller = new GameController(
      3,
      [player],
      (seconds) => ticks.push(seconds),
      () => { finishCount += 1; },
      clock,
    );

    controller.start();
    expect(controller.state).toBe('running');
    expect(ticks).toEqual([3]);

    clock.currentTime = 2500;
    clock.tickInterval();
    expect(controller.secondsRemaining).toBe(2);

    clock.currentTime = 4000;
    clock.tickInterval();
    expect(controller.state).toBe('finished');
    expect(controller.secondsRemaining).toBe(0);
    expect(finishCount).toBe(1);

    controller.finish();
    expect(finishCount).toBe(1);
  });

  it('resets to idle and restores the full duration', () => {
    const { player, clock } = createTestPlayer();
    const controller = new GameController(3, [player], () => {}, () => {}, clock);

    controller.start();
    controller.reset();

    expect(controller.state).toBe('idle');
    expect(controller.secondsRemaining).toBe(3);
    expect(player.stats.totalRounds).toBe(0);
  });

  it('pauses between formal levels and resumes without resetting scores', () => {
    const { player, clock } = createTestPlayer();
    let pauseLevel = 0;
    let finishCount = 0;
    const controller = new GameController(
      120,
      [player],
      () => {},
      () => { finishCount += 1; },
      clock,
      'formal',
      (level) => { pauseLevel = level; },
      2,
      60,
    );

    controller.start();
    player.stats.score = 4;
    clock.currentTime = 121000;
    clock.tickInterval();

    expect(controller.state).toBe('paused');
    expect(controller.currentLevel).toBe(1);
    expect(pauseLevel).toBe(1);
    expect(player.stats.score).toBe(4);

    controller.advanceToNextLevel();

    expect(controller.state).toBe('running');
    expect(controller.currentLevel).toBe(2);
    expect(controller.secondsRemaining).toBe(60);
    expect(player.stats.score).toBe(4);

    clock.currentTime = 181000;
    clock.tickInterval();
    expect(controller.state).toBe('finished');
    expect(finishCount).toBe(1);
  });
});
