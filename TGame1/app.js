// =============================================================================
// TGame1 / 勇闖迷宮
// 每個路口都是同一張 T 型背景。按鍵時先切到靠近圖，再切左右轉視角，
// 角色同步往前走並換成側身；落地後回到 TGameBack，只換牆上物品與題目。
// =============================================================================

const TIME_LIMIT_SEC = 60;
const WALK_FRAME_MS = 90;
const TURN_WALK_FRAME_MS = 130;
const NEAR_MS = 1080;
const TURN_MS = 650;
const ARRIVE_MS = 320;
const PROGRESS_STEPS = [0, 50, 100];
const PLAYER_BACK = "img/playerBack.png";
const PLAYER_TURN = {
  left: "img/playerTurnLeft.png",
  right: "img/playerTurnRight.png",
};
const PLAYER_WALK_BACK = Array.from(
  { length: 12 },
  (_, index) => `img/walk/playerBackWalk${String(index + 1).padStart(2, "0")}.png`
);
const PLAYER_WALK_TURN = {
  left: Array.from(
    { length: 5 },
    (_, index) =>
      `img/walkLeft/playerTurnLeftWalk${String(index + 1).padStart(2, "0")}.png`
  ),
  right: Array.from(
    { length: 5 },
    (_, index) =>
      `img/walkRight/playerTurnRightWalk${String(index + 1).padStart(2, "0")}.png`
  ),
};
const SCENE_TURN = {
  left: "turn-left",
  right: "turn-right",
};

const scene = document.getElementById("scene");
const bgLayers = document.querySelectorAll(".bg");
const player = document.getElementById("player");
const itemLeft = document.getElementById("item-left");
const itemRight = document.getElementById("item-right");
const playerImg = document.getElementById("player-img");
const playerPlaceholder = document.getElementById("player-placeholder");
const scoreBox = document.getElementById("score-box");
const timerBox = document.getElementById("timer-box");
const promptEl = document.getElementById("prompt");
const feedbackEl = document.getElementById("feedback");
const resultEl = document.getElementById("result");
const resultTitle = document.getElementById("result-title");
const resultScore = document.getElementById("result-score");
const resultHint = document.getElementById("result-hint");
const replayBtn = document.getElementById("replay-btn");
const backBtn = document.getElementById("back-btn");

const LOCAL_QUESTIONS = [
  {
    id: "q1",
    prompt: "請選擇符合「可以吃的食物」的方向",
    leftItem: "apple",
    rightItem: "boot",
    correct: "left",
  },
  {
    id: "q2",
    prompt: "請選擇符合「可以吃的食物」的方向",
    leftItem: "book",
    rightItem: "banana",
    correct: "right",
  },
  {
    id: "q3",
    prompt: "請選擇符合「可以坐的家具」的方向",
    leftItem: "chair",
    rightItem: "fish",
    correct: "left",
  },
  {
    id: "q4",
    prompt: "請選擇符合「可以吃的食物」的方向",
    leftItem: "hammer",
    rightItem: "carrot",
    correct: "right",
  },
  {
    id: "q5",
    prompt: "請選擇符合「可以戴在頭上」的方向",
    leftItem: "hat",
    rightItem: "key",
    correct: "left",
  },
  {
    id: "q6",
    prompt: "請選擇符合「下雨時用的」的方向",
    leftItem: "soccer",
    rightItem: "umbrella",
    correct: "right",
  },
  {
    id: "q7",
    prompt: "請選擇符合「水裡游的動物」的方向",
    leftItem: "fish",
    rightItem: "boot",
    correct: "left",
  },
  {
    id: "q8",
    prompt: "請選擇符合「用來閱讀的」的方向",
    leftItem: "book",
    rightItem: "hammer",
    correct: "left",
  },
];

const state = {
  questions: [],
  index: 0,
  score: 0,
  remaining: TIME_LIMIT_SEC,
  busy: false,
  playing: false,
  answers: [],
  startedAt: 0,
  timerId: null,
  walkTimer: null,
  walkFrame: 0,
  endReason: "",
};

playerImg.addEventListener("error", showPlayerPlaceholder);
playerImg.addEventListener("load", hidePlayerPlaceholder);

replayBtn.addEventListener("click", () => {
  startGame();
});

backBtn.addEventListener("click", () => {
  location.href = "../Select/index.html";
});

document.addEventListener("keydown", (event) => {
  if (!state.playing || state.busy) return;

  if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
    event.preventDefault();
    chooseDirection("left");
  } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
    event.preventDefault();
    chooseDirection("right");
  }
});

init();

async function init() {
  preloadSceneImages();
  const data = await fetchQuestions();
  state.questions = data.questions;
  startGame(data.timeLimitSec);
}

