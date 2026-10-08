// 1. 取得網址模式與設定
const urlParams = new URLSearchParams(window.location.search);
const isPractice = urlParams.get('mode') === 'practice';

// 全域時間與參數設定
const ROUND_MS = 10000;       // 單題最多 10 秒，逾時算錯並換下一題
const STAGE_MS = 60000;       // 正式遊戲每關 60 秒，時間內答完就繼續出題
const AIM_SPEED = 45;
const ANIMAL_SPEED = 4;

const $ = (id) => document.getElementById(id);
const answerButtons = [$('answer-true')];
const keys = new Set();
const pointerDirections = new Map();
const bindings = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right'
};
const answerLabel = '空白鍵';

let phase = 'loading', paused = false, lastTime, elapsed = 0;
let submitted = false;
let questions = [], index = 0, score = 0, wrong = 0, offTarget = 0, timedOut = 0, outcomes = [];
let reactionSamples = [], activeMs = 0, focusMs = 0;
let aim = { x: 25, y: 50 }, animal = { x: 55, y: 50, vx: 1, vy: .7 };
let gameStartTime = 0; // 遊戲開始時間 (Unix 毫秒)

// 彩蛋機制全域變數
let animalAssetList = [];       // 儲存該學生所有可用的動物圖片 URL
let currentAssetIndex = 0;     // 目前顯示的圖片索引
let consecutiveCorrect = 0;    // 連續答對且瞄準成功計數器
const STREAK_TO_EVOLVE = 5;    // 連續成功幾題升級一次動物

const STAGE_COUNT = isPractice ? 1 : 6;
const QUESTIONS_PER_STAGE = 2;
const MID_STAGE = 3;
let stage = 1;
let stageDeadline = 0;
let stageQuestionNo = 0;
let levelOutcomes = [[]];

let saver;
function showSaveStatus({ status, message, retryable }) {
  $('save-status').textContent = message;
  $('retry-save').hidden = !retryable;
  $('retry-save').disabled = status === 'saving';
  $('restart').disabled = !saver?.canRestart();
  if (!isPractice && $('btn-start-game')) $('btn-start-game').disabled = !saver?.canRestart();
  $('checkpoint-save-status').textContent = message;
  $('checkpoint-retry-save').hidden = !retryable;
  $('save-notice').hidden = phase === 'finished' || status === 'idle' || status === 'saved';
}

function startGame() {
  if (phase === 'finished' && saver && !saver.canRestart()) return;
  saver = window.DatSave.create({ url: `${window.WebGameApi.resolveApiBase()}/sessions`, onChange: showSaveStatus });
  $('save-status').textContent = '';
  $('retry-save').hidden = true;
  $('save-notice').hidden = true;
  $('restart').disabled = false;
  $('btn-start-game').disabled = false;
  gameStartTime = window.WebGameRuntime.now();
  stage = 1;
  stageDeadline = 0;
  stageQuestionNo = 0;
  levelOutcomes = [[]];
  questions = isPractice ? generateRandomQuestions(QUESTIONS_PER_STAGE) : [];

  index = score = wrong = offTarget = timedOut = elapsed = 0;
  consecutiveCorrect = 0; // 重置彩蛋連擊計數器
  outcomes = [];
  reactionSamples = [];
  activeMs = 0;
  focusMs = 0;
  phase = 'aiming';
  submitted = false;
  paused = false;
  lastTime = undefined;
  keys.clear(); pointerDirections.clear();
  aim = { x: 25, y: 50 };
  animal = { x: 55, y: 50, vx: 1, vy: .7 };

  // 重置為第 1 張圖片
  if (animalAssetList.length > 0) {
    currentAssetIndex = 0;
    const animalImgElem = $('animal-image');
    if (animalImgElem) {
      animalImageGeneration++;
      animalImgElem.style.opacity = '1';
      animalImgElem.style.transform = 'scale(1)';
      window.DatAssets.setImage(animalImgElem, animalAssetList[0]);
    }
  }

  $('results').hidden = true;
  $('stage-clear-modal').hidden = true;
  $('btn-lobby').hidden = true;
  $('leave-btn').disabled = false;
  $('question-type').textContent = isPractice ? '【練習模式】等待瞄準' : '等待瞄準';
  $('question-text').textContent = '—';
  $('time-text').textContent = '尚未開始';
  $('time-fill').style.width = '100%';
  $('feedback').textContent = isPractice ? '練習中：將準心移到動物身上開始' : '將準心移到動物身上，開始遊戲';
  $('animal').dataset.result = '';
  
  enableAnswers(false);
  updateProgress(); 
  renderPositions();
}

