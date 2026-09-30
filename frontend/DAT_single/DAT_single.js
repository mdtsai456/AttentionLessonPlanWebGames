// 1. 取得網址模式與設定
const urlParams = new URLSearchParams(window.location.search);
const isPractice = urlParams.get('mode') === 'practice';

// 全域時間與參數設定
const ROUND_MS = 4000;        // 單題倒數
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


//隨機的題目生成
// 色名與代表顏色的 Hex 碼對照
const COLOR_OPTIONS = [
  { name: '紅色', code: '#c52c35' },
  { name: '藍色', code: '#1e88e5' },
  { name: '綠色', code: '#168047' },
  { name: '黃色', code: '#f5e500' },
  { name: '黑色', code: '#212121' },
  { name: '紫色', code: '#8e24aa' }
];

// 1. 生成隨機顏色題目
function generateColorQuestion() {
  const isTrue = Math.random() < 0.5; // 50% 機率正確、50% 機率錯誤
  const textObj = COLOR_OPTIONS[Math.floor(Math.random() * COLOR_OPTIONS.length)];
  let colorObj = textObj;

  if (!isTrue) {
    // 當答案為假時，從剩餘顏色中挑選一個不同的字色
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

// 2. 生成隨機數學算式題目
function generateMathQuestion() {
  const isTrue = Math.random() < 0.5;
  const isAddition = Math.random() < 0.5; // 隨機加法或減法
  let num1, num2, actualResult, displayResult;

  if (isAddition) {
    num1 = Math.floor(Math.random() * 10) + 1; // 1 ~ 10
    num2 = Math.floor(Math.random() * 10) + 1;
    actualResult = num1 + num2;
  } else {
    num1 = Math.floor(Math.random() * 15) + 5; // 5 ~ 19
    num2 = Math.floor(Math.random() * num1) + 1; // 確保結果為正數
    actualResult = num1 - num2;
  }

  if (isTrue) {
    displayResult = actualResult;
  } else {
    // 答案錯誤時，隨機加減 1 或 2 作為干擾項
    const offset = (Math.random() < 0.5 ? 1 : -1) * (Math.floor(Math.random() * 2) + 1);
    displayResult = actualResult + offset;
    if (displayResult <= 0) displayResult = actualResult + 3; // 避免出現小於等於 0 的不合理答案
  }

  const operator = isAddition ? '+' : '−';
  return {
    type: '數學判斷：算式答案是否正確？',
    text: `${num1} ${operator} ${num2} = ${displayResult}`,
    color: '#65462f', // 數學題統一字體顏色
    answer: isTrue
  };
}

// 3. 混合生成指定數量題目
function generateRandomQuestions(count = 10) {
  const list = [];
  for (let i = 0; i < count; i++) {
    // 50% 機率抽顏色題，50% 機率抽數學題
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

function finishGame() {
  phase = 'finished';
  keys.clear(); pointerDirections.clear();
  $('pause').disabled = true;
  $('final-score').textContent = `${score} / ${questions.length} 分`;
  $('summary').textContent = `誤按 ${wrong} 題・判斷正確但未瞄準 ${offTarget} 題・漏答 ${timedOut} 題`;
  $('accuracy').textContent = `得分率 ${Math.round(score / questions.length * 100)}%`;

  const $startGameBtn =$('btn-start-game'); // 取得結束選單的第二個按鈕

  if (isPractice) {
    $('result-title').textContent = '練習結束';
    
    // 按鈕一：再練習一次
    $('restart').textContent = '再練習一次';
    $('restart').onclick = startGame;

    // 按鈕二：進入正式遊戲
    if ($startGameBtn) {$startGameBtn.hidden = false;
      $startGameBtn.textContent = '進入正式遊戲';
      $startGameBtn.onclick = () => {
        window.location.href = 'DAT_single.html?mode=game';
      };
    }
  } else {
    $('result-title').textContent = '挑戰完成！';
    
    // 按鈕一：再玩一次
    $('restart').textContent = '再玩一次';
    $('restart').onclick = startGame;

    // 按鈕二：返回登入首頁 (跳轉到 Home/index.html)
    if ($startGameBtn) {$startGameBtn.hidden = false;
      $startGameBtn.textContent = '返回遊戲大廳';
      $startGameBtn.onclick = () => {
        window.location.href = '../../Home/index.html';
      };
    }

    // 呼叫 API 上傳資料庫 (僅正式模式)
    saveGameDataToBackend({
      score: score,
      wrong: wrong,
      offTarget: offTarget,
      timedOut: timedOut,
      accuracy: Math.round(score / questions.length * 100)
    });
  }

  $('results').hidden = false; 
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
        window.location.href = 'DAT_single.html?mode=game';
      };
    }
  } else {
    $('result-title').textContent = '挑戰完成！';
    $('restart').textContent = '再玩一次';
    $('restart').onclick = startGame;

    if ($startGameBtn) {$startGameBtn.hidden = false;
      $startGameBtn.textContent = '返回遊戲大廳';
      $startGameBtn.onclick = () => {
        window.location.href = '../../Home/index.html';
      };
    }

    // 呼叫 API 上傳資料庫 (補齊 duration 與 stage)
    saveGameDataToBackend({
      score: score,
      wrong: wrong,
      offTarget: offTarget,
      timedOut: timedOut,
      accuracy: Math.round(score / questions.length * 100),
      duration: Date.now() - gameStartTime, // 補上毫秒數
      stage: STAGE_COUNT                    // 補上總關卡數
    });
  }

  $('results').hidden = false; 
}

async function saveGameDataToBackend(data) {
  const url = "http://127.0.0.1:5002/api/sessions";//https://attention-lesson-plan-transfer-data.zeabur.app/api/sessions


  const grade = sessionStorage.getItem('grade') || 'G1';
  const caseId = sessionStorage.getItem('caseId') || 'S03';
  const school = sessionStorage.getItem('school') || 'KMU'; // ⚠️ 需嚴格符合 KMU 或 NTHU-01~07
  const currentDay = parseInt(sessionStorage.getItem('currentDay') || '1', 10);

  const payload = {
    lessonId: "1140908_DAT",
    data: {
      grade: grade,
      caseId: caseId,
      school: school,
      currentDay: currentDay,
      startTime: gameStartTime,
      endTime: Date.now(),
      mode: "single",
      stats: [
        { apiname: "DAT_correct",  value: data.score },
        { apiname: "DAT_wrong",    value: data.wrong },
        { apiname: "DAT_accuracy", value: data.accuracy / 100 },
        { apiname: "DAT_duration", value: data.duration }, // 正確對應傳入的 duration
        { apiname: "DAT_stage",    value: data.stage }    // 正確對應傳入的 stage
      ]
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.status === 201) {
      const result = await res.json();
      console.log('✅ [API 成功] 資料已成功寫入資料庫！Session ID:', result.sessionId);
    } else {
      const errData = await res.json().catch(() => ({}));
      console.error(`❌ [API 錯誤 ${res.status}]:`, errData.detail || '寫入失敗');
    }
  } catch (err) {
    console.error('❌ [API 網路連線異常]:', err);
  }
}

// assets api
// 新增 API 抓取學生自訂素材函式
async function fetchStudentAssets() {
  // 從 sessionStorage 取得學生 ID（與 saveGameDataToBackend 的邏輯保持一致）
  const studentId = sessionStorage.getItem('caseId') || sessionStorage.getItem('student1_case') || 'S001';
  const apiUrl = `https://attention-lesson-plan-assets.zeabur.app/api/students/${studentId}/assets`;

  try {
    const res = await fetch(apiUrl);
    if (res.ok) {
      const data = await res.json();
      
      // 依據 API 實際回傳格式進行調整：
      // 假設回傳物件格式如 { animalUrl: "https://..." }
      if (data && data.animalUrl) {
        return data.animalUrl;
      }
      
      // 假設回傳陣列格式如 [{ type: "animal", url: "https://..." }]
      if (Array.isArray(data) && data.length > 0) {
        const animalAsset = data.find(item => item.type === 'animal' || item.category === 'animal');
        if (animalAsset && animalAsset.url) return animalAsset.url;
      }
    }
  } catch (err) {
    console.warn('⚠️ 抓取學生自訂素材失敗，將套用預設素材：', err);
  }

  // 發生錯誤或無設定時的預設圖片
  return 'assets/animals/rabbit.png';
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
  paused = !paused; lastTime = undefined;
  keys.clear(); pointerDirections.clear();
  $('pause').textContent = paused ? '繼續' : '暫停';
  enableAnswers(!paused && phase === 'answer' && !submitted);
});

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