function startGame(timeLimitSec) {
  clearInterval(state.timerId);
  state.index = 0;
  state.score = 0;
  state.remaining = timeLimitSec || TIME_LIMIT_SEC;
  state.busy = false;
  state.playing = true;
  state.answers = [];
  state.startedAt = Date.now();
  state.endReason = "";
  resultEl.classList.add("is-hidden");
  promptEl.classList.remove("is-hidden");
  resetSceneAndPlayer();
  itemLeft.classList.remove("is-fading");
  itemRight.classList.remove("is-fading");
  hideFeedback();
  renderQuestion();
  renderHud();
  state.timerId = setInterval(tick, 1000);
}

function tick() {
  if (!state.playing) return;
  state.remaining -= 1;
  renderHud();
  if (state.remaining <= 0) {
    finishGame("timeup");
  }
}

function currentQuestion() {
  return state.questions[state.index];
}

function renderQuestion() {
  const question = currentQuestion();
  if (!question) return;
  itemLeft.src = itemSrc(question.leftItem);
  itemRight.src = itemSrc(question.rightItem);
  itemLeft.alt = question.leftItem;
  itemRight.alt = question.rightItem;
  promptEl.textContent = question.prompt;
}

function renderHud() {
  scoreBox.textContent = `${state.score} 分`;
  timerBox.textContent = `${Math.max(0, state.remaining)} 秒`;
}

async function chooseDirection(choice) {
  const question = currentQuestion();
  if (!question) return;

  state.busy = true;
  const isCorrect = choice === question.correct;
  if (isCorrect) state.score += 1;

  state.answers.push({
    questionId: question.id,
    choice,
    correct: isCorrect,
  });

  player.classList.remove("is-arrive", "is-snap");
  scene.classList.remove("is-arrive", "is-snap", "is-turning");
  void player.offsetWidth;
  player.classList.add(choice === "left" ? "is-walk-left" : "is-walk-right");
  player.classList.add("is-walk-forward");
  scene.classList.add("is-near");
  setSceneBg("near");
  startWalkCycle(PLAYER_WALK_BACK);
  showFeedback(isCorrect);
  renderHud();

  await wait(NEAR_MS);
  if (!state.playing) {
    state.busy = false;
    return;
  }

  player.classList.remove("is-walk-forward");
  startWalkCycle(PLAYER_WALK_TURN[choice], TURN_WALK_FRAME_MS);
  scene.classList.add("is-turning");
  setSceneBg(SCENE_TURN[choice]);
  await wait(TURN_MS);

  if (!state.playing) {
    state.busy = false;
    return;
  }

  const hasNext = state.index + 1 < state.questions.length;
  if (!hasNext) {
    finishGame("complete");
    state.busy = false;
    return;
  }

  state.index += 1;
  itemLeft.classList.add("is-fading");
  itemRight.classList.add("is-fading");
  renderQuestion();
  hideFeedback();
  resetSceneAndPlayer(true);
  await wait(40);
  player.classList.remove("is-snap");
  scene.classList.remove("is-snap");
  player.classList.add("is-arrive");
  scene.classList.add("is-arrive");
  itemLeft.classList.remove("is-fading");
  itemRight.classList.remove("is-fading");
  await wait(ARRIVE_MS);

  state.busy = false;
}

function finishGame(reason) {
  if (!state.playing) return;
  state.playing = false;
  state.endReason = reason;
  clearInterval(state.timerId);
  hideFeedback();
  resetSceneAndPlayer();
  itemLeft.classList.remove("is-fading");
  itemRight.classList.remove("is-fading");

  const total = state.questions.length;
  resultTitle.textContent = reason === "timeup" ? "時間到" : "闖關結束";
  resultScore.textContent = `${state.score} / ${total} 分`;
  resultHint.textContent =
    reason === "timeup" ? "倒數結束，看看這次的得分" : "所有路口都走完了";
  resultEl.classList.remove("is-hidden");
  promptEl.classList.add("is-hidden");

  submitResult({
    gameId: "TGame",
    score: state.score,
    total,
    durationSec: Math.round((Date.now() - state.startedAt) / 1000),
    answers: state.answers,
    reason,
    progress: toProgress(state.score, total),
  });
}

function showFeedback(isCorrect) {
  feedbackEl.textContent = isCorrect ? "答對了！" : "答錯了";
  feedbackEl.classList.toggle("is-correct", isCorrect);
  feedbackEl.classList.toggle("is-wrong", !isCorrect);
  feedbackEl.classList.add("is-show");
}

function hideFeedback() {
  feedbackEl.classList.remove("is-show", "is-correct", "is-wrong");
  feedbackEl.textContent = "";
}

function itemSrc(id) {
  return `img/items/${id}.png`;
}