// 顏色與數學題目產生器
const COLOR_OPTIONS = [
  { name: '紅色', code: '#c52c35' },
  { name: '藍色', code: '#1e88e5' },
  { name: '綠色', code: '#168047' },
  { name: '黃色', code: '#f5e500' },
  { name: '黑色', code: '#212121' },
  { name: '紫色', code: '#8e24aa' }
];

function generateColorQuestion() {
  const isTrue = Math.random() < 0.5;
  const textObj = COLOR_OPTIONS[Math.floor(Math.random() * COLOR_OPTIONS.length)];
  let colorObj = textObj;

  if (!isTrue) {
    const otherColors = COLOR_OPTIONS.filter(c => c.name !== textObj.name);
    colorObj = otherColors[Math.floor(Math.random() * otherColors.length)];
  }

  return {
    type: '顏色判斷：色名與字色是否相同？',
    text: textObj.name,
    color: colorObj.code,
    answer: isTrue
  };
}

function generateMathQuestion() {
  const isTrue = Math.random() < 0.5;
  const isAddition = Math.random() < 0.5;
  let num1, num2, actualResult, displayResult;

  if (isAddition) {
    num1 = Math.floor(Math.random() * 10) + 1;
    num2 = Math.floor(Math.random() * 10) + 1;
    actualResult = num1 + num2;
  } else {
    num1 = Math.floor(Math.random() * 15) + 5;
    num2 = Math.floor(Math.random() * num1) + 1;
    actualResult = num1 - num2;
  }

  if (isTrue) {
    displayResult = actualResult;
  } else {
    const offset = (Math.random() < 0.5 ? 1 : -1) * (Math.floor(Math.random() * 2) + 1);
    displayResult = actualResult + offset;
    if (displayResult <= 0) displayResult = actualResult + 3;
  }

  const operator = isAddition ? '+' : '−';
  return {
    type: '數學判斷：算式答案是否正確？',
    text: `${num1} ${operator} ${num2} = ${displayResult}`,
    color: '#65462f',
    answer: isTrue
  };
}

function generateRandomQuestions(count = 10) {
  const list = [];
  for (let i = 0; i < count; i++) {
    const q = Math.random() < 0.5 ? generateColorQuestion() : generateMathQuestion();
    list.push(q);
  }
  return list;
}

function enableAnswers(enabled) {
  answerButtons.forEach((button) => { button.disabled = !enabled; });
}

function updateProgress() {
  $('score').textContent = `${score} 分`;

  if (isPractice) {
    const shown = Math.min(index + 1, questions.length);
    $('round').textContent = `第 ${shown} / ${questions.length} 題 (練習關卡)`;
    $('progress').setAttribute('aria-valuemax', questions.length);
    $('progress').setAttribute('aria-valuenow', index);$('progress-fill').style.height = `${questions.length ? (index / questions.length) * 100 : 0}%`;
    return;
  }

  const left = stageDeadline
    ? Math.max(0, Math.ceil((stageDeadline - window.WebGameRuntime.now()) / 1000))
    : STAGE_MS / 1000;
  const used = stageDeadline ? Math.min(STAGE_MS, window.WebGameRuntime.now() - (stageDeadline - STAGE_MS)) : 0;
  const ratio = ((stage - 1) + used / STAGE_MS) / STAGE_COUNT;
  $('round').textContent = `第 ${Math.max(stageQuestionNo, 1)} 題・剩餘 ${left} 秒（第 ${stage} / ${STAGE_COUNT} 關）`;
  $('progress').setAttribute('aria-valuemax', 100);
  $('progress').setAttribute('aria-valuenow', Math.round(ratio * 100));$('progress-fill').style.height = `${Math.min(100, ratio * 100)}%`;
}

function answerLimitMs() {
  return ROUND_MS;
  /*
  //修改會在最後一秒跑很多題目的 bug
  if (isPractice || !stageDeadline) return ROUND_MS;
  return Math.max(0, Math.min(ROUND_MS, stageDeadline - window.WebGameRuntime.now()));
  */
}

