// 每關 60 秒、共 6 關。時間內答完就繼續出題；單題 10 秒沒答算錯並換下一題。
const STAGE_COUNT = 6;
const STAGE_MS = 60_000;
const ANSWER_LIMIT_MS = 10_000;
const MID_STAGE = 3;
const FEEDBACK_MS = 1100;
const TARGET_MS = 1000;
const styles = [
  { normal: 6122, opposite: 6118 },
  { normal: 6130, opposite: 6126 },
  { normal: 6138, opposite: 6134 },
  { normal: 6146, opposite: 6142 }
];
function createPlayer(element, keyBindings, playerIndex) {
  const $ = (id) => element.querySelector(`[data-ui="${id}"]`);
  const buttons = [...element.querySelectorAll('[data-direction]')];
  const panel = element.querySelector('.answer-panel');
  let question = null, index = 0, score = 0, phase = 'intro', timer, startTimeMs = Date.now();
  let outcomes = [], reactionSamples = [], answerStartedAt = 0;
  let stage = 1, stageQuestion = 0, stageStartedAt = 0, stageOutcomes = [], levelAccuracies = [];
  const pick = (items) => items[Math.floor(Math.random() * items.length)];
  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
  function asset(style, direction, opposite) {
    const number = styles[style][opposite ? 'opposite' : 'normal'] + (direction === 'left' ? 2 : 3);
    return `assets/${opposite ? 'opposite_arrow' : 'arrow'}/IMG_${number}.PNG`;
  }
  function setEnabled(enabled) { buttons.forEach((button) => { button.disabled = !enabled; }); }
  function stageRemaining() {
    return stageStartedAt ? STAGE_MS - (Date.now() - stageStartedAt) : STAGE_MS;
  }
  function updateProgress() {
    const used = stageStartedAt ? Math.min(STAGE_MS, Date.now() - stageStartedAt) : 0;
    const ratio = ((stage - 1) + used / STAGE_MS) / STAGE_COUNT;
    $('progress-fill').style.height = `${Math.min(100, ratio * 100)}%`;
    element.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', index);
    const secondsLeft = Math.max(0, Math.ceil(stageRemaining() / 1000));
    $('round').textContent = `第 ${stageQuestion} 題・剩餘 ${secondsLeft} 秒（第 ${stage} / ${STAGE_COUNT} 關）`;
  }
  let clockId = 0;
  function startStageClock() {
    clearInterval(clockId);
    clockId = setInterval(() => {
      if (phase === 'break' || phase === 'stage_clear' || phase === 'finished') return;
      updateProgress();
    }, 200);
  }
  function stopStageClock() {
    clearInterval(clockId);
  }
  function makeQuestion() {
    return {
      direction: Math.random() < 0.5 ? 'right' : 'left',
      opposite: Math.random() < 0.5,
      style: Math.floor(Math.random() * styles.length),
    };
  }
  function renderQuestion() {
    clearTimeout(timer);
    if (stageRemaining() <= 0) {
      endStage();
      return;
    }
    phase = 'memory';
    setEnabled(false);
    delete panel.dataset.result;
    $('feedback').textContent = '記住黃色泡泡的位置';
    stageQuestion += 1;
    question = makeQuestion();
    updateProgress();
    const field = $('bubble-field');
    field.replaceChildren();
    const positions = shuffle([{ x: 10, y: 36 }, { x: 40, y: 3 }, { x: 72, y: 43 }]);
    function createBubble(position, src, alt) {
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.style.left = `${position.x}%`;
      bubble.style.top = `${position.y}%`;
      const image = document.createElement('img');
      image.src = src; image.alt = alt; image.draggable = false;
      bubble.append(image);
      field.append(bubble);
    }
    createBubble(positions[0], 'assets/arrow/目標泡泡.png', '黃色目標泡泡');
    for (let i = 1; i < positions.length; i++) {
      createBubble(positions[i], 'assets/arrow/空泡泡.png', '空泡泡');
    }
    const memoryMs = Math.min(TARGET_MS, Math.max(0, stageRemaining()));
    timer = setTimeout(() => {
      if (phase !== 'memory') return;
      if (stageRemaining() <= 0) {
        missQuestion('本關時間到，這題算錯');
        return;
      }
      field.replaceChildren();
      for (let i = 0; i < 3; i++) {
        const direction = i === 0 ? question.direction : pick(['left', 'right']);
        const style = i === 0 ? question.style : Math.floor(Math.random() * styles.length);
        createBubble(positions[i], asset(style, direction, question.opposite),
          `泡泡：${question.opposite ? '紅色虛線，' : ''}箭頭向${direction === 'left' ? '左' : '右'}`);
      }
      phase = 'answer';
      answerStartedAt = Date.now();
      $('feedback').textContent = '回答剛才位置的泡泡';
      setEnabled(true);
      const wait = Math.min(ANSWER_LIMIT_MS, Math.max(0, stageRemaining()));
      const timeoutMessage = stageRemaining() <= ANSWER_LIMIT_MS
        ? '本關時間到，這題算錯'
        : '10 秒未作答，這題算錯';
      timer = setTimeout(() => missQuestion(timeoutMessage), wait);
    }, memoryMs);
  }
  function beginStage(nextStage) {
    stage = nextStage;
    stageQuestion = 0;
    stageOutcomes = [];
    stageStartedAt = Date.now();
    startStageClock();
    renderQuestion();
  }
  function startGame() {
    clearTimeout(timer);
    index = 0; score = 0; startTimeMs = Date.now();
    outcomes = []; reactionSamples = []; levelAccuracies = [];
    $('score').textContent = '0 分';
    $('results').hidden = true;
    beginStage(1);
  }
  function recordOutcome(correct, reactionMs) {
    reactionSamples.push(reactionMs);
    outcomes.push(correct);
    stageOutcomes.push(correct);
    if (correct) score++;
    index++;
    $('score').textContent = `${score} 分`;
    updateProgress();
  }
  function continueAfterFeedback() {
    if (stageRemaining() <= 0) endStage();
    else renderQuestion();
  }
  function missQuestion(message) {
    if (phase !== 'answer' && phase !== 'memory') return;
    const reactionMs = phase === 'answer' ? Math.max(0, Date.now() - answerStartedAt) : 0;
    phase = 'feedback';
    setEnabled(false);
    clearTimeout(timer);
    recordOutcome(false, reactionMs);
    panel.dataset.result = 'wrong';
    $('feedback').textContent = message;
    timer = setTimeout(continueAfterFeedback, FEEDBACK_MS);
  }
  function finishPlayer() {
    phase = 'finished';
    stopStageClock();
    const total = Math.max(index, 1);
    $('final-score').textContent = `${score} / ${index} 分`;
    $('accuracy').textContent = `答對 ${score} 題・正確率 ${Math.round(score / total * 100)}%`;
    $('results').hidden = false;
  }
  function endStage() {
    if (phase === 'break' || phase === 'stage_clear' || phase === 'finished') return;
    stopStageClock();
    clearTimeout(timer);
    setEnabled(false);
    const hits = stageOutcomes.filter(Boolean).length;
    levelAccuracies[stage - 1] = stageOutcomes.length ? hits / stageOutcomes.length : 0;
    const finished = stage;
    if (finished === MID_STAGE) {
      phase = 'break';
      $('feedback').textContent = '第 3 關已結束，等待另一位玩家';
      waitForMidBreak(playerIndex, () => beginStage(finished + 1));
      return;
    }
    if (finished < STAGE_COUNT) {
      phase = 'stage_clear';
      $('feedback').textContent = `第 ${finished} 關已結束，等待另一位玩家`;
      waitForStageClear(playerIndex, finished, () => beginStage(finished + 1));
      return;
    }
    finishPlayer();
  }
  function answer(direction) {
    if (phase !== 'answer') return;
    phase = 'feedback';
    setEnabled(false);
    clearTimeout(timer);
    const expected = question.opposite ? (question.direction === 'left' ? 'right' : 'left') : question.direction;
    const correct = direction === expected;
    recordOutcome(correct, Math.max(0, Date.now() - answerStartedAt));
    panel.dataset.result = correct ? 'correct' : 'wrong';
    $('feedback').textContent = correct ? '答對了！＋1 分' : `${question.opposite ? '虛線要反向！' : '再加油！'}應選${expected === 'left' ? '左 ←' : '右 →'}`;
    timer = setTimeout(continueAfterFeedback, FEEDBACK_MS);
  }
  buttons.forEach((button) => button.addEventListener('click', () => answer(button.dataset.direction)));
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (phase === 'answer' && keyBindings[event.code]) {
      event.preventDefault();
      if (!event.repeat) answer(keyBindings[event.code]);
    }
  });
  $('restart').addEventListener('click', startGame);

  function levelAccuracyText(stageCount) {
    return levelAccuracies
      .slice(0, stageCount)
      .map((value) => Number(value.toFixed(4)))
      .join(',');
  }

  function completedStages() {
    if (phase === 'finished' || phase === 'break' || phase === 'stage_clear') return stage;
    return Math.max(0, stage - 1);
  }

  async function saveRun(stage) {
    const isP1 = playerIndex === 0;
    const studentKey = sessionStorage.getItem(isP1 ? 'student1_key' : 'student2_key') || '';
    const grade = sessionStorage.getItem(isP1 ? 'student1_grade' : 'student2_grade') || 'G1';
    const school = sessionStorage.getItem(isP1 ? 'student1_school' : 'student2_school') || 'KMU';
    const caseId =
      sessionStorage.getItem(isP1 ? 'student1_case' : 'student2_case') ||
      (studentKey.includes('_') ? studentKey.slice(studentKey.indexOf('_') + 1) : studentKey) ||
      (isP1 ? 'S01' : 'S02');
    const currentDay = parseInt(sessionStorage.getItem('current_day') || sessionStorage.getItem('currentDay') || '1', 10);
    const total = Math.max(index, 1);
    const avgReactionMs = reactionSamples.length
      ? reactionSamples.reduce((sum, value) => sum + value, 0) / reactionSamples.length
      : 0;
    await fetch('http://127.0.0.1:5001/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lessonId: '1140908_DAT',
        data: {
          grade,
          caseId,
          school,
          currentDay,
          startTime: Date.now(),
          endTime: Date.now(),
          mode: 'double',
          pairId: pairId,
          stats: [
            { apiname: 'DAT_correct', value: score },
            { apiname: 'DAT_wrong', value: Math.max(total - score, 0) },
            { apiname: 'DAT_accuracy', value: score / total },
            { apiname: 'DAT_duration', value: Date.now() - startTimeMs },
            { apiname: 'DAT_stage', value: stage },
            { apiname: 'DAT_levelAccuracy', value: levelAccuracyText(stage) },
            { apiname: 'DAT_avgReactionMs', value: avgReactionMs },
            { apiname: 'DAT_questionCount', value: index },
          ],
        },
      }),
    }).catch((error) => console.error(error));
  }

  return { startGame, answer, completedStages, saveRun };
}

