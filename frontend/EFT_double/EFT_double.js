// 可調整每局題數與作答後的回饋時間。素材順序：上、下、左、右。
const TOTAL_ROUNDS = 20;
const FEEDBACK_MS = 1100;
const TARGET_MS = 1000;
const styles = [
  { normal: 6122, opposite: 6118 },
  { normal: 6130, opposite: 6126 },
  { normal: 6138, opposite: 6134 },
  { normal: 6146, opposite: 6142 }
];
function createPlayer(element, keyBindings) {
  const $ = (id) => element.querySelector(`[data-ui="${id}"]`);
  const buttons = [...element.querySelectorAll('[data-direction]')];
  const panel = element.querySelector('.answer-panel');
  let questions = [], index = 0, score = 0, phase = 'intro', timer;
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
    element.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', index);
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
    // 四種條件平均分配，避免一局只有單一方向或規則。
    questions = shuffle(Array.from({ length: TOTAL_ROUNDS }, (_, i) => ({
      direction: i % 2 ? 'right' : 'left', opposite: Math.floor(i / 2) % 2 === 1,
      style: Math.floor(Math.random() * styles.length)
    })));
    $('score').textContent = '0 分';
    $('results').hidden = true;
    updateProgress(); renderQuestion();
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
      if (index < TOTAL_ROUNDS) { renderQuestion(); }
      else {
        phase = 'finished';
        $('final-score').textContent = `${score} / ${TOTAL_ROUNDS} 分`;
        $('accuracy').textContent = `答對 ${score} 題・正確率 ${Math.round(score / TOTAL_ROUNDS * 100)}%`;
        $('results').hidden = false;
      }
    }, FEEDBACK_MS);
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
  return { startGame, answer };
}

// 兩位玩家的題目、計時與分數各自獨立。
const players = [
  createPlayer(document.querySelector('.player-1'), { KeyA: 'left', KeyD: 'right' }),
  createPlayer(document.querySelector('.player-2'), { ArrowLeft: 'left', ArrowRight: 'right' })
];

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