function renderPositions() {
  for (const [id, position] of [['animal', animal], ['crosshair', aim]]) {
    $(id).style.left = `${position.x}%`;
    $(id).style.top = `${position.y}%`;
  }
}

function isOnAnimal() {
  const field = $('field').getBoundingClientRect();
  const aimX = field.left + aim.x / 100 * field.width;
  const aimY = field.top + aim.y / 100 * field.height;
  const animalRect = $('animal').getBoundingClientRect();
  if (animalRect.width && animalRect.height) {
    const radius = Math.min(animalRect.width, animalRect.height) * 0.36;
    const centerX = animalRect.left + animalRect.width / 2;
    const centerY = animalRect.top + animalRect.height / 2;
    if (Math.hypot(aimX - centerX, aimY - centerY) <= radius) return true;
  }
  if (typeof RABBIT_HIT_MASK === 'undefined') return false;
  const rect = $('animal-image').getBoundingClientRect();
  const size = Math.min(rect.width, rect.height);
  if (!size) return false;
  const left = rect.left + (rect.width - size) / 2;
  const top = rect.top + (rect.height - size) / 2;
  const x = Math.floor((aimX - left) / size * 128);
  const y = Math.floor((aimY - top) / size * 128);
  if (x < 0 || y < 0 || x >= 128 || y >= 128) return false;
  return RABBIT_HIT_MASK[y][x] === '1';
}

function showQuestion(previousFeedback = '') {
  if (!isPractice) {
    if (!stageDeadline) {
      stageDeadline = window.WebGameRuntime.now() + STAGE_MS;
      stageQuestionNo = 0;
    }
    if (!questions[index]) {
      questions[index] = Math.random() < 0.5 ? generateColorQuestion() : generateMathQuestion();
    }
    stageQuestionNo += 1;
  }
  phase = 'answer'; elapsed = 0; submitted = false;
  const q = questions[index];
  $('question-type').textContent = q.type;
  $('question-text').textContent = q.text;
  $('question-text').style.color = q.color;
  $('animal').dataset.result = '';
  $('feedback').textContent = previousFeedback
    ? `上一題：${previousFeedback}`
    : '題目正確就瞄準按空白鍵；不正確則不按';
  enableAnswers(true); updateClock(); updateProgress();
}

function updateClock() {
  const limit = Math.max(answerLimitMs(), 1);
  $('time-text').textContent = `${Math.max(0, (limit - elapsed) / 1000).toFixed(1)} 秒`;
  $('time-fill').style.width = `${Math.max(0, (1 - elapsed / limit) * 100)}%`;
}

function answer() {
  if (phase !== 'answer' || paused || document.hidden || submitted || elapsed >= answerLimitMs()) return;
  submitted = true;
  recordResult(true);
  enableAnswers(false);
}

// 彩蛋動物切換邏輯 (level up)
// 🎨 統一切換圖片與動畫處理
function updateAnimalImage(newIndex) {
  if (!animalAssetList || animalAssetList.length <= 1) return;
  if (newIndex === currentAssetIndex) return; // 索引未改變則不更新

  currentAssetIndex = newIndex;
  const targetAssetUrl = animalAssetList[currentAssetIndex];

  console.log(`🎉 [彩蛋升級] 切換至第 ${currentAssetIndex + 1} / ${animalAssetList.length} 張素材: ${targetAssetUrl}`);

  const animalImgElem = document.getElementById('animal-image') || $('animal-image');
  if (animalImgElem) {
    const imageGeneration = ++animalImageGeneration;
    animalImgElem.style.transition = 'transform 0.2s ease-in-out, opacity 0.2s ease-in-out';
    animalImgElem.style.opacity = '0.2';
    // 升級時先縮小再彈回原尺寸的視覺效果
    animalImgElem.style.transform = 'scale(0.6)';

    window.DatAssets.setImage(animalImgElem, targetAssetUrl).then(() => {
      if (imageGeneration !== animalImageGeneration) return;
      animalImgElem.style.opacity = '1';
      animalImgElem.style.transform = 'scale(1)';
    });
  }
}

// 🎉 連續答對 STREAK_TO_EVOLVE 題：升級 (最大封頂，不循環回 0)
function switchToNextAnimal() {
  if (currentAssetIndex < animalAssetList.length - 1) {
    updateAnimalImage(currentAssetIndex + 1);
  } else {
    console.log(`ℹ️ 已達最大素材頁面 (${currentAssetIndex + 1}/${animalAssetList.length})，保持最高級狀態。`);
  }
}

