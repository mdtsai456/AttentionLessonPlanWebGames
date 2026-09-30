import { sendSessionToApi } from './api.js';
import { generateQuestionSet } from './questions.js';

export const ROUND_MS = 10000;
export const AIM_SPEED = 45;
export const ANIMAL_SPEED = 4;
export const TOTAL_STAGES = 6;
const STAGE_MS = 60000;
const PRACTICE_STAGES = 1;
const PRACTICE_QUESTIONS = 2;
const GAME_QUESTIONS = 3;

export function createPlayer(element, bindings, answerCodes, answerLabel, playerIndex, getState) {
  const $ = (id) => element.querySelector(`[data-ui="${id}"]`);

  const backHomeBtn = $('back-home');
  if (backHomeBtn) {
    backHomeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      getState().safeNavigateTo('../Select/index.html');
    });
  }

  $('pause').addEventListener('click', () => {
    if (getState().playMode === 'game') return;
    paused = !paused;
    lastTime = undefined;
    keys.clear();
    pointerDirections.clear();
    $('pause').textContent = paused ? '繼續' : '暫停';
    enableAnswers(!paused && phase === 'answer' && !submitted);
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

  let stageCount = TOTAL_STAGES;
  let questionsPerStage = GAME_QUESTIONS;
  let stageHits = [];
  let levelAccuracies = [];
  let reactionSamples = [];
  let activeMs = 0;
  let focusMs = 0;
  let clearedMidBreak = false;
  let stageDeadline = 0;

  // 雙人彩蛋機制變數與切換函式
  let animalAssetList = [];
  let currentAssetIndex = 0;
  let consecutiveCorrect = 0;

  function setAnimalAssets(list) {
    animalAssetList = list;
    currentAssetIndex = 0;
    const imgElem = element.querySelector('#animal-image, [data-ui="animal-image"], .animal-image');
    if (imgElem && animalAssetList.length > 0) {
      imgElem.src = animalAssetList[0];
    }
  }

  // 通用更新動物圖片動畫函式
  function updateAnimalImage(nextAssetUrl) {
    const imgElem = element.querySelector('#animal-image, [data-ui="animal-image"], .animal-image');
    if (imgElem) {
      imgElem.style.transition = 'transform 0.2s ease-in-out, opacity 0.2s ease-in-out';
      imgElem.style.opacity = '0.2';
      imgElem.style.transform = 'scale(0.6)';

      setTimeout(() => {
        imgElem.src = nextAssetUrl;
        imgElem.style.opacity = '1';
        imgElem.style.transform = 'scale(1)';
      }, 150);
    }
  }

  // 升級：切換至下一個動物素材（達到上限則維持在最大值）
  function switchToNextAnimal() {
    if (!animalAssetList || animalAssetList.length <= 1) return;
    if (currentAssetIndex < animalAssetList.length - 1) {
      currentAssetIndex++;
      console.log(`🎉 [P${playerIndex + 1} 升級] 切換至素材 (${currentAssetIndex + 1}/${animalAssetList.length}): ${animalAssetList[currentAssetIndex]}`);
      updateAnimalImage(animalAssetList[currentAssetIndex]);
    }
  }

  // 降級：退回上一個動物素材（直到 index = 0）
  function switchToPrevAnimal() {
    if (!animalAssetList || animalAssetList.length <= 1) return;
    if (currentAssetIndex > 0) {
      currentAssetIndex--;
      console.log(`💔 [P${playerIndex + 1} 降級] 退回至素材 (${currentAssetIndex + 1}/${animalAssetList.length}): ${animalAssetList[currentAssetIndex]}`);
      updateAnimalImage(animalAssetList[currentAssetIndex]);
    }
  }

  function loadStageQuestions() {
    questions = generateQuestionSet(isPractice ? questionsPerStage : 1, isPractice);
  }

  function startPractice() {
    isPractice = true;
    stageCount = PRACTICE_STAGES;
    questionsPerStage = PRACTICE_QUESTIONS;
    currentStage = 1;
    getState().playerPracticeFinished[playerIndex] = false;
    questions = generateQuestionSet(questionsPerStage, true);
    stageDeadline = 0;

    resetPlayerState(true);
    $('field').dataset.mode = 'practice';$('results').hidden = true;
    $('question-type').textContent = '等待瞄準';
    $('question-text').textContent = '—';$('time-text').textContent = '尚未開始';
    $('time-fill').style.width = '100\%';$('feedback').textContent = `請先移動準心重疊動物；重疊後按 ${answerLabel} 作答`;
    $('animal').dataset.result = '';
    enableAnswers(false);
    updateProgress(); renderPositions();
  }

  function startGame() {
    isPractice = false;
    stageCount = TOTAL_STAGES;
    questionsPerStage = GAME_QUESTIONS;
    currentStage = 1;
    clearedMidBreak = false;
    startTimeMs = Date.now();
    
    score = wrong = offTarget = timedOut = elapsed = 0;
    stageHits = [];
    levelAccuracies = [];
    reactionSamples = [];
    activeMs = 0;
    focusMs = 0;

    loadStageQuestions();
    totalStageQuestionsCount = 0;
    stageDeadline = 0;
    
    resetPlayerState(false);
    
    $('field').dataset.mode = 'game';$('results').hidden = true;
    $('pause').disabled = false;
    $('pause').textContent = '暫停';
    $('question-type').textContent = '等待瞄準';
    $('question-text').textContent = '—';$('time-text').textContent = '尚未開始';
    $('time-fill').style.width = '100\%';$('feedback').textContent = '將準心移到動物身上，開始遊戲';
    $('animal').dataset.result = '';
    enableAnswers(false);
    updateProgress(); renderPositions();
  }

  function resetPlayerState(resetScore = true, resetAnimal = true) {
    if (resetScore) {
      score = wrong = offTarget = timedOut = 0;
    }
    index = 0;
    
    //只有在重新開始遊戲或練習時才重置彩蛋，跨關卡時保留當前動物等級
    if (resetAnimal) {
      consecutiveCorrect = 0;
      currentAssetIndex = 0;
      if (animalAssetList.length > 0) {
        const imgElem = element.querySelector('#animal-image, [data-ui="animal-image"], .animal-image');
        if (imgElem) imgElem.src = animalAssetList[0];
      }
    }

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
    if (isPractice) {
      $('round').textContent = `第 ${Math.min(index + 1, questions.length)} / ${questions.length} 題 (練習關卡)`;
      $('progress').setAttribute('aria-valuemax', questions.length);
      $('progress').setAttribute('aria-valuenow', index);$('progress-fill').style.height = `${questions.length ? (index / questions.length) * 100 : 0}%`;
      return;
    }
    const left = stageDeadline
      ? Math.max(0, Math.ceil((stageDeadline - Date.now()) / 1000))
      : STAGE_MS / 1000;
    const used = stageDeadline ? Math.min(STAGE_MS, Date.now() - (stageDeadline - STAGE_MS)) : 0;
    const ratio = ((currentStage - 1) + used / STAGE_MS) / stageCount;
    $('round').textContent = `第 ${index + 1} 題・剩餘 ${left} 秒（第 ${currentStage} / ${stageCount} 關）`;
    $('progress').setAttribute('aria-valuemax', 100);
    $('progress').setAttribute('aria-valuenow', Math.round(ratio * 100));$('progress-fill').style.height = `${Math.min(100, ratio * 100)}%`;
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
    const imgElem = element.querySelector('#animal-image, [data-ui="animal-image"], .animal-image') || $('animal-image');
    const rect = imgElem.getBoundingClientRect();
    const field = $('field').getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const left = rect.left + (rect.width - size) / 2;
    const top = rect.top + (rect.height - size) / 2;
    const x = Math.floor((field.left + aim.x / 100 * field.width - left) / size * animalPixels.width);
    const y = Math.floor((field.top + aim.y / 100 * field.height - top) / size * animalPixels.height);
    if (x < 0 || y < 0 || x >= animalPixels.width || y >= animalPixels.height) return false;
    return animalPixels.rows[y][x] === '1';
  }

  function answerLimitMs() {
    // 修改會在每關最後一秒跑很多題目的問題
    return ROUND_MS;
  }

  function showQuestion() {
    if (!isPractice && !stageDeadline) stageDeadline = Date.now() + STAGE_MS;
    phase = 'answer'; elapsed = 0; submitted = false;
    const q = questions[index];
    $('question-type').textContent = q.type;
    $('question-text').textContent = q.text;
    $('question-text').style.color = q.color;
    $('animal').dataset.result = '';$('feedback').textContent = `題目正確按 ${answerLabel}；不正確則不按`;
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

  function recordResult(pressed) {
    const correct = pressed === questions[index].answer;
    const onTarget = isOnAnimal();
    const isSuccess = correct && onTarget;
    let message;
    reactionSamples.push(elapsed);

    if (isSuccess) {
      consecutiveCorrect++;
      score++;
      message = pressed ? '瞄準且答對！＋1 分' : '正確等待且保持瞄準！＋1 分';

      // 🔥 連續答對 5 題：觸發升級彩蛋（達最大值不再循環，直接維持）
      if (consecutiveCorrect > 0 && consecutiveCorrect % 5 === 0) {
        if (currentAssetIndex < animalAssetList.length - 1) {
          message += ` 🎉 連續答對 ${consecutiveCorrect} 題！變身新動物！`;
          switchToNextAnimal();
        } else {
          message += ` 🎉 連續答對 ${consecutiveCorrect} 題！維持最高級動物狀態！`;
        }
      }
    } else {
      consecutiveCorrect = 0; // 重置連擊計數器

      // 💔 答錯、未瞄準或漏答：觸發降級退回上一張動物（最低退至第 0 張）
      if (currentAssetIndex > 0) {
        switchToPrevAnimal();
      }

      if (!pressed && !correct) {
        timedOut++;
        wrong++;
        message = `漏答：正確的題目要按 ${answerLabel}`;
      } else if (!correct) {
        wrong++; message = '誤按：不正確的題目不需要按鍵';
      } else if (!onTarget) {
        offTarget++; message = '判斷正確，但準心未對到動物，不計分';
      }
    }

    $('animal').dataset.result = isSuccess ? 'correct' : 'wrong';
    $('feedback').textContent = message;
    stageHits.push(Boolean(isSuccess));
    updateProgress();
  }

  function commitStageAccuracy() {
    if (isPractice || !stageHits.length) return;
    const hits = stageHits.filter(Boolean).length;
    levelAccuracies[currentStage - 1] = hits / stageHits.length;
    stageHits = [];
  }

  function eftStats(stage, durationMs) {
    const metrics = sessionMetrics();
    return [
      { apiname: 'EFT_correct', value: score },
      { apiname: 'EFT_wrong', value: wrong },
      { apiname: 'EFT_accuracy', value: metrics.accuracy },
      { apiname: 'EFT_duration', value: durationMs },
      { apiname: 'EFT_stage', value: stage },
      { apiname: 'EFT_levelAccuracy', value: levelAccuracyText(stage) },
      { apiname: 'EFT_avgReactionMs', value: metrics.avgReactionMs },
      { apiname: 'EFT_questionCount', value: metrics.questionCount },
      { apiname: 'EFT_aimRatio', value: metrics.aimRatio },
      { apiname: 'EFT_focusMs', value: metrics.focusMs },
    ];
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

  function levelAccuracyText(stage) {
    return levelAccuracies
      .slice(0, stage)
      .map((value) => Number(value.toFixed(4)))
      .join(',');
  }

  function beginNextStage() {
    currentStage++;
    stageDeadline = 0;
    resetPlayerState(false, false);
    loadStageQuestions();

    $('question-type').textContent = `第 ${currentStage} 關過場`;
    $('question-text').textContent = '🎯 請移動準心重新瞄準動物';
    $('question-text').style.color = '#a253d5';
    $('time-text').textContent = '尚未開始';
    $('time-fill').style.width = '100\%';$('feedback').textContent = `恭喜通過第 ${currentStage - 1} 關！請重新瞄準動物`;
    $('animal').dataset.result = '';
    enableAnswers(false);
    updateProgress();
    renderPositions();
  }

  function endQuestion() {
    if (phase !== 'answer') return;
    phase = 'resolving';
    if (!submitted) recordResult(false);
    const message = $('feedback').textContent;
    index++;
    updateProgress();

    const stageOver = !isPractice && stageDeadline && Date.now() >= stageDeadline - 20;
    if (!stageOver && (isPractice ? index < questions.length : true)) {
      if (!isPractice && index >= questions.length) {
        questions.push(...generateQuestionSet(1, false));
      }
      if (index < questions.length) {
        showQuestion();
        $('feedback').textContent = `上一題：${message}`;
        return;
      }
    }

    commitStageAccuracy();
    if (isPractice) {
      finishPractice();
    } else if (currentStage < stageCount) {
      if (currentStage === 3 && !clearedMidBreak) {
        phase = 'mid_break';
        enableAnswers(false);
        $('feedback').textContent = '第 3 關已結束，等待另一位玩家';
        getState().waitForMidBreak(playerIndex, () => {
          clearedMidBreak = true;
          beginNextStage();
        });
        return;
      }
      phase = 'stage_clear';
      enableAnswers(false);
      $('feedback').textContent = `第 ${currentStage} 關已結束，等待另一位玩家`;
      getState().waitForStageClear(playerIndex, currentStage, () => {
        beginNextStage();
      });
    } else {
      finishGame();
    }
  }

  function finishPractice() {
    phase = 'practice_done';
    enableAnswers(false);
    $('question-type').textContent = '【練習完成】';
    $('question-text').textContent = '練習完成';
    $('question-text').style.color = '#328647';
    $('feedback').textContent = '練習結束。這段不會寫入進度。';
  }

  async function finishGame() {
    phase = 'finished';
    endTimeMs = Date.now();
    keys.clear(); pointerDirections.clear();

    const answered = Math.max(score + wrong + offTarget, 1);
    const accuracyValue = parseFloat((score / answered).toFixed(2));
    const durationMs = endTimeMs - startTimeMs;

    $('pause').disabled = true;
    $('final-score').textContent = `${score} / ${answered} 分`;
    $('summary').textContent = `累計誤按 ${wrong} 題・未瞄準 ${offTarget} 題・漏答 ${timedOut} 題`;
    $('accuracy').textContent = `總得分率 ${Math.round(accuracyValue * 100)}%`;
    $('results').hidden = false;

    const isP1 = (playerIndex === 0);
    const studentKey = sessionStorage.getItem(isP1 ? "student1_key" : "student2_key") || "";
    const schoolKey  = sessionStorage.getItem(isP1 ? "student1_school" : "student2_school") || "KMU";
    const gradeKey   = sessionStorage.getItem(isP1 ? "student1_grade" : "student2_grade") || "G1";
    const caseId =
      sessionStorage.getItem(isP1 ? "student1_case" : "student2_case") ||
      (studentKey.includes("_") ? studentKey.slice(studentKey.indexOf("_") + 1) : studentKey) ||
      (isP1 ? "S01" : "S02");
    const currentDay = parseInt(sessionStorage.getItem("current_day") || "1", 10);

    const payload = {
      lessonId: "1140908_EFT",
      data: {
        grade: gradeKey,
        caseId: caseId,
        school: schoolKey,
        currentDay: currentDay,
        startTime: startTimeMs,
        endTime: endTimeMs,
        mode: "double",
        pairId: getState().currentGamePairId,
        stats: eftStats(stageCount, durationMs)
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
      activeMs += delta;
      if (isOnAnimal()) focusMs += delta;
      let remaining = Math.min(delta, 5000);
      while (remaining > 0) { const step = Math.min(remaining, 20); move(step); remaining -= step; }
      if (phase === 'aiming') {
        if (isOnAnimal()) showQuestion();
      } else if (phase === 'answer') {
        elapsed = Math.min(answerLimitMs(), elapsed + delta);
        updateClock();
        

        // 修改會在每關最後一秒跑很多題目的問題
        const isStageTimeout = !isPractice && stageDeadline && Date.now() >= stageDeadline;
        if (elapsed >= answerLimitMs() || isStageTimeout) {
          endQuestion();
        }
      }
      if (!isPractice && (phase === 'aiming' || phase === 'answer')) updateProgress();
    }
    requestAnimationFrame(tick);
  }

  $('answer-true').addEventListener('click', answer);$('restart').addEventListener('click', startGame);

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

  function completedStages() {
    if (isPractice || phase === 'practice_done') return 0;
    if (phase === 'finished') return stageCount;
    if (phase === 'mid_break' || phase === 'stage_clear') return currentStage;
    return Math.max(0, currentStage - 1);
  }

  async function saveRun(stage) {
    const isP1 = playerIndex === 0;
    const studentKey = sessionStorage.getItem(isP1 ? 'student1_key' : 'student2_key') || '';
    const schoolKey = sessionStorage.getItem(isP1 ? 'student1_school' : 'student2_school') || 'KMU';
    const gradeKey = sessionStorage.getItem(isP1 ? 'student1_grade' : 'student2_grade') || 'G1';
    const caseId =
      sessionStorage.getItem(isP1 ? 'student1_case' : 'student2_case') ||
      (studentKey.includes('_') ? studentKey.slice(studentKey.indexOf('_') + 1) : studentKey) ||
      (isP1 ? 'S01' : 'S02');
    const currentDay = parseInt(sessionStorage.getItem('current_day') || '1', 10);
    await sendSessionToApi({
      lessonId: '1140908_EFT',
      data: {
        grade: gradeKey,
        caseId,
        school: schoolKey,
        currentDay,
        startTime: startTimeMs || Date.now(),
        endTime: Date.now(),
        mode: 'double',
        pairId: getState().currentGamePairId,
        stats: eftStats(stage, Date.now() - (startTimeMs || Date.now())),
      },
    });
  }

  return {
    startPractice,
    startGame,
    tick,
    completedStages,
    saveRun,
    setAnimalAssets,
    pauseGame: () => { paused = true; },
    resumeGame: () => { paused = false; lastTime = undefined; },
  };
}