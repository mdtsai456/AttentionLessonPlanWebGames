import type { GameMode, PlayerStats } from './game-types';
import type { SessionPayload } from './api-client';

export interface SessionContext {
  lessonId: string;
  grade: string;
  caseId: string;
  school: string;
  currentDay: number;
}

export interface SessionAdapter {
  getContext(playerIndex?: number): SessionContext | undefined;
}

export class BrowserSessionAdapter implements SessionAdapter {
  constructor(
    private readonly storage: Pick<Storage, 'getItem'> = window.sessionStorage,
    private readonly defaultLessonId = 'web_EFT',
  ) {}

  getContext(playerIndex = 0): SessionContext | undefined {
    const playerNumber = playerIndex + 1;
    const studentKey = this.storage.getItem(`student${playerNumber}_key`)?.trim() ?? '';
    const separator = studentKey.indexOf('_');
    const grade = this.storage.getItem(`student${playerNumber}_grade`)?.trim()
      || (separator > 0 ? studentKey.slice(0, separator).trim() : '');
    const caseId = this.storage.getItem(`student${playerNumber}_case_id`)?.trim()
      || (separator > 0 ? studentKey.slice(separator + 1).trim() : '');
    const school = this.storage.getItem(`student${playerNumber}_school`)?.trim();

    if (!grade || !caseId || !school) return undefined;

    const configuredDay = Number(
      this.storage.getItem('current_day') ?? this.storage.getItem('currentDay') ?? '1',
    );
    const currentDay = Number.isInteger(configuredDay) && configuredDay > 0 ? configuredDay : 1;

    return {
      lessonId: this.storage.getItem('lesson_id')?.trim() || this.defaultLessonId,
      grade,
      caseId,
      school,
      currentDay,
    };
  }
}

export function createSessionPayload(
  context: SessionContext,
  mode: GameMode,
  stats: PlayerStats,
  startTime: number,
  endTime: number,
  gameCode: string,
  pairId?: string,
): SessionPayload {
  const prefix = gameCode;
  return {
    lessonId: context.lessonId,
    data: {
      grade: context.grade,
      caseId: context.caseId,
      school: context.school,
      currentDay: context.currentDay,
      startTime,
      endTime,
      ...(mode === 'multi' ? { mode: 'double' as const, pairId } : {}),
      stats: [
        { apiname: `${prefix}_correct`, value: stats.score },
        { apiname: `${prefix}_wrong`, value: Math.max(0, stats.totalRounds - stats.score) },
        { apiname: `${prefix}_accuracy`, value: stats.totalRounds === 0 ? 0 : stats.score / stats.totalRounds },
        { apiname: `${prefix}_duration`, value: Math.max(0, endTime - startTime) },
        { apiname: `${prefix}_stage`, value: stats.totalRounds },
      ],
    },
  };
}
