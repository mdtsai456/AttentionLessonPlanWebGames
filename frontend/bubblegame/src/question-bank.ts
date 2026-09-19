import type { Direction } from './game-types';

export type QuestionExhaustionStrategy = 'pause-on-empty' | 'cycle';

export interface Question {
  direction: Direction;
}

export interface QuestionProvider {
  next(): Question | undefined;
  reset(): void;
}

export class MockQuestionProvider implements QuestionProvider {
  private index = 0;

  constructor(
    private readonly questions: readonly Question[],
    private readonly exhaustionStrategy: QuestionExhaustionStrategy = 'pause-on-empty',
  ) {}

  next(): Question | undefined {
    if (this.questions.length === 0) return undefined;
    if (this.index >= this.questions.length) {
      if (this.exhaustionStrategy === 'pause-on-empty') return undefined;
      this.index = 0;
    }
    const question = this.questions[this.index];
    this.index += 1;
    return question;
  }

  reset(): void {
    this.index = 0;
  }
}

export function createMockQuestionProvider(
  questions: readonly Question[],
  exhaustionStrategy: QuestionExhaustionStrategy = 'pause-on-empty',
): QuestionProvider {
  return new MockQuestionProvider(questions, exhaustionStrategy);
}
