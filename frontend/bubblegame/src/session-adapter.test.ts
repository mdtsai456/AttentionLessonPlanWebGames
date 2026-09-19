import { describe, expect, it } from 'vitest';
import { BrowserSessionAdapter, createSessionPayload } from './session-adapter';
import { createEmptyPlayerStats } from './statistics';

function storage(values: Record<string, string>): Pick<Storage, 'getItem'> {
  return { getItem: (key) => values[key] ?? null };
}

describe('BrowserSessionAdapter', () => {
  it('maps the two logged-in students to the matching player', () => {
    const adapter = new BrowserSessionAdapter(storage({
      student1_grade: 'G1', student1_case_id: 'S01', student1_school: 'KMU',
      student2_grade: 'G2', student2_case_id: 'S02', student2_school: 'NTHU-01',
      current_day: '3',
    }));

    expect(adapter.getContext(0)).toEqual({
      lessonId: 'web_EFT', grade: 'G1', caseId: 'S01', school: 'KMU', currentDay: 3,
    });
    expect(adapter.getContext(1)).toEqual({
      lessonId: 'web_EFT', grade: 'G2', caseId: 'S02', school: 'NTHU-01', currentDay: 3,
    });
  });

  it('does not create a context when login identity is incomplete', () => {
    const adapter = new BrowserSessionAdapter(storage({ student1_grade: 'G1' }));
    expect(adapter.getContext()).toBeUndefined();
  });

  it('falls back to the composite student key used by older login sessions', () => {
    const adapter = new BrowserSessionAdapter(storage({
      student1_key: 'G3_S09', student1_school: 'KMU',
    }));
    expect(adapter.getContext()).toMatchObject({ grade: 'G3', caseId: 'S09', school: 'KMU' });
  });
});

describe('createSessionPayload', () => {
  it('creates an EFT payload accepted by the backend contract', () => {
    const stats = createEmptyPlayerStats();
    stats.score = 4;
    stats.totalRounds = 5;

    const payload = createSessionPayload(
      { lessonId: 'web_EFT', grade: 'G1', caseId: 'S01', school: 'KMU', currentDay: 2 },
      'single', stats, 1000, 4000, 'EFT',
    );

    expect(payload.data.stats).toEqual([
      { apiname: 'EFT_correct', value: 4 },
      { apiname: 'EFT_wrong', value: 1 },
      { apiname: 'EFT_accuracy', value: 0.8 },
      { apiname: 'EFT_duration', value: 3000 },
      { apiname: 'EFT_stage', value: 5 },
    ]);
  });
});
