// 目前固定四題：顏色兩題、簡單算式兩題。
const ROUND_MS = 4000;
const AIM_SPEED = 45;
const ANIMAL_SPEED = 4; // 原速度的三分之一，數值越小越慢。
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

function startGame() {
  questions = [
    { type: '顏色判斷：色名與字色是否相同？', text: '紅色', color: '#c52c35', answer: true },
    { type: '顏色判斷：色名與字色是否相同？', text: '藍色', color: '#168047', answer: false },
    { type: '數學判斷：算式答案是否正確？', text: '2 + 3 = 5', color: '#65462f', answer: true },
    { type: '數學判斷：算式答案是否正確？', text: '5 − 2 = 4', color: '#65462f', answer: false }
  ];
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
  $('question-type').textContent = '等待瞄準';
  $('question-text').textContent = '—';
  $('time-text').textContent = '尚未開始';
  $('time-fill').style.width = '100%';
  $('feedback').textContent = '將準心移到動物身上，開始遊戲';
  $('animal').dataset.result = '';
  enableAnswers(false);
  updateProgress(); renderPositions();
}

function enableAnswers(enabled) {
  answerButtons.forEach((button) => { button.disabled = !enabled; });
}

function updateProgress() {
  $('score').textContent = `${score} 分`;
  $('round').textContent = `第 ${Math.min(index + 1, questions.length)} / ${questions.length} 題`;
  $('progress').setAttribute('aria-valuemax', questions.length);
  $('progress').setAttribute('aria-valuenow', index);
  $('progress-fill').style.height = `${index / questions.length * 100}%`;
}

function renderPositions() {
  for (const [id, position] of [['animal', animal], ['crosshair', aim]]) {
    $(id).style.left = `${position.x}%`;
    $(id).style.top = `${position.y}%`;
  }
}

// 使用圖片透明度判定準心中心是否落在動物身上，透明空白不算命中。
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
  // 作答後仍繼續追蹤與倒數，每題只記錄一次反應。
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

function endQuestion() {
  // 未按鍵時於倒數結束判定：題目不正確且此時瞄準才得分。
  if (!submitted) recordResult(false);
  const message = $('feedback').textContent;
  index++;
  updateProgress();
  if (index < questions.length) {
    showQuestion();
    $('feedback').textContent = `上一題：${message}`;
  } else finishGame();
}

function finishGame() {
  phase = 'finished';
  keys.clear(); pointerDirections.clear();
  $('pause').disabled = true;
  $('final-score').textContent = `${score} / ${questions.length} 分`;
  $('summary').textContent = `誤按 ${wrong} 題・判斷正確但未瞄準 ${offTarget} 題・漏答 ${timedOut} 題`;
  $('accuracy').textContent = `得分率 ${Math.round(score / questions.length * 100)}%`;
  $('results').hidden = false; $('restart').focus();
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
  // 起始瞄準階段不移動；首次對準後，動物沿平緩曲線持續移動。
  if (phase === 'answer') {
    animal.motion = (animal.motion || 0) + ANIMAL_SPEED * delta / 1000 / 30;
    // 正弦曲線在轉彎處自然減速，不會碰邊突然反彈。
    animal.x = 55 + 28 * Math.sin(animal.motion);
    animal.y = 50 + 15 * Math.sin(animal.motion * .8);
  }
  renderPositions();
}

function tick(time) {
  const delta = lastTime === undefined ? 0 : Math.max(0, time - lastTime);
  lastTime = time;
  if (!paused && !document.hidden && ['aiming', 'answer'].includes(phase)) {
    // 小步更新避免動物在低幀率時越過邊界。
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
    event.preventDefault(); $('restart').focus();
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

Promise.all(['assets/background.png', 'assets/crosshair.png', 'assets/animals/rabbit.png'].map((src) =>
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