// 紀錄答題結果
function recordResult(pressed) {
  const correct = pressed === questions[index].answer;
  const onTarget = isOnAnimal();
  const isSuccess = correct && onTarget;
  const hadStreak = consecutiveCorrect > 0;
  let message;
  reactionSamples.push(elapsed);

  if (isSuccess) {
    consecutiveCorrect++;
    score++;
    message = pressed ? '瞄準且答對！＋1 分' : '正確等待且保持瞄準！＋1 分';

    // 連續答對 STREAK_TO_EVOLVE 題：觸發升級彩蛋
    if (consecutiveCorrect % STREAK_TO_EVOLVE === 0) {
      if (currentAssetIndex < animalAssetList.length - 1) {
        message += ` 🎉 連續答對 ${consecutiveCorrect} 題！變身新動物！`;
        switchToNextAnimal();
      } else {
        message += ` 🎉 連續答對 ${consecutiveCorrect} 題！維持最高級動物狀態！`;
      }
    } else if (currentAssetIndex < animalAssetList.length - 1) {
      message += `（再連續答對 ${STREAK_TO_EVOLVE - consecutiveCorrect % STREAK_TO_EVOLVE} 題變身）`;
    }
  } else {
    // 失敗只歸零連擊，已變身的動物保留
    consecutiveCorrect = 0;

    if (!pressed && !correct) {
      timedOut++;
      wrong++;
      message = `漏答：正確的題目要按 ${answerLabel}`;
    } else if (!correct) {
      wrong++;
      message = '誤按：不正確的題目不需要按鍵';
    } else if (!onTarget) {
      offTarget++;
      message = '判斷正確，但準心未對到動物，不計分';
    }
    if (hadStreak) message += '（連擊歸零）';
  }

  $('animal').dataset.result = isSuccess ? 'correct' : 'wrong';
  $('feedback').textContent = message;
  outcomes.push(isSuccess);

  updateProgress();
}

function levelAccuracyText(stageCount) {
  return levelOutcomes
    .slice(0, stageCount)
    .filter((slice) => slice && slice.length)
    .map((slice) => slice.filter(Boolean).length / slice.length)
    .map((value) => Number(value.toFixed(4)))
    .join(',');
}

function showStageClearModal(completedStage) {
  phase = 'stage_clear';
  keys.clear();
  pointerDirections.clear();

  const isMidBreak = completedStage === MID_STAGE;
  if (!isMidBreak) {
    window.showStageClear(completedStage).then(continueNextStage);
    return;
  }
  $('stage-clear-title').textContent = '挑戰完成！';
  $('stage-clear-text').innerHTML = '第 3 關已結束<br>要繼續遊玩嗎？';
  $('btn-next-stage').textContent = '繼續遊玩';
  $('btn-lobby').hidden = false;
  $('stage-clear-modal').hidden = false;
}

function continueNextStage() {
  $('stage-clear-modal').hidden = true;
  $('btn-lobby').hidden = true;
  $('btn-lobby').disabled = false;
  $('btn-next-stage').disabled = false;

  stage += 1;
  stageDeadline = 0;
  levelOutcomes[stage - 1] = [];
  phase = 'aiming';
  aim = { x: 25, y: 50 };
  animal = { x: 55, y: 50, vx: 1, vy: .7 };
  renderPositions();

  $('feedback').textContent = '將準心移到動物身上，開始下一關';
  $('question-type').textContent = '等待瞄準';
  $('question-text').textContent = '—';
  enableAnswers(false);
}

$('btn-next-stage').addEventListener('click', continueNextStage);

$('btn-lobby').addEventListener('click', () => { returnToLobby(); });

function endQuestion() {
  if (phase !== 'answer') return;
  phase = 'resolving';
  if (!submitted) recordResult(false);
  const previousFeedback = $('feedback').textContent;
  if (!isPractice) {
    if (!levelOutcomes[stage - 1]) levelOutcomes[stage - 1] = [];
    levelOutcomes[stage - 1].push(Boolean(outcomes[outcomes.length - 1]));
  }
  index++;

  if (isPractice) {
    if (index < questions.length) showQuestion(previousFeedback);
    else finishGame();
    return;
  }

  // 修改會在最後一秒跑很多題目的 bug
  if (stageDeadline && window.WebGameRuntime.now() >= stageDeadline - 20) {
    if (stage >= STAGE_COUNT) finishGame();
    else showStageClearModal(stage);
    return;
  }
  showQuestion(previousFeedback);
}

