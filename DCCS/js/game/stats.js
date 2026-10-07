// 統計彙整（SPEC 4.11）。level 是關卡序號；同一題兩列共用 trialIndex。
// correct_count／accuracy 以題為單位（兩道閥都對才算對）；分項計數以閥為單位。
// duration 只來自 setDuration() 的模擬遊玩時間；本模組不碰牆上時鐘，
// 以免分頁切走的時間被算進這個理應為常數的欄位。

export function createStats() {
  const rows = [];
  const trials = [];
  let durationMs = 0;

  function record({
    trialIndex,
    level,
    optionCount,
    valveKind,
    rule,
    targetId,
    answerId,
    correct,
    settleMs,
    firstInputMs,
    slotsRotated,
  }) {
    rows.push({
      trialIndex,
      level,
      optionCount,
      valveKind,
      rule,
      targetId,
      answerId,
      correct: !!correct,
      settleMs,
      firstInputMs,
      slotsRotated,
    });
  }

  /** 一題兩道閥都判定完後呼叫一次；correct 表示整題都對。 */
  function recordTrial({ trialIndex, level, correct }) {
    trials.push({ trialIndex, level, correct: !!correct });
  }

  function summary() {
    let frameCorrectCount = 0;
    let frameWrongCount = 0;
    let categoryCorrectCount = 0;
    let categoryWrongCount = 0;
    let modelCorrectCount = 0;
    let modelWrongCount = 0;
    const levelsSeen = new Set();

    for (const row of rows) {
      levelsSeen.add(row.level);
      if (row.rule === 'frame') {
        if (row.correct) frameCorrectCount++;
        else frameWrongCount++;
      } else if (row.rule === 'category') {
        if (row.correct) categoryCorrectCount++;
        else categoryWrongCount++;
      } else if (row.rule === 'model') {
        if (row.correct) modelCorrectCount++;
        else modelWrongCount++;
      }
    }

    const correct_count = trials.filter((trial) => trial.correct).length;
    const wrong_count = trials.length - correct_count;
    const denom = trials.length;
    const accuracy = denom === 0 ? 0 : correct_count / denom;
    const levels = Array.from(levelsSeen).sort((a, b) => a - b);
    const byLevel = new Map();
    for (const trial of trials) {
      const bucket = byLevel.get(trial.level) || { correct: 0, total: 0 };
      bucket.total += 1;
      if (trial.correct) bucket.correct += 1;
      byLevel.set(trial.level, bucket);
    }
    const levelAccuracy = [];
    for (let level = 1; level <= 6; level += 1) {
      const bucket = byLevel.get(level);
      if (!bucket || bucket.total === 0) break;
      levelAccuracy.push(bucket.correct / bucket.total);
    }
    const stage = levels.length === 0 ? 0 : levels[levels.length - 1];
    const levelsPlayed = levels.join(',');
    const reactionSamples = rows
      .map((row) => row.firstInputMs)
      .filter((value) => Number.isFinite(value));
    const avgReactionMs = reactionSamples.length
      ? reactionSamples.reduce((sum, value) => sum + value, 0) / reactionSamples.length
      : null;

    return {
      frameCorrectCount,
      frameWrongCount,
      categoryCorrectCount,
      categoryWrongCount,
      modelCorrectCount,
      modelWrongCount,
      correct_count,
      wrong_count,
      accuracy,
      duration: durationMs,
      stage,
      levelsPlayed,
      levelAccuracy,
      avgReactionMs,
      questionCount: denom,
    };
  }

  /** 設定模擬遊玩時間（毫秒）；未呼叫時 duration 為 0。 */
  function setDuration(ms) {
    durationMs = Math.round(ms);
  }

  return {
    record,
    recordTrial,
    rows: () => rows.slice(),
    trials: () => trials.slice(),
    summary,
    setDuration,
  };
}