// ==================== 依據流程圖實作：動態載入學生素材 ====================

const ASSET_SERVER_HOST = 'https://attention-lesson-plan-assets.zeabur.app';
const DEFAULT_ANIMAL_PATH = 'assets/animals/rabbit.png';

// 【流程步驟 1 & 2】：遊戲 Call API 取得素材網址
async function fetchStudentAssets() {
  // 1. 取得 Student ID（相容 "S001" 或 "G1_S070" 格式）
  const rawId = sessionStorage.getItem('caseId') || sessionStorage.getItem('student1_case') || 'S001';
  const studentId = rawId.includes('_') ? rawId.split('_').pop() : rawId;

  const apiUrl = `${ASSET_SERVER_HOST}/api/students/${studentId}/assets`;
  console.log(`[流程 1] 遊戲 Call API: GET ${apiUrl}`);

  try {
    const res = await fetch(apiUrl);
    if (res.ok) {
      const data = await res.json();
      console.log('[流程 2] API 回傳結構:', data);

      // 【流程步驟 3】：拿到圖片 relative URL (例如 /uploads/S001/DAT/xxxxx.png)
      const relativeUrl = data?.DAT?.assets?.files?.[0];

      if (relativeUrl) {
        // 組合完整可下載的網址
        const fullUrl = relativeUrl.startsWith('http') 
          ? relativeUrl 
          : `${ASSET_SERVER_HOST}${relativeUrl.startsWith('/') ? '' : '/'}${relativeUrl}`;

        console.log(`[流程 3] 成功拿到圖片完整 URL: ${fullUrl}`);
        return fullUrl;
      }
    }
  } catch (err) {
    console.warn('⚠️ API 請求異常，開啟預設素材容錯:', err);
  }

  console.warn('⚠️ 未找到專屬素材，退回使用預設圖檔');
  return DEFAULT_ANIMAL_PATH;
}