function answeredCount() {
  return Math.max(index, 1);
}


function sessionMetrics() {
  const questionCount = score + wrong + offTarget;
  const avgReactionMs = reactionSamples.length
    ? reactionSamples.reduce((sum, value) => sum + value, 0) / reactionSamples.length
    : 0;
  return {
    questionCount,
    avgReactionMs,
    aimRatio: activeMs > 0 ? focusMs / activeMs : 0,
    focusMs,
    accuracy: questionCount ? score / questionCount : 0,
  };
}

function saveCurrentRun(stage) {
  const metrics = sessionMetrics();
  return saveGameDataToBackend({
    score: score,
    wrong: wrong,
    offTarget: offTarget,
    timedOut: timedOut,
    accuracy: metrics.accuracy,
    duration: window.WebGameRuntime.now() - gameStartTime,
    stage: stage,
    levelAccuracy: levelAccuracyText(stage),
    avgReactionMs: metrics.avgReactionMs,
    questionCount: metrics.questionCount,
    aimRatio: metrics.aimRatio,
    focusMs: metrics.focusMs,
  });
}

let exitPending = false;

async function withExitLock(action) {
  if (exitPending) return;
  exitPending = true;
  const buttons = [...document.querySelectorAll('#leave-btn, #restart, #btn-start-game, #btn-lobby, #btn-next-stage, .shared-stage-clear-btn')];
  const disabled = buttons.map((button) => button.disabled);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await action();
  } finally {
    buttons.forEach((button, index) => { button.disabled = disabled[index]; });
    exitPending = false;
  }
}

function checkpointStage() {
  if (isPractice) return 0;
  const completed = phase === 'finished' || phase === 'stage_clear' ? stage : Math.max(0, stage - 1);
  if (completed >= STAGE_COUNT) return STAGE_COUNT;
  if (completed >= MID_STAGE) return MID_STAGE;
  return 0;
}

async function returnToLobby() {
  await withExitLock(async () => {
    const checkpoint = checkpointStage();
    if (checkpoint && !(await saveCurrentRun(checkpoint))) return;
    window.removeEventListener('beforeunload', blockUnload);
    window.__askLeave = false;
    window.location.href = '../Select/index.html';
  });
}

function finishGame() {
  phase = 'finished';
  keys.clear(); pointerDirections.clear();
  $('leave-btn').disabled = false;
  $('stage-clear-modal').hidden = true;
  const answered = Math.max(index, 1);
  $('final-score').textContent = `${score} / ${index} 分`;
  $('summary').textContent = `誤按 ${wrong} 題・判斷正確但未瞄準 ${offTarget} 題・漏答 ${timedOut} 題`;
  $('accuracy').textContent = `得分率 ${Math.round(score / answered * 100)}%`;

  const $startGameBtn =$('btn-start-game');

  if (isPractice) {
    $('result-title').textContent = '練習結束';
    $('restart').textContent = '再練習一次';

    if ($startGameBtn) {$startGameBtn.hidden = false;
      $startGameBtn.textContent = '進入正式遊戲';
      $startGameBtn.onclick = () => {
        window.location.href = 'DAT_single.html?mode=game';
      };
    }
  } else {
    $('result-title').textContent = '挑戰完成！';
    $('restart').textContent = '再玩一次';

    if ($startGameBtn) {$startGameBtn.hidden = false;
      $startGameBtn.textContent = '返回遊戲大廳';
      $startGameBtn.onclick = returnToLobby;
    }

    saveCurrentRun(STAGE_COUNT);
  }

  $('results').hidden = false;
}

