export type Direction = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
export type GameMode = 'single' | 'multi';
export type GameTimingMode = 'test' | 'formal';
export type GameState = 'idle' | 'running' | 'paused' | 'finished';

export interface BubbleState {
  id: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  direction: Direction;
  isTarget: boolean;
  isRevealed: boolean;
}

export interface PlayerStats {
  score: number;
  totalRounds: number;
  totalReactionTimeMs: number;
  correctReactionTimeMs: number;
  maxCombo: number;
}

export interface PlayerKeyMap {
  ArrowUp: string | readonly string[];
  ArrowDown: string | readonly string[];
  ArrowLeft: string | readonly string[];
  ArrowRight: string | readonly string[];
}

export interface PlayerRenderer {
  clear(): void;
  createBubble(bubble: BubbleState, arrowImageIndex: number): void;
  renderBubble(bubble: BubbleState): void;
  revealBubbles(bubbles: BubbleState[]): void;
}
