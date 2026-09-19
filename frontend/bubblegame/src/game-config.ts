import type { Direction } from './game-types';

export const DIRECTIONS: readonly Direction[] = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
export const BUBBLE_COUNT = 4;
export const POSITION_TRAVEL_TIME_SECONDS = 5;
export const REVEAL_DELAY_MS = 1000;
export const ROUND_DELAY_MS = 1000;
export const ARROW_IMAGE_COUNT = 4;
export const DEFAULT_ARROW_IMAGE_INDEX = ARROW_IMAGE_COUNT - 1;
export const TEST_DURATION_SECONDS = 60;
export const FORMAL_LEVEL_COUNT = 10;
export const FORMAL_LEVEL_DURATION_SECONDS = 60;