async function saveGameDataToBackend(data) {
  const grade = sessionStorage.getItem('grade') || sessionStorage.getItem('student1_grade');
  const caseId = sessionStorage.getItem('caseId') || sessionStorage.getItem('student1_case');
  const school = sessionStorage.getItem('school') || sessionStorage.getItem('student1_school');
  // 讀不到登入學生就不送，避免未登入成績寫進正式庫。
  if (!grade || !caseId || !school) {
    console.warn('找不到登入學生資料，成績不送出');
    return;
  }
  const currentDay = parseInt(
    sessionStorage.getItem('currentDay')
      || sessionStorage.getItem('student1_day')
      || sessionStorage.getItem('current_day')
      || '1',
    10
  );

  // 瓢蟲追擊令成績送 DAT；素材 API 也讀 DAT。
  const payload = {
    lessonId: "1140908_DAT",
    data: {
      grade: grade,
      caseId: caseId,
      school: school,
      currentDay: currentDay,
      startTime: window.WebGameRuntime.toWallTime(gameStartTime),
      endTime: Date.now(),
      mode: "single",
      stats: [
        { apiname: "DAT_correct",  value: data.score },
        { apiname: "DAT_wrong",    value: data.wrong },
        { apiname: "DAT_accuracy", value: data.accuracy },
        { apiname: "DAT_duration", value: data.duration },
        { apiname: "DAT_stage",    value: data.stage },
        { apiname: "DAT_levelAccuracy", value: data.levelAccuracy },
        { apiname: "DAT_avgReactionMs", value: data.avgReactionMs },
        { apiname: "DAT_questionCount", value: data.questionCount },
        { apiname: "DAT_aimRatio", value: data.aimRatio },
        { apiname: "DAT_focusMs", value: data.focusMs },
      ]
    }
  };

  return saver.save(data.stage, payload);
}

function move(delta) {
  const directions = new Set([...keys].map((key) => bindings[key]).concat([...pointerDirections.values()]));
  let dx = Number(directions.has('right')) - Number(directions.has('left'));
  let dy = Number(directions.has('down')) - Number(directions.has('up'));
  const length = Math.hypot(dx, dy) || 1;
  const field = $('field').getBoundingClientRect();
  const ratio = field.width / field.height;
  aim.x = Math.max(2, Math.min(98, aim.x + dx / length * AIM_SPEED * delta / 1000));
  aim.y = Math.max(5, Math.min(95, aim.y + dy / length * AIM_SPEED * ratio * delta / 1000));

  if (phase === 'answer') {
    animal.motion = (animal.motion || 0) + ANIMAL_SPEED * delta / 1000 / 30;
    animal.x = 55 + 28 * Math.sin(animal.motion);
    animal.y = 50 + 15 * Math.sin(animal.motion * .8);
  }
  renderPositions();
}

function tick(time) {
  const delta = lastTime === undefined ? 0 : Math.max(0, time - lastTime);
  lastTime = time;
  if (!paused && !document.hidden && ['aiming', 'answer'].includes(phase)) {
    activeMs += delta;
    if (isOnAnimal()) focusMs += delta;
    let remaining = Math.min(delta, 5000);
    while (remaining > 0) { const step = Math.min(remaining, 20); move(step); remaining -= step; }
    if (phase === 'aiming') {
      if (isOnAnimal()) showQuestion();
    } else if (phase === 'answer') {
      elapsed = Math.min(answerLimitMs(), elapsed + delta);
      updateClock();

      //修改會在最後一秒跑很多題目的 bug
      const isStageTimeout = !isPractice && stageDeadline && window.WebGameRuntime.now() >= stageDeadline;
      if (elapsed >= answerLimitMs() || isStageTimeout) {
        endQuestion();
      }
    }
    if (!isPractice && (phase === 'aiming' || phase === 'answer')) updateProgress();
  }
  requestAnimationFrame(tick);
}

$('answer-true').addEventListener('click', answer);
$('restart').addEventListener('click', () => { if (phase === 'finished') startGame(); });$('leave-btn').addEventListener('click', leaveGame);

async function leaveGame() {
  if (phase === 'finished') {
    await returnToLobby();
    return;
  }
  await withExitLock(async () => {
    const checkpoint = checkpointStage();
    if (checkpoint && !(await saveCurrentRun(checkpoint))) return;
    window.removeEventListener('beforeunload', blockUnload);
    window.askLeave('../Select/index.html');
  });
}
$('retry-save').addEventListener('click', () => saver.retry());
$('checkpoint-retry-save').addEventListener('click', () => saver.retry());