function resetSceneAndPlayer(keepHidden) {
  stopWalkCycle();
  player.classList.remove("is-walk-left", "is-walk-right", "is-walk-forward", "is-arrive");
  scene.classList.remove("is-arrive", "is-near", "is-turning");
  player.classList.toggle("is-snap", Boolean(keepHidden));
  scene.classList.toggle("is-snap", Boolean(keepHidden));
  setSceneBg("back");
  setPlayerSprite(PLAYER_BACK);
  if (!keepHidden) {
    player.classList.remove("is-snap");
    scene.classList.remove("is-snap");
  }
}

function startWalkCycle(frames, frameMs) {
  stopWalkCycle();
  const list = frames && frames.length ? frames : PLAYER_WALK_BACK;
  const delay = frameMs || WALK_FRAME_MS;
  state.walkFrame = 0;
  setPlayerSprite(list[0]);
  state.walkTimer = setInterval(() => {
    state.walkFrame = (state.walkFrame + 1) % list.length;
    setPlayerSprite(list[state.walkFrame]);
  }, delay);
}

function stopWalkCycle() {
  if (state.walkTimer) {
    clearInterval(state.walkTimer);
    state.walkTimer = null;
  }
}

function setSceneBg(name) {
  bgLayers.forEach((layer) => {
    const id = layer.dataset.bg;
    if (id === "back") {
      layer.classList.add("is-show");
      return;
    }
    const keepNearUnderTurn =
      (name === "turn-left" || name === "turn-right") && id === "near";
    layer.classList.toggle("is-show", id === name || keepNearUnderTurn);
  });
}

function setPlayerSprite(src) {
  if (playerImg.getAttribute("src") === src) return;
  playerImg.src = src;
}

function preloadSceneImages() {
  [
    "img/TGameNear.png",
    "img/TGameTurnLeft.png",
    "img/TGameTurnRight.png",
    "img/playerTurnLeft.png",
    "img/playerTurnRight.png",
    ...PLAYER_WALK_BACK,
    ...PLAYER_WALK_TURN.left,
    ...PLAYER_WALK_TURN.right,
  ].forEach((src) => {
    const image = new Image();
    image.src = src;
  });
}

function showPlayerPlaceholder() {
  playerImg.classList.add("is-hidden");
  playerPlaceholder.classList.remove("is-hidden");
}

function hidePlayerPlaceholder() {
  playerPlaceholder.classList.add("is-hidden");
  playerImg.classList.remove("is-hidden");
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toProgress(score, total) {
  if (!total) return 0;
  const percent = Math.round((score / total) * 100);
  return PROGRESS_STEPS.reduce((closest, step) =>
    Math.abs(step - percent) < Math.abs(closest - percent) ? step : closest
  );
}

/**
 * 讀取本題遊戲的題目。目前回傳本地假資料。
 */
async function fetchQuestions() {
  // -------------------------------------------------------------------------
  // 後端接點：拉題（之後接 API 時改這裡即可）
  //
  // 建議：GET /api/games/TGame/questions
  //
  // 回傳範例：
  // {
  //   timeLimitSec: 60,
  //   questions: [
  //     {
  //       id: "q1",
  //       prompt: "請選擇符合「可以吃的食物」的方向",
  //       leftItem: "apple",
  //       rightItem: "boot",
  //       correct: "left"   // "left" | "right"
  //     }
  //   ]
  // }
  //
  // const response = await fetch("/api/games/TGame/questions");
  // if (!response.ok) {
  //   return { timeLimitSec: TIME_LIMIT_SEC, questions: LOCAL_QUESTIONS };
  // }
  // return await response.json();
  // -------------------------------------------------------------------------

  return {
    timeLimitSec: TIME_LIMIT_SEC,
    questions: LOCAL_QUESTIONS,
  };
}

/**
 * 把本局結果交給後端。目前只 log。
 */
async function submitResult(payload) {
  // -------------------------------------------------------------------------
  // 後端接點：交卷（之後接 API 時改這裡即可）
  //
  // 建議：POST /api/games/TGame/result
  // payload 範例：
  // {
  //   gameId: "TGame",
  //   score: 6,
  //   total: 8,
  //   durationSec: 42,
  //   answers: [
  //     { questionId: "q1", choice: "left", correct: true }
  //   ],
  //   reason: "complete",   // "complete" | "timeup"
  //   progress: 100         // 只會是 0 / 50 / 100
  // }
  //
  // const response = await fetch("/api/games/TGame/result", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(payload),
  // });
  // if (!response.ok) {
  //   console.warn("無法送出遊戲結果，請稍後再試");
  //   return;
  // }
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 後端接點：更新學生進度（之後可另外呼叫）
  //
  // 建議：POST /api/students/me/progress
  // payload 範例：
  // {
  //   gameId: "TGame",
  //   progress: 50   // 對齊 Select 頁的 0 / 50 / 100
  // }
  //
  // 對照方式：答對題數 / 總題數，再正規化到最接近的 0、50、100。
  // -------------------------------------------------------------------------

  console.log("[TGame result payload 待接後端]", payload);
}
