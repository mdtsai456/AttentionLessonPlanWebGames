// 統計彙整（SPEC 4.11）。level 是關卡序號；同一題兩列共用 trialIndex。
// correct_count／accuracy 以題為單位。兩道閥皆答對才算答對。分項計數以閥為單位。
// duration 僅使用 setDuration() 設定的模擬遊玩時間，不使用實際時間，
// 避免將離開分頁的時間計入固定的遊玩時長。

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

  /** 每題的兩道閥皆判定完成後，呼叫一次。correct 表示整題答對。 */
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