function clearInput() { keys.clear(); pointerDirections.clear(); lastTime = undefined; }
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', clearInput);
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (event.target?.disabled) return;
  if (!$('results').hidden && event.key === 'Tab') {
    const buttons = [...$('results').querySelectorAll('button:not([hidden]):not(:disabled)')];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    const next = current < 0 ? (event.shiftKey ? buttons.length - 1 : 0)
      : (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].focus();
    return;
  }
  if (bindings[event.code] && ['aiming', 'answer'].includes(phase) && !paused) {
    event.preventDefault(); keys.add(event.code);
  }
  if (event.code === 'Space' && phase === 'answer' && !paused && event.target?.id !== 'leave-btn') {
    event.preventDefault();
    if (!event.repeat) answer();
  }
});
document.addEventListener('keyup', (event) => keys.delete(event.code));
document.querySelectorAll('[data-move]').forEach((button) => {
  button.addEventListener('pointerdown', (event) => {
    if (paused || !['aiming', 'answer'].includes(phase)) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    pointerDirections.set(event.pointerId, button.dataset.move);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(name, (event) => pointerDirections.delete(event.pointerId));
  }
});

// 動態載入學生素材與彩蛋清單
const ASSET_SERVER_HOST = 'https://attention-lesson-plan-assets.zeabur.app';
const DEFAULT_ANIMAL_PATH = 'assets/animals/rabbit.png';
let animalImageGeneration = 0;
const DEFAULT_ANIMAL_POOL = [
  'assets/animals/rabbit.png',
  'assets/animals/cat.png',
  'assets/animals/dog.png',
  'assets/animals/bird.png',
];

function assetStudentId(rawId) {
  const id = String(rawId || '').trim();
  const caseId = id.includes('_') ? id.split('_').pop() : id;
  const match = /^([A-Za-z]+)(\d+)$/.exec(caseId);
  if (!match) return caseId;
  return `${match[1].toUpperCase()}${String(Number(match[2])).padStart(3, '0')}`;
}

async function fetchStudentAssets() {
  const rawId = sessionStorage.getItem('caseId') || sessionStorage.getItem('student1_case') || 'S001';
  const studentId = assetStudentId(rawId);

  const apiUrl = `${ASSET_SERVER_HOST}/api/students/${studentId}/assets`;
  console.log(`[流程 1] 遊戲 Call API: GET ${apiUrl}`);

  animalAssetList = await window.DatAssets.fetchAssetList(apiUrl, DEFAULT_ANIMAL_POOL);

  currentAssetIndex = 0;
  console.log(`[素材載入完成] 最終素材清單共有 ${animalAssetList.length} 張圖:`, animalAssetList);
  return animalAssetList[0];
}

async function initGameWorkflow() {
  console.log('🎮 遊戲開始，執行素材載入流程...');

  // 1. 載入前先隱藏動物與準心，避免畫面出現預設預載殘影
  const animalElem = $('animal');
  const crosshairElem = $('crosshair');
  if (animalElem) animalElem.style.visibility = 'hidden';
  if (crosshairElem) crosshairElem.style.visibility = 'hidden';

  const animalAssetUrl = await fetchStudentAssets();

  // 2. 並行預載背景圖、準心圖與動物圖
  const [, , finalAnimalSrc] = await Promise.all([
    window.DatAssets.loadImage('assets/background.png', 'assets/background.png'),
    window.DatAssets.loadImage('assets/crosshair.png', 'assets/crosshair.png'),
    window.DatAssets.loadImage(animalAssetUrl)
  ]);
  animalAssetList[0] = finalAnimalSrc;

  const animalImgElem = $('animal-image');
  if (animalImgElem) {
    await window.DatAssets.setImage(animalImgElem, finalAnimalSrc);
    console.log(`[DOM 更新] 套用初始動物素材: ${finalAnimalSrc}`);
  }

  // 3. 啟動遊戲並計算初始化位置
  startGame();

  // 4. 全部圖片下載並渲染完成後，再顯示動物與準心
  if (animalElem) animalElem.style.visibility = 'visible';
  if (crosshairElem) crosshairElem.style.visibility = 'visible';
}

initGameWorkflow();
requestAnimationFrame(tick);

function blockUnload(event) {
  if (['aiming', 'answer'].includes(phase)) {
    event.preventDefault();
    event.returnValue = '';
  }
}
window.addEventListener('beforeunload', blockUnload);
window.addEventListener("webgame:pause", () => { keys.clear(); pointerDirections.clear(); });
