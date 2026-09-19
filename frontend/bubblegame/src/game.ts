import {
  BUBBLE_COUNT,
  DEFAULT_ARROW_IMAGE_INDEX,
  DIRECTIONS,
  POSITION_TRAVEL_TIME_SECONDS,
  REVEAL_DELAY_MS,
  ROUND_DELAY_MS,
} from './game-config';
import {
  browserGameClock,
  mathRandomSource,
  type GameClock,
  type RandomSource,
} from './game-platform';
import { createEmptyPlayerStats, resetPlayerStats } from './statistics';
import type {
  BubbleState,
  Direction,
  GameMode,
  GameState,
  PlayerKeyMap,
  PlayerRenderer,
  PlayerStats,
  GameTimingMode,
} from './game-types';

export type { BubbleState, Direction, GameMode, GameState, GameTimingMode, PlayerKeyMap, PlayerRenderer, PlayerStats } from './game-types';

function randomBetween(random: RandomSource, min: number, max: number): number {
  return random.next() * (max - min) + min;
}

export class PlayerGame {
  readonly stats: PlayerStats = createEmptyPlayerStats();

  private bubbles: BubbleState[] = [];
  private successStreak = 0;
  private roundStartedAt = 0;
  private roundTransitioning = false;
  private revealTimeoutId: number | undefined;
  private roundDelayTimeoutId: number | undefined;
  private arrowImageIndex = DEFAULT_ARROW_IMAGE_INDEX;

  constructor(
    readonly id: 'left' | 'right',
    private readonly renderer: PlayerRenderer,
    private readonly keyMap: PlayerKeyMap,
    private readonly onFeedback: (isCorrect: boolean) => void,
    private readonly clock: GameClock = browserGameClock,
    private readonly random: RandomSource = mathRandomSource,
  ) {}

  reset(): void {
    this.stop();
    resetPlayerStats(this.stats);
    this.successStreak = 0;
    this.arrowImageIndex = DEFAULT_ARROW_IMAGE_INDEX;
  }

  start(): void {
    this.reset();
    this.startRound();
  }

  continueLevel(): void {
    this.stop();
    this.startRound();
  }

  stop(): void {
    if (this.revealTimeoutId !== undefined) this.clock.clearTimeout(this.revealTimeoutId);
    if (this.roundDelayTimeoutId !== undefined) this.clock.clearTimeout(this.roundDelayTimeoutId);
    this.revealTimeoutId = undefined;
    this.roundDelayTimeoutId = undefined;
    this.roundTransitioning = false;
    this.bubbles = [];
    this.renderer.clear();
  }

  update(deltaSeconds: number): void {
    for (const bubble of this.bubbles) {
      bubble.x += bubble.velocityX * deltaSeconds;
      bubble.y += bubble.velocityY * deltaSeconds;
      if (bubble.x <= 0 || bubble.x >= 1) {
        bubble.x = Math.max(0, Math.min(1, bubble.x));
        bubble.velocityX *= -1;
      }
      if (bubble.y <= 0 || bubble.y >= 1) {
        bubble.y = Math.max(0, Math.min(1, bubble.y));
        bubble.velocityY *= -1;
      }
      this.renderer.renderBubble(bubble);
    }
  }

  handleKey(code: string, key = ''): boolean {
    if (this.roundTransitioning || !this.bubbles.some((bubble) => bubble.isRevealed)) return false;
    const normalizedKey = key.length === 1 ? key.toLowerCase() : key;
    const direction = (Object.keys(this.keyMap) as Direction[]).find((item) => {
      const configuredCodes = Array.isArray(this.keyMap[item])
        ? this.keyMap[item]
        : [this.keyMap[item]];
      return configuredCodes.some((configuredCode) => {
        const configuredKey = configuredCode.startsWith('Key')
          ? configuredCode.slice(3).toLowerCase()
          : configuredCode;
        return configuredCode === code || configuredKey === normalizedKey;
      });
    });
    if (!direction) return false;
    const target = this.bubbles.find((bubble) => bubble.isTarget);
    const isCorrect = target?.direction === direction;
    const reactionTime = this.clock.now() - this.roundStartedAt;
    this.stats.totalRounds += 1;
    this.stats.totalReactionTimeMs += reactionTime;
    if (isCorrect) {
      this.stats.score += 1;
      this.successStreak += 1;
      this.stats.maxCombo = Math.max(this.stats.maxCombo, this.successStreak);
      this.stats.correctReactionTimeMs += reactionTime;
      this.arrowImageIndex = this.successStreak >= 5
        ? (this.successStreak - 5) % 3
        : DEFAULT_ARROW_IMAGE_INDEX;
    } else {
      this.successStreak = 0;
      this.arrowImageIndex = DEFAULT_ARROW_IMAGE_INDEX;
    }
    this.onFeedback(isCorrect);
    this.startNextRoundAfterDelay();
    return true;
  }

  getBubbles(): readonly BubbleState[] {
    return this.bubbles;
  }

