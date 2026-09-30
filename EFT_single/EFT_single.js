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
const $ = (id) => document.getElementById(id);
const buttons = [...document.querySelectorAll('[data-direction]')];
const panel = document.querySelector('.answer-panel');
let question = null, index = 0, score = 0, phase = 'intro', timer;
let outcomes = [], reactionSamples = [], answerStartedAt = 0;
let gameStartTime = 0;
let stage = 1, stageQuestion = 0, stageStartedAt = 0, stageOutcomes = [], levelAccuracies = [];
let clockId = 0;
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
  document.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', index);
  const secondsLeft = Math.max(0, Math.ceil(stageRemaining() / 1000));
  $('round').textContent = `第 ${stageQuestion} 題・剩餘 ${secondsLeft} 秒（第 ${stage} / ${STAGE_COUNT} 關）`;
}
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
  // 記憶階段隨機一顆黃色目標，另外兩個位置顯示空泡泡。
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
    // 三顆泡泡大小與外觀一致，不留下目標標籤或黃色提示。
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
  index = 0; score = 0; outcomes = []; reactionSamples = []; levelAccuracies = [];
  gameStartTime = Date.now();
  $('score').textContent = '0 分';
  $('results').hidden = true;
  $('mid-break-modal').hidden = true;
  $('btn-continue').disabled = false;
  $('btn-lobby').disabled = false;
  beginStage(1);
}

function returnToLobby() {
  window.location.href = '../Select/index.html';
}

function showMidBreak() {
  phase = 'break';
  setEnabled(false);
  $('mid-break-modal').hidden = false;
  $('btn-continue').focus();
}

function finishGame() {
  phase = 'finished';
  stopStageClock();
  $('mid-break-modal').hidden = true;
  const total = Math.max(index, 1);
  $('final-score').textContent = `${score} / ${index} 分`;
  $('accuracy').textContent = `答對 ${score} 題・正確率 ${Math.round(score / total * 100)}%`;
  $('results').hidden = false;
  $('restart').focus();
  void saveCurrentRun(STAGE_COUNT);
}

let savedStage = 0;

function saveCurrentRun(stage) {
  savedStage = stage;
  const total = Math.max(index, 1);
  const avgReactionMs = reactionSamples.length
    ? reactionSamples.reduce((sum, value) => sum + value, 0) / reactionSamples.length
    : 0;
  return saveGameDataToBackend({
    score,
    wrong: Math.max(total - score, 0),
    accuracy: score / total,
    duration: Date.now() - gameStartTime,
    stage,
    levelAccuracy: levelAccuracyText(stage),
    avgReactionMs,
    questionCount: index,
  });
}

function levelAccuracyText(stageCount) {
  return levelAccuracies
    .slice(0, stageCount)
    .map((value) => Number(value.toFixed(4)))
    .join(',');
}

async function saveGameDataToBackend(data) {
  const url = `${window.WedGameApi.resolveApiBase()}/sessions`;
  const grade = sessionStorage.getItem('grade') || sessionStorage.getItem('student1_grade') || 'G1';
  const caseId = sessionStorage.getItem('caseId') || sessionStorage.getItem('student1_case') || 'S03';
  const school = sessionStorage.getItem('school') || sessionStorage.getItem('student1_school') || 'KMU';
  const currentDay = parseInt(
    sessionStorage.getItem('currentDay')
      || sessionStorage.getItem('student1_day')
      || sessionStorage.getItem('current_day')
      || '1',
    10
  );

  const payload = {
    lessonId: '1140908_DAT',
    data: {
      grade,
      caseId,
      school,
      currentDay,
      startTime: gameStartTime,
      endTime: Date.now(),
      mode: 'single',
      stats: [
        { apiname: 'DAT_correct', value: data.score },
        { apiname: 'DAT_wrong', value: data.wrong },
        { apiname: 'DAT_accuracy', value: data.accuracy },
        { apiname: 'DAT_duration', value: data.duration },
        { apiname: 'DAT_stage', value: data.stage },
        { apiname: 'DAT_levelAccuracy', value: data.levelAccuracy },
        { apiname: 'DAT_avgReactionMs', value: data.avgReactionMs },
        { apiname: 'DAT_questionCount', value: data.questionCount },
      ],
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status !== 201) {
      const errData = await res.json().catch(() => ({}));
      console.error(`成績送出失敗 ${res.status}:`, errData.detail || '寫入失敗');
    }
  } catch (err) {
    console.error('成績送出失敗：', err);
  }
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
function endStage() {
  if (phase === 'break' || phase === 'stage_clear' || phase === 'finished') return;
  stopStageClock();
  clearTimeout(timer);
  setEnabled(false);
  const hits = stageOutcomes.filter(Boolean).length;
  levelAccuracies[stage - 1] = stageOutcomes.length ? hits / stageOutcomes.length : 0;
  const finished = stage;
  if (finished === MID_STAGE) {
    showMidBreak();
    return;
  }
  if (finished < STAGE_COUNT) {
    phase = 'stage_clear';
    window.showStageClear(finished).then(() => beginStage(finished + 1));
    return;
  }
  finishGame();
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
  if (phase === 'answer' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    if (!event.repeat) answer(event.key === 'ArrowLeft' ? 'left' : 'right');
  }
  const overlay = !$('results').hidden ? $('results') : (!$('mid-break-modal').hidden ? $('mid-break-modal') : null);
  if (overlay && event.key === 'Tab') {
    event.preventDefault(); overlay.querySelector('button').focus();
  }
});
$('leave-btn').addEventListener('click', leaveGame);

async function leaveGame() {
  $('leave-btn').disabled = true;
  const completed = phase === 'finished' || phase === 'break' || phase === 'stage_clear' ? stage : stage - 1;
  const checkpoint = completed >= STAGE_COUNT ? STAGE_COUNT : completed >= MID_STAGE ? MID_STAGE : 0;
  if (checkpoint && checkpoint !== savedStage) await saveCurrentRun(checkpoint);
  window.askLeave('../Select/index.html');
  $('leave-btn').disabled = false;
}

$('restart').addEventListener('click', startGame);
$('btn-lobby-finish').addEventListener('click', returnToLobby);
$('btn-continue').addEventListener('click', () => {
  $('mid-break-modal').hidden = true;
  beginStage(stage + 1);
});
$('btn-lobby').addEventListener('click', async () => {
  $('btn-continue').disabled = true;
  $('btn-lobby').disabled = true;
  await saveCurrentRun(MID_STAGE);
  returnToLobby();
});
// 等圖片載入完成才開始，讓第一題也能完整顯示黃色目標一秒。
const targetImage = new Image();
targetImage.onload = startGame;
targetImage.onerror = () => { $('feedback').textContent = '目標泡泡圖片載入失敗，請重新整理'; };
targetImage.src = 'assets/arrow/目標泡泡.png';
