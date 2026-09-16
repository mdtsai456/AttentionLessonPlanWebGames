export function studentFromStorage(storage, playerNumber) {
  const prefix = `student${playerNumber}_`;
  const studentKey = (storage.getItem(`${prefix}key`) || '').trim();
  const school = (storage.getItem(`${prefix}school`) || '').trim();
  const separator = studentKey.indexOf('_');
  const grade = (storage.getItem(`${prefix}grade`) || studentKey.slice(0, separator)).trim();
  const caseId = (storage.getItem(`${prefix}case_id`) || studentKey.slice(separator + 1)).trim();
  if (!studentKey || !school || separator < 1 || !grade || !caseId) return null;
  return { studentKey, grade, caseId, school };
}

export function buildSessionPayload({ student, stats, mode, pairId, currentDay, startTime, endTime }) {
  const correct = Number(stats?.score);
  const stage = Number(stats?.totalRounds);
  if (!student || !Number.isInteger(correct) || !Number.isInteger(stage) || correct < 0 || stage < correct) {
    throw new Error('遊戲統計資料不完整');
  }
  if (!Number.isInteger(currentDay) || currentDay < 1 || !Number.isFinite(startTime) || endTime < startTime) {
    throw new Error('施測日或時間資料無效');
  }
  if (mode === 'double' && !pairId) throw new Error('雙人場次編號無效');

  return {
    lessonId: 'bubblegame_EFT',
    data: {
      grade: student.grade,
      caseId: student.caseId,
      school: student.school,
      currentDay,
      startTime,
      endTime,
      mode,
      ...(mode === 'double' ? { pairId } : {}),
      stats: [
        { apiname: 'EFT_correct', value: correct },
        { apiname: 'EFT_wrong', value: stage - correct },
        { apiname: 'EFT_accuracy', value: stage ? correct / stage : 0 },
        { apiname: 'EFT_duration', value: endTime - startTime },
        { apiname: 'EFT_stage', value: stage },
      ],
    },
  };
}
