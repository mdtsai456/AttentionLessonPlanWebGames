// 可調整每局題數與作答後的回饋時間。素材順序：上、下、左、右。
const TOTAL_ROUNDS = 20;
const MID_ROUND = 10;
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
let questions = [], index = 0, score = 0, phase = 'intro', timer;
let gameStartTime = 0;
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
function updateProgress() {
  $('progress-fill').style.height = `${index / TOTAL_ROUNDS * 100}%`;
  document.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', index);
}
function renderQuestion() {
  phase = 'memory';
  setEnabled(false);
  delete panel.dataset.result;
  $('feedback').textContent = '記住黃色泡泡的位置';
  $('round').textContent = `第 ${index + 1} / ${TOTAL_ROUNDS} 題`;
  const field = $('bubble-field');
  field.replaceChildren();
  const question = questions[index];
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
  timer = setTimeout(() => {
    field.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const direction = i === 0 ? question.direction : pick(['left', 'right']);
      const style = i === 0 ? question.style : Math.floor(Math.random() * styles.length);
      createBubble(positions[i], asset(style, direction, question.opposite),
        `泡泡：${question.opposite ? '紅色虛線，' : ''}箭頭向${direction === 'left' ? '左' : '右'}`);
    }
    // 三顆泡泡大小與外觀一致，不留下目標標籤或黃色提示。
    phase = 'answer';
    $('feedback').textContent = '回答剛才位置的泡泡';
    setEnabled(true);
  }, TARGET_MS);
}
function startGame() {
  clearTimeout(timer);
  index = 0; score = 0;
  gameStartTime = Date.now();
  // 四種條件平均分配，避免一局只有單一方向或規則。
  questions = shuffle(Array.from({ length: TOTAL_ROUNDS }, (_, i) => ({
    direction: i % 2 ? 'right' : 'left', opposite: Math.floor(i / 2) % 2 === 1,
    style: Math.floor(Math.random() * styles.length)
  })));
  $('score').textContent = '0 分';
  $('results').hidden = true;
  $('mid-break-modal').hidden = true;
  $('btn-continue').disabled = false;
  $('btn-lobby').disabled = false;
  updateProgress(); renderQuestion();
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
  $('mid-break-modal').hidden = true;
  $('final-score').textContent = `${score} / ${TOTAL_ROUNDS} 分`;
  $('accuracy').textContent = `答對 ${score} 題・正確率 ${Math.round(score / TOTAL_ROUNDS * 100)}%`;
  $('results').hidden = false;
  $('restart').focus();
  void saveCurrentRun(TOTAL_ROUNDS);
}

function saveCurrentRun(stage) {
  const total = Math.max(index, 1);
  return saveGameDataToBackend({
    score,
    wrong: Math.max(total - score, 0),
    accuracy: Math.round(score / total * 100),
    duration: Date.now() - gameStartTime,
    stage,
  });
}

async function saveGameDataToBackend(data) {
  const url = 'http://127.0.0.1:5001/api/sessions';
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
        { apiname: 'DAT_accuracy', value: data.accuracy / 100 },
        { apiname: 'DAT_duration', value: data.duration },
        { apiname: 'DAT_stage', value: data.stage },
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
function answer(direction) {
  if (phase !== 'answer') return;
  phase = 'feedback'; setEnabled(false);
  const question = questions[index];
  const expected = question.opposite ? (question.direction === 'left' ? 'right' : 'left') : question.direction;
  const correct = direction === expected;
  if (correct) score++;
  $('score').textContent = `${score} 分`;
  panel.dataset.result = correct ? 'correct' : 'wrong';
  $('feedback').textContent = correct ? '答對了！＋1 分' : `${question.opposite ? '虛線要反向！' : '再加油！'}應選${expected === 'left' ? '左 ←' : '右 →'}`;
  index++; updateProgress();
  timer = setTimeout(() => {
    if (index === MID_ROUND) {
      showMidBreak();
      return;
    }
    if (index < TOTAL_ROUNDS) {
      renderQuestion();
      return;
    }
    finishGame();
  }, FEEDBACK_MS);
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
$('restart').addEventListener('click', startGame);
$('btn-lobby-finish').addEventListener('click', returnToLobby);
$('btn-continue').addEventListener('click', () => {
  $('mid-break-modal').hidden = true;
  renderQuestion();
});
$('btn-lobby').addEventListener('click', async () => {
  $('btn-continue').disabled = true;
  $('btn-lobby').disabled = true;
  await saveCurrentRun(MID_ROUND);
  returnToLobby();
});
// 等圖片載入完成才開始，讓第一題也能完整顯示黃色目標一秒。
const targetImage = new Image();
targetImage.onload = startGame;
targetImage.onerror = () => { $('feedback').textContent = '目標泡泡圖片載入失敗，請重新整理'; };
targetImage.src = 'assets/arrow/目標泡泡.png';
