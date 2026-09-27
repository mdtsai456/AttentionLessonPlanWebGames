//匯入題目生成與發送 API 功能
import { generateRandomQuestions } from './single_questions.js';
import { saveGameDataToBackend } from './single_api.js';

// 取得網址模式與設定
const urlParams = new URLSearchParams(window.location.search);
const isPractice = urlParams.get('mode') === 'practice';

// 全域時間與參數設定
const ROUND_MS = 4000;       
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

let phase = 'loading', paused = false, lastTime, elapsed = 0;
let submitted = false;
let questions = [], index = 0, score = 0, wrong = 0, offTarget = 0, timedOut = 0;
let aim = { x: 25, y: 50 }, animal = { x: 55, y: 50, vx: 1, vy: .7 };
const animalPixels = { width: 128, height: 128, rows: RABBIT_HIT_MASK };
let gameStartTime = 0; // 遊戲開始時間 (Unix 毫秒)

let isFirstAim = true; //判斷瞄準動物之後開始計時
const STAGE_COUNT = isPractice ? 1 : 2;
const QUESTIONS_PER_STAGE = isPractice ? 2 : 3;
function startGame() {
  // 設定題數：練習模式 5 題，正式模式固定 15 題
  gameStartTime = Date.now();
  const totalQuestions = STAGE_COUNT * QUESTIONS_PER_STAGE;
  questions = generateRandomQuestions(totalQuestions);

  index = score = wrong = offTarget = timedOut = elapsed = 0;
  phase = 'aiming';
  submitted = false;
  paused = false;
  lastTime = undefined;
  keys.clear(); pointerDirections.clear();
  aim = { x: 25, y: 50 };
  animal = { x: 55, y: 50, vx: 1, vy: .7 };

  $('results').hidden = true;
  $('pause').disabled = false;
  $('pause').textContent = '暫停';
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

function enableAnswers(enabled) {
  answerButtons.forEach((button) => { button.disabled = !enabled; });
}

function updateProgress() {
  $('score').textContent = `${score} 分`;

  // 防止超出陣列索引
  const safeIndex = Math.min(index, questions.length - 1);
  
  // 計算當前關卡 (1-based) 與當前關卡內的題數 (1~12)
  const currentStage = Math.floor(safeIndex / QUESTIONS_PER_STAGE) + 1;
  const currentQuestionInStage = (safeIndex % QUESTIONS_PER_STAGE) + 1;

  // 格式化顯示文字
  if (isPractice) {
    $('round').textContent = `第 ${currentQuestionInStage} / ${QUESTIONS_PER_STAGE} 題 (練習關卡)`;
  } else {
    $('round').textContent = `第 ${currentQuestionInStage} / ${QUESTIONS_PER_STAGE} 題 (第 ${currentStage} / ${STAGE_COUNT} 關)`;
  }

  // 左側整體進度條更新 (按總進度 60 題比例計算)
  $('progress').setAttribute('aria-valuemax', questions.length);
  $('progress').setAttribute('aria-valuenow', index);
  $('progress-fill').style.height = `${(index / questions.length) * 100}%`;
}

function renderPositions() {
  for (const [id, position] of [['animal', animal], ['crosshair', aim]]) {
    $(id).style.left = `${position.x}%`;
    $(id).style.top = `${position.y}%`;
  }
}

function isOnAnimal() {
  if (!animalPixels) return false;
  const rect = $('animal-image').getBoundingClientRect();
  const field = $('field').getBoundingClientRect();
  const size = Math.min(rect.width, rect.height);
  const left = rect.left + (rect.width - size) / 2;
  const top = rect.top + (rect.height - size) / 2;
  const x = Math.floor((field.left + aim.x / 100 * field.width - left) / size * animalPixels.width);
  const y = Math.floor((field.top + aim.y / 100 * field.height - top) / size * animalPixels.height);
  if (x < 0 || y < 0 || x >= animalPixels.width || y >= animalPixels.height) return false;
  return animalPixels.rows[y][x] === '1';
}

function showQuestion() {
  phase = 'answer'; elapsed = 0; submitted = false;
  const q = questions[index];
  $('question-type').textContent = q.type;
  $('question-text').textContent = q.text;
  $('question-text').style.color = q.color;
  $('animal').dataset.result = '';
  $('feedback').textContent = '題目正確就瞄準按空白鍵；不正確則不按';
  enableAnswers(true); updateClock(); updateProgress();
}

function updateClock() {
  $('time-text').textContent = `${((ROUND_MS - elapsed) / 1000).toFixed(1)} 秒`;
  $('time-fill').style.width = `${(1 - elapsed / ROUND_MS) * 100}%`;
}

function answer() {
  if (phase !== 'answer' || paused || document.hidden || submitted || elapsed >= ROUND_MS) return;
  submitted = true;
  recordResult(true);
  enableAnswers(false);
}

function recordResult(pressed) {
  const correct = pressed === questions[index].answer;
  const onTarget = isOnAnimal();
  let message;
  if (!pressed && !correct) {
    timedOut++; message = '漏答：正確的題目要按空白鍵';
  } else if (!correct) {
    wrong++; message = '誤按：不正確的題目不需要按鍵';
  } else if (!onTarget) {
    offTarget++; message = '判斷正確，但準心未對到動物，不計分';
  } else {
    score++; message = pressed ? '瞄準且答對！＋1 分' : '正確等待且保持瞄準！＋1 分';
  }
  $('animal').dataset.result = correct && onTarget ? 'correct' : 'wrong';
  $('feedback').textContent = message;
  updateProgress();
}

function showStageClearModal(completedStage) {
  phase = 'stage_clear'; // 暫停遊戲邏輯狀態
  keys.clear();
  pointerDirections.clear();
  
  $('stage-clear-title').textContent = `第 ${completedStage} 關結束`;
  $('stage-clear-modal').hidden = false;
}

// 點擊「繼續」進入下一關
$('btn-next-stage').addEventListener('click', () => {
  $('stage-clear-modal').hidden = true;
  
  // 重置回等待瞄準階段
  phase = 'aiming';
  aim = { x: 25, y: 50 };
  animal = { x: 55, y: 50, vx: 1, vy: .7 };
  renderPositions();

  $('feedback').textContent = '將準心移到動物身上，開始下一關';
  $('question-type').textContent = '等待瞄準';
  $('question-text').textContent = '—';
  enableAnswers(false);
});

function endQuestion() {
  if (!submitted) recordResult(false);
  index++;

  if (index < questions.length) {
    // 當剛好做完一關時
    if (!isPractice && index % QUESTIONS_PER_STAGE === 0) {
      const completedStage = index / QUESTIONS_PER_STAGE;
      showStageClearModal(completedStage); 
    } else {
      updateProgress();
      showQuestion();
    }
  } else {
    updateProgress();
    finishGame();
  }
}

// 寫入後端 API (預留介面)
// 寫入中介平台 / 資料庫 API
function finishGame() {
  phase = 'finished';
  keys.clear(); pointerDirections.clear();
  $('pause').disabled = true;
  $('final-score').textContent = `${score} / ${questions.length} 分`;
  $('summary').textContent = `誤按 ${wrong} 題・判斷正確但未瞄準 ${offTarget} 題・漏答 ${timedOut} 題`;
  $('accuracy').textContent = `得分率 ${Math.round(score / questions.length * 100)}%`;

  const $startGameBtn =$('btn-start-game');

  if (isPractice) {
    $('result-title').textContent = '練習結束';
    $('restart').textContent = '再練習一次';
    $('restart').onclick = startGame;

    if ($startGameBtn) {$startGameBtn.hidden = false;
      $startGameBtn.textContent = '進入正式遊戲';
      $startGameBtn.onclick = () => {
        window.location.href = 'single.html?mode=game';
      };
    }
  } else {
    $('result-title').textContent = '挑戰完成！';
    $('restart').textContent = '再玩一次';
    $('restart').onclick = startGame;

    if ($startGameBtn) {$startGameBtn.hidden = false;
      $startGameBtn.textContent = '返回遊戲大廳';
      $startGameBtn.onclick = () => {
        window.location.href = '../games.html';
      };
    }

    sendApiData();// 呼叫 API 上傳資料庫 
  }

  $('results').hidden = false; 
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
    let remaining = Math.min(delta, 5000);
    while (remaining > 0) { const step = Math.min(remaining, 20); move(step); remaining -= step; }
    if (phase === 'aiming') {
      if (isOnAnimal()) showQuestion();
    } else if (phase === 'answer') {
      elapsed = Math.min(ROUND_MS, elapsed + delta);
      updateClock();
      if (elapsed >= ROUND_MS) endQuestion();
    }
  }
  requestAnimationFrame(tick);
}

