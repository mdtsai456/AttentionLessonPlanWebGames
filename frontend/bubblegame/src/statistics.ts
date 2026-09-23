import type { PlayerStats } from './game-types';

export function createEmptyPlayerStats(): PlayerStats {
  return {
    score: 0,
    totalRounds: 0,
    totalReactionTimeMs: 0,
    correctReactionTimeMs: 0,
    maxCombo: 0,
  };
}

export function resetPlayerStats(stats: PlayerStats): void {
  stats.score = 0;
  stats.totalRounds = 0;
  stats.totalReactionTimeMs = 0;
  stats.correctReactionTimeMs = 0;
  stats.maxCombo = 0;
}

export function calculateAccuracy(stats: PlayerStats): number {
  return stats.totalRounds === 0 ? 0 : stats.score / stats.totalRounds;
}

export function calculateAverageReactionTime(stats: PlayerStats): number | undefined {
  return stats.totalRounds === 0 ? undefined : stats.totalReactionTimeMs / stats.totalRounds;
}

export function calculateCorrectAverageReactionTime(stats: PlayerStats): number | undefined {
  return stats.score === 0 ? undefined : stats.correctReactionTimeMs / stats.score;
}
