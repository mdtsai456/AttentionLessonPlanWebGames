import { sendSessionToApi } from './api.js';
import { generateQuestionSet } from './questions.js';

export const ROUND_MS = 1 * 1000;//秒數
export const AIM_SPEED = 45;
export const ANIMAL_SPEED = 4;
export const TOTAL_STAGES = 1;//關卡數量
// 目前關卡:5 題目:12/每關 秒數:10 => 5*12*10 = 600 秒 = 10 分鐘
export function createPlayer(element, bindings, answerCodes, answerLabel, playerIndex, getState) {
  const $ = (id) => element.querySelector(`[data-ui="${id}"]`);

  const backHomeBtn = $('back-home');
  if (backHomeBtn) {
    backHomeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      getState().safeNavigateTo('../games.html');
    });
  }

  $('pause').addEventListener('click', () => {
    if (phase === 'aiming' || phase === 'answer') {
      getState().players.forEach(p => p.pauseGame && p.pauseGame());
      const warningOverlay = document.getElementById('leave-warning-overlay');
      if (warningOverlay) warningOverlay.hidden = false;
    } else {
      paused = !paused;
      lastTime = undefined;
      keys.clear(); 
      pointerDirections.clear();
      $('pause').textContent = paused ? '繼續' : '暫停';
      enableAnswers(!paused && phase === 'answer' && !submitted);
    }
  });

  const answerButtons = [$('answer-true')];
  const keys = new Set();
  const pointerDirections = new Map();

  let phase = 'loading', paused = false, lastTime, elapsed = 0;
  let submitted = false;
  let isPractice = false;
  let questions = [], index = 0;

  let currentStage = 1;
  let totalStageQuestionsCount = 0;
  let score = 0, wrong = 0, offTarget = 0, timedOut = 0;
  let startTimeMs = 0, endTimeMs = 0;

  let aim = { x: 25, y: 50 }, animal = { x: 55, y: 50, vx: 1, vy: .7 };
  const animalPixels = { width: 128, height: 128, rows: RABBIT_HIT_MASK };

  function loadStageQuestions(stage) {
    const questionsPerStage = 12; //題數
    questions = generateQuestionSet(questionsPerStage);
  }

  function startPractice() {
    isPractice = true;
    getState().playerPracticeFinished[playerIndex] = false;
    questions = generateQuestionSet(2, true);

    resetPlayerState(true);
    $('field').dataset.mode = 'practice';
    $('results').hidden = true;
    $('question-type').textContent = '等待瞄準';
    $('question-text').textContent = '—';
    $('time-text').textContent = '尚未開始';
    $('time-fill').style.width = '100%';
    $('feedback').textContent = `請先移動準心重疊動物；重疊後按 ${answerLabel} 作答`;
    $('animal').dataset.result = '';
    enableAnswers(false);
    updateProgress(); renderPositions();
  }

  function startGame() {
    isPractice = false;
    currentStage = 1;//設定關卡為第一關
    startTimeMs = Date.now();
    
    score = wrong = offTarget = timedOut = elapsed = 0;
    
    loadStageQuestions(currentStage);
    totalStageQuestionsCount = questions.length * TOTAL_STAGES;
    
    resetPlayerState(false);
    
    $('field').dataset.mode = 'game';
    $('results').hidden = true;
    $('pause').disabled = false;
    $('pause').textContent = '暫停';
    $('question-type').textContent = '等待瞄準';
    $('question-text').textContent = '—';
    $('time-text').textContent = '尚未開始';
    $('time-fill').style.width = '100%';
    $('feedback').textContent = '將準心移到動物身上，開始遊戲';
    $('animal').dataset.result = '';
    enableAnswers(false);
    updateProgress(); renderPositions();
  }

  function resetPlayerState(resetScore = true) {
    if (resetScore) {
      score = wrong = offTarget = timedOut = 0;
    }
    index = 0;
    submitted = false;
    paused = false;
    phase = 'aiming';
    lastTime = undefined;
    keys.clear(); pointerDirections.clear();
    aim = { x: 25, y: 50 };
    animal = { x: 55, y: 50, vx: 1, vy: .7 };
  }

  function updateProgress() {
    $('score').textContent = `${score} 分`;
    $('round').textContent = `第 ${currentStage}/${TOTAL_STAGES} 關 (題 ${Math.min(index + 1, questions.length)}/${questions.length})`;
    
    const currentTotalCompleted = (currentStage - 1) * questions.length + index;
    const totalMax = totalStageQuestionsCount || (questions.length * TOTAL_STAGES);
    $('progress').setAttribute('aria-valuemax', totalMax);
    $('progress').setAttribute('aria-valuenow', currentTotalCompleted);
    $('progress-fill').style.height = `${(currentTotalCompleted / totalMax) * 100}%`;
  }

  function enableAnswers(enabled) {
    answerButtons.forEach((button) => { button.disabled = !enabled; });
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
    $('feedback').textContent = `題目正確按 ${answerLabel}；不正確則不按`;
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
      timedOut++; message = `漏答：正確的題目要按 ${answerLabel}`;
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

  function endQuestion() {
    if (!submitted) recordResult(false);
    const message = $('feedback').textContent;
    index++;
    updateProgress();

    if (index < questions.length) {
      showQuestion();
      $('feedback').textContent = `上一題：${message}`;
    } else {
      if (isPractice) {
        finishPractice();
      } else {
        if (currentStage < TOTAL_STAGES) {
          currentStage++;
          resetPlayerState(false);
          loadStageQuestions(currentStage);

          $('question-type').textContent = `第 ${currentStage} 關過場`;
          $('question-text').textContent = '🎯 請移動準心重新瞄準動物';
          $('question-text').style.color = '#a253d5';
          $('time-text').textContent = '尚未開始';
          $('time-fill').style.width = '100%';
          $('feedback').textContent = `恭喜通過第 ${currentStage - 1} 關！請重新瞄準動物`;
          $('animal').dataset.result = '';
          enableAnswers(false);
          updateProgress(); renderPositions();
        } else {
          finishGame();
        }
      }
    }
  }

  function finishPractice() {
    phase = 'practice_done';
    enableAnswers(false);
    $('question-type').textContent = '【練習完成】';
    $('question-text').textContent = '✅ 準備進入正式遊戲';
    $('question-text').style.color = '#328647';
    $('feedback').textContent = '練習結束，等待另一位玩家…';
    
    getState().playerPracticeFinished[playerIndex] = true;

    if (getState().playerPracticeFinished[0] && getState().playerPracticeFinished[1]) {
      setTimeout(() => {
        getState().players.forEach((p) => p.startGame());
      }, 1500);
    }
  }

  async function finishGame() {
    phase = 'finished';
    endTimeMs = Date.now();
    keys.clear(); pointerDirections.clear();

    const totalQuestions = totalStageQuestionsCount || (questions.length * TOTAL_STAGES); 
    const accuracyValue = parseFloat((score / Math.max(1, totalQuestions)).toFixed(2));
    const durationMs = endTimeMs - startTimeMs;

    $('pause').disabled = true;
    $('final-score').textContent = `${score} / ${totalQuestions} 分`;
    $('summary').textContent = `累計誤按 ${wrong} 題・未瞄準 ${offTarget} 題・漏答 ${timedOut} 題`;
    $('accuracy').textContent = `總得分率 ${Math.round(accuracyValue * 100)}%`;
    $('results').hidden = false;

    const isP1 = (playerIndex === 0);
    const studentKey = sessionStorage.getItem(isP1 ? "student1_key" : "student2_key") || (isP1 ? "S01" : "S02");
    const schoolKey  = sessionStorage.getItem(isP1 ? "student1_school" : "student2_school") || "KMU";
    const gradeKey   = sessionStorage.getItem(isP1 ? "student1_grade" : "student2_grade") || "G1";
    const currentDay = parseInt(sessionStorage.getItem("current_day") || "1", 10);

    const payload = {
      lessonId: "1140908_DAT",
      data: {
        grade: gradeKey,
        caseId: studentKey,
        school: schoolKey,
        currentDay: currentDay,
        startTime: startTimeMs,
        endTime: endTimeMs,
        mode: "double",
        pairId: getState().currentGamePairId,
        stats: [
          { apiname: "DAT_correct",  value: score },
          { apiname: "DAT_wrong",    value: wrong },
          { apiname: "DAT_accuracy", value: accuracyValue },
          { apiname: "DAT_duration", value: durationMs },
          { apiname: "DAT_stage",    value: TOTAL_STAGES }
        ]
      }
    };

    console.log(`[Player ${playerIndex + 1}] 正在存檔中...`, payload);
    await sendSessionToApi(payload);
  }

  function move(delta) {
    if (paused) return;
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

  function clearInput() { keys.clear(); pointerDirections.clear(); lastTime = undefined; }
  window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', clearInput);
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (bindings[event.code] && ['aiming', 'answer'].includes(phase) && !paused) {
      event.preventDefault(); keys.add(event.code);
    }
    if (answerCodes.includes(event.code)) {
      event.preventDefault();
      if (!event.repeat) {
        if (phase === 'finished' && event.target === $('restart')) startGame();
        else answer();
      }
    }
  });

  document.addEventListener('keyup', (event) => keys.delete(event.code));
  element.querySelectorAll('[data-move]').forEach((button) => {
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

  return { startPractice, startGame, tick, pauseGame: () => { paused = true; }, resumeGame: () => { paused = false; lastTime = undefined; } };
}