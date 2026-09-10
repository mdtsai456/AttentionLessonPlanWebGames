const movingRows = new Set();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

async function moveRow(row, direction) {
  if (movingRows.has(row)) return;
  movingRows.add(row);
  // Add the wrapping item outside the five visible cells for a continuous loop.
  const clone = (direction > 0 ? row.lastElementChild : row.firstElementChild).cloneNode(true);
  clone.setAttribute('aria-hidden', 'true');
  let animation;
  try {
    if (direction > 0) row.prepend(clone);
    else row.append(clone);
    row.style.gridTemplateColumns = 'repeat(6, 20%)';
    animation = row.animate(
      [{ transform: `translateX(${direction > 0 ? -20 : 0}%)` },
       { transform: `translateX(${direction > 0 ? 0 : -20}%)` }],
      { duration: reducedMotion.matches ? 0 : 280, easing: 'ease', fill: 'forwards' }
    );
    await animation.finished;
    clone.remove();
    if (direction > 0) row.prepend(row.lastElementChild);
    else row.append(row.firstElementChild);
  } finally {
    clone.remove();
    row.style.gridTemplateColumns = '';
    animation?.cancel();
    movingRows.delete(row);
  }
}

const keyBindings = {
  ArrowRight: ['shape-row', 1], ArrowLeft: ['sport-row', -1]
};
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  const binding = keyBindings[event.code];
  if (!binding) return;
  event.preventDefault();
  if (!event.repeat) moveRow(document.getElementById(binding[0]), binding[1]);
});
document.querySelectorAll('[data-row]').forEach((button) => {
  button.addEventListener('click', () => moveRow(document.getElementById(button.dataset.row), Number(button.dataset.direction)));
});

// Fixed question comes from the existing HTML; no random question generation.
const players = [...document.querySelectorAll('.player')].map((element) => {
  const feedback = document.createElement('div');
  feedback.className = 'round-feedback';
  feedback.setAttribute('role', 'status');
  element.append(feedback);
  const style = getComputedStyle(element);
  return {
    element,
    target: element.querySelector('.center-object'),
    rows: ['shape', 'sport'].map((kind) => ({
      window: element.querySelector(`.${kind}-window`),
      answer: element.querySelector(`.target-${kind}`).dataset.answer,
      label: kind === 'shape' ? '形狀' : '運動',
      result: null
    })),
    score: 0,
    scoreElement: element.querySelector('.score-value'),
    feedback,
    startX: parseFloat(style.getPropertyValue('--start-x')),
    endX: parseFloat(style.getPropertyValue('--end-x')),
    elapsed: 0,
    finished: false
  };
});

function checkRow(player, row) {
  const target = player.target.getBoundingClientRect();
  const centerX = (target.left + target.right) / 2;
  const windowRect = row.window.getBoundingClientRect();
  // Include visible wrapping clones: they are actual choices during a row slide.
  const candidates = [...row.window.querySelectorAll('img')].map((image) => {
    const rect = image.getBoundingClientRect();
    const left = Math.max(rect.left, windowRect.left);
    const right = Math.min(rect.right, windowRect.right);
    return { image, distance: Math.abs((rect.left + rect.right) / 2 - centerX),
      overlaps: right > left && target.right > left && target.left < right };
  }).filter((item) => item.overlaps).sort((a, b) => a.distance - b.distance);
  row.result = candidates[0]?.image.dataset.answer === row.answer;
  row.window.dataset.result = row.result ? 'correct' : 'wrong';
  player.feedback.textContent = `${row.label}${row.result ? '正確 ✓' : '錯誤 ✗'}`;
}

function updatePlayer(player, delta) {
  player.elapsed += delta;
  if (player.elapsed >= 11000) {
    player.elapsed = 0;
    player.finished = false;
    for (const row of player.rows) {
      row.result = null;
      delete row.window.dataset.result;
    }
  }
  // One second to prepare, eight seconds to approach, two seconds for feedback.
  const progress = Math.max(0, Math.min(1, (player.elapsed - 1000) / 8000));
  const y = 24.5 + 47.5 * progress;
  player.target.style.top = `${y}%`;
  player.target.style.left = `${player.startX + (player.endX - player.startX) * progress}%`;
  player.target.style.transform = `translate(-50%, -50%) scale(${.3 + .7 * progress})`;
  const bounds = player.element.getBoundingClientRect();
  for (const row of player.rows) {
    const rect = row.window.getBoundingClientRect();
    const lineY = ((rect.top + rect.bottom) / 2 - bounds.top) / bounds.height * 100;
    if (row.result === null && y >= lineY) checkRow(player, row);
  }
  if (!player.finished && player.rows.every((row) => row.result !== null)) {
    player.finished = true;
    const correct = player.rows.every((row) => row.result);
    if (correct) player.score += 1;
    player.scoreElement.textContent = `${player.score} 分`;
    player.feedback.textContent = correct ? '兩排都正確！＋1 分' :
      player.rows.map((row) => `${row.label}${row.result ? ' ✓' : ' ✗'}`).join('　');
  } else if (player.rows.every((row) => row.result === null)) {
    const label = [...player.target.querySelectorAll('img')].map((img) => img.alt).join('＋');
    const message = `請對準：${label}`;
    if (player.feedback.textContent !== message) player.feedback.textContent = message;
  }
}

let previousTime;
function tick(time) {
  // A background tab must not consume the player's answering time.
  const delta = previousTime === undefined ? 0 : Math.min(time - previousTime, 50);
  previousTime = time;
  if (!document.hidden) players.forEach((player) => updatePlayer(player, delta));
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