// 兩位玩家的題目、計時與分數各自獨立。
const players = [
  createPlayer(document.querySelector('.player-1'), { KeyA: 'left', KeyD: 'right' }, 0),
  createPlayer(document.querySelector('.player-2'), { ArrowLeft: 'left', ArrowRight: 'right' }, 1)
];

const midWait = [false, false];
const midResume = [null, null];

const stageWait = [null, null];
const stageResume = [null, null];

function waitForStageClear(playerIndex, level, resume) {
  stageWait[playerIndex] = level;
  stageResume[playerIndex] = resume;
  if (stageWait[0] !== level || stageWait[1] !== level) return;
  window.showStageClear(level).then(() => {
    const resumes = stageResume.slice();
    stageWait[0] = stageWait[1] = null;
    stageResume[0] = stageResume[1] = null;
    resumes.forEach((fn) => fn && fn());
  });
}

function waitForMidBreak(playerIndex, resume) {
  midWait[playerIndex] = true;
  midResume[playerIndex] = resume;
  if (midWait[0] && midWait[1]) {
    document.getElementById('mid-break').hidden = false;
  }
}

document.getElementById('mid-continue').addEventListener('click', () => {
  const resumes = midResume.slice();
  midWait[0] = midWait[1] = false;
  midResume[0] = midResume[1] = null;
  document.getElementById('mid-break').hidden = true;
  resumes.forEach((resume) => resume && resume());
});
let pairId = `${Date.now()}`;