// 【流程步驟 4】：下載圖片（包含圖片 404/壞聯 的防護機制）
function downloadImage(src) {
  return new Promise((resolve) => {
    console.log(`[流程 4] 開始下載圖片: ${src}`);
    const img = new Image();

    img.onload = () => {
      console.log(`[流程 4] 圖片下載成功: ${src}`);
      resolve(src);
    };

    img.onerror = () => {
      console.warn(`⚠️ 圖片下載失敗 (404/壞聯)，切換為預設素材: ${src}`);
      resolve(DEFAULT_ANIMAL_PATH);
    };

    img.src = src;
  });
}

// 【流程步驟 5】：取代遊戲原本的固定素材並開始遊戲
async function initGameWorkflow() {
  console.log('🎮 遊戲開始，執行素材載入流程...');

  // A. Call API 拿到網址
  const animalAssetUrl = await fetchStudentAssets();

  // B. 下載背景、準心與動物素材
  const [bgSrc, crosshairSrc, finalAnimalSrc] = await Promise.all([
    downloadImage('assets/background.png'),
    downloadImage('assets/crosshair.png'),
    downloadImage(animalAssetUrl)
  ]);

  // C. 取代 DOM 元素原本的圖片素材 (#animal-image)
  const animalImgElem = $('animal-image');
  if (animalImgElem) {
    animalImgElem.src = finalAnimalSrc;
    console.log(`[流程 5] 成功取代遊戲原本的固定素材，目前套用: ${finalAnimalSrc}`);
  }

  // D. 啟動遊戲
  startGame();
}

// 執行主流程並啟動遊戲渲染
initGameWorkflow();
requestAnimationFrame(tick);


// 攔截瀏覽器關閉/重新整理事件
window.addEventListener('beforeunload', (event) => {
  // 只有在遊戲進行中 (aiming 或 answer 階段) 才觸發警告
  if (['aiming', 'answer'].includes(phase)) {
    event.preventDefault();
  }
});