$('answer-true').addEventListener('click', answer);
$('restart').addEventListener('click', startGame);
$('pause').addEventListener('click', () => {
  if (phase === 'aiming' || phase === 'answer') {
    // 1. 將單人遊戲狀態設為暫停
    paused = true;
    lastTime = undefined;
    keys.clear();
    pointerDirections.clear();
    enableAnswers(false);

    // 2. 顯示中途離開警告彈窗
    const warningOverlay = document.getElementById('leave-warning-overlay');
    if (warningOverlay) warningOverlay.hidden = false;
  } else {
    // 切換暫停 / 繼續
    paused = !paused;
    lastTime = undefined;
    keys.clear(); 
    pointerDirections.clear();
    $('pause').textContent = paused ? '繼續' : '暫停';
    enableAnswers(!paused && phase === 'answer' && !submitted);
  }
});

//繼續遊玩
// 點擊「繼續遊玩」按鈕時恢復遊戲
const cancelLeaveBtn = document.getElementById('btn-cancel-leave');
if (cancelLeaveBtn) {
  cancelLeaveBtn.addEventListener('click', () => {
    const warningOverlay = document.getElementById('leave-warning-overlay');
    if (warningOverlay) warningOverlay.hidden = true;
    
    // 恢復遊戲
    paused = false;
    lastTime = undefined;
    enableAnswers(phase === 'answer' && !submitted);
  });
}