  private startRound(): void {
    this.renderer.clear();
    this.bubbles = [];
    const targetIndex = Math.floor(this.random.next() * BUBBLE_COUNT);
    for (let index = 0; index < BUBBLE_COUNT; index += 1) {
      const directionX = this.random.next() < 0.5 ? -1 : 1;
      const directionY = this.random.next() < 0.5 ? -1 : 1;
      const bubble: BubbleState = {
        id: index,
        x: randomBetween(this.random, 0, 1),
        y: randomBetween(this.random, 0, 1),
        velocityX: directionX / POSITION_TRAVEL_TIME_SECONDS,
        velocityY: directionY / POSITION_TRAVEL_TIME_SECONDS,
        direction: DIRECTIONS[Math.floor(this.random.next() * DIRECTIONS.length)],
        isTarget: index === targetIndex,
        isRevealed: false,
      };
      this.bubbles.push(bubble);
      this.renderer.createBubble(bubble, this.arrowImageIndex);
    }
    this.revealTimeoutId = this.clock.setTimeout(() => {
      this.bubbles.forEach((bubble) => { bubble.isRevealed = true; });
      this.roundStartedAt = this.clock.now();
      this.renderer.revealBubbles(this.bubbles);
    }, REVEAL_DELAY_MS);
  }

  private startNextRoundAfterDelay(): void {
    if (this.revealTimeoutId !== undefined) this.clock.clearTimeout(this.revealTimeoutId);
    this.revealTimeoutId = undefined;
    this.renderer.clear();
    this.bubbles = [];
    this.roundTransitioning = true;
    this.roundDelayTimeoutId = this.clock.setTimeout(() => {
      this.roundDelayTimeoutId = undefined;
      this.roundTransitioning = false;
      this.startRound();
    }, ROUND_DELAY_MS);
  }
}

export class GameController {
  state: GameState = 'idle';
  secondsRemaining: number;
  currentLevel = 1;
  private timerId: number | undefined;
  private animationFrameId: number | undefined;
  private previousFrameTime = 0;
  private endTime = 0;
  private readonly levelCount: number;
  private readonly levelDurationSeconds: number;

  constructor(
    readonly durationSeconds: number,
    readonly players: PlayerGame[],
    private readonly onTick: (seconds: number) => void,
    private readonly onFinish: () => void,
    private readonly clock: GameClock = browserGameClock,
    private readonly timingMode: GameTimingMode = 'test',
    private readonly onLevelPause: (level: number) => void = () => {},
    levelCount = 1,
    levelDurationSeconds = durationSeconds,
  ) {
    this.secondsRemaining = durationSeconds;
    this.levelCount = levelCount;
    this.levelDurationSeconds = levelDurationSeconds;
  }

  start(): void {
    this.stopControllerResources();
    this.secondsRemaining = this.timingMode === 'formal'
      ? this.levelDurationSeconds
      : this.durationSeconds;
    this.currentLevel = 1;
    this.state = 'running';
    this.players.forEach((player) => player.start());
    this.endTime = this.clock.now() + this.secondsRemaining * 1000;
    this.onTick(this.secondsRemaining);
    this.previousFrameTime = this.clock.now();
    this.timerId = this.clock.setInterval(() => this.tick(), 1000);
    this.animationFrameId = this.clock.requestAnimationFrame((time) => this.animate(time));
  }

  reset(): void {
    this.stopControllerResources();
    this.secondsRemaining = this.timingMode === 'formal'
      ? this.levelDurationSeconds
      : this.durationSeconds;
    this.currentLevel = 1;
    this.state = 'idle';
    this.players.forEach((player) => player.reset());
    this.onTick(this.secondsRemaining);
  }

  finish(): void {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.stopControllerResources();
    this.state = 'finished';
    this.players.forEach((player) => player.stop());
    this.onFinish();
  }

  advanceToNextLevel(): void {
    if (this.state !== 'paused') return;
    if (this.currentLevel >= this.levelCount) {
      this.finish();
      return;
    }
    this.currentLevel += 1;
    this.secondsRemaining = this.levelDurationSeconds;
    this.state = 'running';
    this.players.forEach((player) => player.continueLevel());
    this.endTime = this.clock.now() + this.levelDurationSeconds * 1000;
    this.onTick(this.secondsRemaining);
    this.previousFrameTime = this.clock.now();
    this.timerId = this.clock.setInterval(() => this.tick(), 1000);
    this.animationFrameId = this.clock.requestAnimationFrame((time) => this.animate(time));
  }

  private stopControllerResources(): void {
    if (this.timerId !== undefined) this.clock.clearInterval(this.timerId);
    if (this.animationFrameId !== undefined) this.clock.cancelAnimationFrame(this.animationFrameId);
    this.timerId = undefined;
    this.animationFrameId = undefined;
  }

  private tick(): void {
    this.secondsRemaining = Math.max(0, Math.ceil((this.endTime - this.clock.now()) / 1000));
    this.onTick(this.secondsRemaining);
    if (this.secondsRemaining > 0) return;
    if (this.timingMode === 'formal' && this.currentLevel < this.levelCount) {
      this.stopControllerResources();
      this.players.forEach((player) => player.stop());
      this.state = 'paused';
      this.onLevelPause(this.currentLevel);
      return;
    }
    this.finish();
  }

  private animate(frameTime: number): void {
    if (this.state !== 'running') return;
    const deltaSeconds = Math.min((frameTime - this.previousFrameTime) / 1000, 0.05);
    this.previousFrameTime = frameTime;
    this.players.forEach((player) => {
      player.update(deltaSeconds);
    });
    this.animationFrameId = this.clock.requestAnimationFrame((time) => this.animate(time));
  }
}
