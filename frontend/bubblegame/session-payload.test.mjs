import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionPayload, studentFromStorage } from './session-payload.mjs';

const storage = new Map([
  ['student1_key', 'G1_S03'],
  ['student1_school', 'KMU'],
  ['student2_key', 'G2_S04'],
  ['student2_school', 'NTHU-01'],
  ['student2_grade', 'G2'],
  ['student2_case_id', 'S04'],
]);
const sessionStorage = { getItem: (key) => storage.get(key) ?? null };

test('uses login identity and builds the five required EFT statistics', () => {
  const student = studentFromStorage(sessionStorage, 1);
  const payload = buildSessionPayload({
    student,
    stats: { score: 3, totalRounds: 5 },
    mode: 'single',
    currentDay: 2,
    startTime: 1789000000000,
    endTime: 1789000060000,
  });

  assert.deepEqual(student, { studentKey: 'G1_S03', grade: 'G1', caseId: 'S03', school: 'KMU' });
  assert.equal(payload.lessonId, 'bubblegame_EFT');
  assert.equal(payload.data.mode, 'single');
  assert.equal(payload.data.pairId, undefined);
  assert.deepEqual(payload.data.stats, [
    { apiname: 'EFT_correct', value: 3 },
    { apiname: 'EFT_wrong', value: 2 },
    { apiname: 'EFT_accuracy', value: 0.6 },
    { apiname: 'EFT_duration', value: 60000 },
    { apiname: 'EFT_stage', value: 5 },
  ]);
});

test('double player payloads keep their own identity and share a pair ID', () => {
  const pairId = '6f1c8e2a-3b7d-4e11-9a52-0c9d7f2b1e44';
  const base = { stats: { score: 0, totalRounds: 0 }, mode: 'double', pairId, currentDay: 1, startTime: 1789000000000, endTime: 1789000001000 };
  const first = buildSessionPayload({ ...base, student: studentFromStorage(sessionStorage, 1) });
  const second = buildSessionPayload({ ...base, student: studentFromStorage(sessionStorage, 2) });

  assert.equal(first.data.pairId, second.data.pairId);
  assert.equal(first.data.school, 'KMU');
  assert.equal(second.data.school, 'NTHU-01');
  assert.equal(second.data.stats.find((item) => item.apiname === 'EFT_accuracy').value, 0);
});

test('rejects missing identity and impossible score counts', () => {
  assert.equal(studentFromStorage({ getItem: () => null }, 1), null);
  assert.throws(() => buildSessionPayload({
    student: studentFromStorage(sessionStorage, 1),
    stats: { score: 4, totalRounds: 3 },
    mode: 'single', currentDay: 1, startTime: 1, endTime: 2,
  }));
});