// 點擊「確定離開」按鈕時返回大廳/首頁
const confirmLeaveBtn = document.getElementById('btn-confirm-leave');
if (confirmLeaveBtn) {
  confirmLeaveBtn.addEventListener('click', () => {
    sendApiData();//中途離開也會上傳 db
    window.location.href = '../games.html'; // 或您頁面的首頁路徑
  });
}

//發送至 single_api.js 的 JSON 資料
function sendApiData() {
  // 正式模式且有開始遊戲才發送
  if (isPractice || !gameStartTime) return;

  const now = Date.now();
  const calculatedDuration = now - gameStartTime;

  saveGameDataToBackend({
    score: score,
    wrong: wrong,
    offTarget: offTarget,
    timedOut: timedOut,
    accuracy: questions.length > 0 ? Math.round((score / questions.length) * 100) : 0,
    duration: calculatedDuration, // 自動以實際遊玩毫秒數當作 duration
    stage: STAGE_COUNT,
    startTime: gameStartTime
  });
}

function clearInput() { keys.clear(); pointerDirections.clear(); lastTime = undefined; }
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', clearInput);
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (bindings[event.code] && ['aiming', 'answer'].includes(phase) && !paused) {
    event.preventDefault(); keys.add(event.code);
  }
  if (event.code === 'Space' && phase === 'answer' && !paused && event.target !== $('pause')) {
    event.preventDefault();
    if (!event.repeat) answer();
  }
  if (!$('results').hidden && event.key === 'Tab') {
    event.preventDefault();
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

Promise.all(['assets/single_background.png', 'assets/crosshair.png', 'assets/animals/rabbit.png'].map((src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  })
)).then(startGame).catch(() => {
  $('feedback').textContent = '圖片載入失敗，請重新整理';
});
requestAnimationFrame(tick);


// 攔截瀏覽器關閉/重新整理事件
window.addEventListener('beforeunload', (event) => {
  // 只有在遊戲進行中 (aiming 或 answer 階段) 才觸發警告
  if (['aiming', 'answer'].includes(phase)) {
    event.preventDefault();
  }
});