document.getElementById('leave-btn').addEventListener('click', async () => {
  const completed = Math.min(...players.map((player) => player.completedStages()));
  const stage = completed >= STAGE_COUNT ? STAGE_COUNT : completed >= MID_STAGE ? MID_STAGE : 0;
  if (stage) await Promise.all(players.map((player) => player.saveRun(stage)));
  window.askLeave('../Select/index.html');
});

document.getElementById('mid-lobby').addEventListener('click', () => {
  window.location.href = '../Select/index.html';
});

// 預先載入素材後，同時開始兩位玩家的第一題。
const imagePaths = [
  'assets/background.png',
  'assets/arrow/目標泡泡.png',
  'assets/arrow/空泡泡.png',
  ...[6124, 6125, 6132, 6133, 6140, 6141, 6148, 6149].map((n) => `assets/arrow/IMG_${n}.PNG`),
  ...[6120, 6121, 6128, 6129, 6136, 6137, 6144, 6145].map((n) => `assets/opposite_arrow/IMG_${n}.PNG`)
];
Promise.all(imagePaths.map((src) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = resolve;
  image.onerror = reject;
  image.src = src;
}))).then(() => players.forEach((player) => player.startGame())).catch(() => {
  document.querySelectorAll('[data-ui="feedback"]').forEach((feedback) => {
    feedback.textContent = '圖片載入失敗，請重新整理';
  });
});
