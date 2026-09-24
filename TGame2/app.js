// =============================================================================
// TGame2 / 勇闖迷宮（雙人）
// 左右各一組獨立 T 型迷宮與角色。P1 用 A / D，P2 用左右鍵。
// 進度與分數分開計算，倒數 60 秒共用。
// =============================================================================

const TIME_LIMIT_SEC = 60;
const WALK_FRAME_MS = 90;
const TURN_WALK_FRAME_MS = 130;
const NEAR_MS = 1080;
const TURN_MS = 650;
const ARRIVE_MS = 320;
const PROGRESS_STEPS = [0, 50, 100];
const SCENE_TURN = {
  left: "turn-left",
  right: "turn-right",
};

const PLAYER_BASE = {
  p1: "img/player1",
  p2: "img/player2",
};

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

const timerBox = document.getElementById("timer-box");
const resultEl = document.getElementById("result");
const resultTitle = document.getElementById("result-title");
const resultScoreP1 = document.getElementById("result-score-p1");
const resultScoreP2 = document.getElementById("result-score-p2");
const resultHint = document.getElementById("result-hint");
const replayBtn = document.getElementById("replay-btn");
const backBtn = document.getElementById("back-btn");

const session = {
  questions: [],
  remaining: TIME_LIMIT_SEC,
  playing: false,
  startedAt: 0,
  timerId: null,
  endReason: "",
  pastMid: false,
};

const players = {
  p1: createPlayer("p1"),
  p2: createPlayer("p2"),
};

replayBtn.addEventListener("click", () => {
  startGame();
});

backBtn.addEventListener("click", () => {
  location.href = "../Select/index.html";
});

const midBreakEl = document.getElementById("mid-break");
document.getElementById("mid-continue").addEventListener("click", () => {
  session.pastMid = true;
  session.playing = true;
  players.p1.midReady = false;
  players.p2.midReady = false;
  midBreakEl.classList.add("is-hidden");
  clearInterval(session.timerId);
  session.timerId = setInterval(tick, 1000);
  presentNextQuestion(players.p1);
  presentNextQuestion(players.p2);
});
document.getElementById("mid-lobby").addEventListener("click", () => {
  location.href = "../Select/index.html";
});

document.addEventListener("keydown", (event) => {
  if (!session.playing) return;

  if (event.key === "a" || event.key === "A") {
    event.preventDefault();
    chooseDirection(players.p1, "left");
  } else if (event.key === "d" || event.key === "D") {
    event.preventDefault();
    chooseDirection(players.p1, "right");
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    chooseDirection(players.p2, "left");
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    chooseDirection(players.p2, "right");
  }
});

init();

async function init() {
  preloadSceneImages();
  const data = await fetchQuestions();
  session.questions = data.questions;
  startGame(data.timeLimitSec);
}

function createPlayer(id) {
  const root = document.querySelector(`[data-player="${id}"]`);
  const playerImg = root.querySelector(".player-img");
  const playerPlaceholder = root.querySelector(".player-placeholder");
  const player = {
    id,
    label: id === "p1" ? "P1" : "P2",
    root,
    scene: root.querySelector(".scene"),
    bgLayers: root.querySelectorAll(".bg"),
    playerEl: root.querySelector(".player"),
    playerImg,
    playerPlaceholder,
    itemLeft: root.querySelector(".item-left"),
    itemRight: root.querySelector(".item-right"),
    scoreBox: root.querySelector(".score-box"),
    promptEl: root.querySelector(".prompt"),
    feedbackEl: root.querySelector(".feedback"),
    assets: makePlayerAssets(PLAYER_BASE[id]),
    index: 0,
    score: 0,
    busy: false,
    finished: false,
    answers: [],
    walkTimer: null,
    walkFrame: 0,
  };

  playerImg.addEventListener("error", () => showPlayerPlaceholder(player));
  playerImg.addEventListener("load", () => hidePlayerPlaceholder(player));
  return player;
}

function makePlayerAssets(base) {
  return {
    back: `${base}/playerBack.png`,
    turn: {
      left: `${base}/playerTurnLeft.png`,
      right: `${base}/playerTurnRight.png`,
    },
    walkBack: Array.from(
      { length: 12 },
      (_, index) =>
        `${base}/walk/playerBackWalk${String(index + 1).padStart(2, "0")}.png`
    ),
    walkTurn: {
      left: Array.from(
        { length: 5 },
        (_, index) =>
          `${base}/walkLeft/playerTurnLeftWalk${String(index + 1).padStart(2, "0")}.png`
      ),
      right: Array.from(
        { length: 5 },
        (_, index) =>
          `${base}/walkRight/playerTurnRightWalk${String(index + 1).padStart(2, "0")}.png`
      ),
    },
  };
}

function startGame(timeLimitSec) {
  clearInterval(session.timerId);
  session.remaining = timeLimitSec || TIME_LIMIT_SEC;
  session.playing = true;
  session.startedAt = Date.now();
  session.endReason = "";
  session.pastMid = false;
  resultEl.classList.add("is-hidden");
  document.getElementById("mid-break").classList.add("is-hidden");

  [players.p1, players.p2].forEach((player) => {
    player.index = 0;
    player.score = 0;
    player.busy = false;
    player.finished = false;
    player.midReady = false;
    player.stageReady = 0;
    player.answers = [];
    player.promptEl.classList.remove("is-hidden");
    player.itemLeft.classList.remove("is-fading");
    player.itemRight.classList.remove("is-fading");
    resetSceneAndPlayer(player);
    hideFeedback(player);
    renderQuestion(player);
    renderPlayerHud(player);
  });

  renderTimer();
  session.timerId = setInterval(tick, 1000);
}

function showMidBreak() {
  session.playing = false;
  clearInterval(session.timerId);
  document.getElementById("mid-break").classList.remove("is-hidden");
}

function tick() {
  if (!session.playing) return;
  session.remaining -= 1;
  renderTimer();
  if (session.remaining <= 0) {
    finishGame("timeup");
  }
}

function currentQuestion(player) {
  return session.questions[player.index];
}

function renderQuestion(player) {
  const question = currentQuestion(player);
  if (!question) return;
  player.itemLeft.src = itemSrc(question.leftItem);
  player.itemRight.src = itemSrc(question.rightItem);
  player.itemLeft.alt = question.leftItem;
  player.itemRight.alt = question.rightItem;
  player.promptEl.textContent = question.prompt;
}

function renderPlayerHud(player) {
  player.scoreBox.textContent = `${player.score} 分`;
}

function renderTimer() {
  timerBox.textContent = `${Math.max(0, session.remaining)} 秒`;
}

async function chooseDirection(player, choice) {
  if (!session.playing || player.busy || player.finished) return;

  const question = currentQuestion(player);
  if (!question) return;

  player.busy = true;
  const isCorrect = choice === question.correct;
  if (isCorrect) player.score += 1;

  player.answers.push({
    questionId: question.id,
    choice,
    correct: isCorrect,
  });

  player.playerEl.classList.remove("is-arrive", "is-snap");
  player.scene.classList.remove("is-arrive", "is-snap", "is-turning");
  void player.playerEl.offsetWidth;
  player.playerEl.classList.add(choice === "left" ? "is-walk-left" : "is-walk-right");
  player.playerEl.classList.add("is-walk-forward");
  player.scene.classList.add("is-near");
  setSceneBg(player, "near");
  startWalkCycle(player, player.assets.walkBack);
  showFeedback(player, isCorrect);
  renderPlayerHud(player);

  await wait(NEAR_MS);
  if (!session.playing) {
    player.busy = false;
    return;
  }

  player.playerEl.classList.remove("is-walk-forward");
  startWalkCycle(player, player.assets.walkTurn[choice], TURN_WALK_FRAME_MS);
  player.scene.classList.add("is-turning");
  setSceneBg(player, SCENE_TURN[choice]);
  await wait(TURN_MS);

  if (!session.playing) {
    player.busy = false;
    return;
  }

  const hasNext = player.index + 1 < session.questions.length;
  if (!hasNext) {
    completePlayer(player);
    return;
  }

  if (!session.pastMid && player.index === 2) {
    player.midReady = true;
    player.busy = true;
    player.promptEl.textContent = "等待對方完成第 3 關";
    if (players.p1.midReady && players.p2.midReady) showMidBreak();
    return;
  }

  const finishedLevel = player.index + 1;
  player.stageReady = finishedLevel;
  player.busy = true;
  player.promptEl.textContent = `等待對方完成第 ${finishedLevel} 關`;
  if (players.p1.stageReady === finishedLevel && players.p2.stageReady === finishedLevel) {
    session.playing = false;
    clearInterval(session.timerId);
    window.showStageClear(finishedLevel).then(() => {
      players.p1.stageReady = 0;
      players.p2.stageReady = 0;
      session.playing = true;
      session.timerId = setInterval(tick, 1000);
      presentNextQuestion(players.p1);
      presentNextQuestion(players.p2);
    });
  }
}

async function presentNextQuestion(player) {
  player.index += 1;
  player.itemLeft.classList.add("is-fading");
  player.itemRight.classList.add("is-fading");
  renderQuestion(player);
  hideFeedback(player);
  resetSceneAndPlayer(player, true);
  await wait(40);
  if (!session.playing) {
    player.busy = false;
    return;
  }

  player.playerEl.classList.remove("is-snap");
  player.scene.classList.remove("is-snap");
  player.playerEl.classList.add("is-arrive");
  player.scene.classList.add("is-arrive");
  player.itemLeft.classList.remove("is-fading");
  player.itemRight.classList.remove("is-fading");
  await wait(ARRIVE_MS);

  player.busy = false;
}

function completePlayer(player) {
  player.finished = true;
  player.busy = false;
  hideFeedback(player);
  resetSceneAndPlayer(player);
  player.itemLeft.classList.remove("is-fading");
  player.itemRight.classList.remove("is-fading");
  player.promptEl.textContent = "等待對方...";

  if (players.p1.finished && players.p2.finished) {
    finishGame("complete");
  }
}

function finishGame(reason) {
  if (!session.playing) return;
  session.playing = false;
  session.endReason = reason;
  clearInterval(session.timerId);

  [players.p1, players.p2].forEach((player) => {
    player.busy = false;
    hideFeedback(player);
    resetSceneAndPlayer(player);
    player.itemLeft.classList.remove("is-fading");
    player.itemRight.classList.remove("is-fading");
    player.promptEl.classList.add("is-hidden");
  });

  const total = session.questions.length;
  resultTitle.textContent = reason === "timeup" ? "時間到" : "闖關結束";
  resultScoreP1.textContent = `P1：${players.p1.score} / ${total} 分`;
  resultScoreP2.textContent = `P2：${players.p2.score} / ${total} 分`;
  resultHint.textContent =
    reason === "timeup" ? "倒數結束，看看這次的得分" : "兩位都走完所有路口了";
  resultEl.classList.remove("is-hidden");

  submitResult({
    gameId: "TGame",
    mode: "dual",
    reason,
    durationSec: Math.round((Date.now() - session.startedAt) / 1000),
    players: [
      playerResult(players.p1, total),
      playerResult(players.p2, total),
    ],
  });
}

function playerResult(player, total) {
  return {
    id: player.id,
    score: player.score,
    total,
    answers: player.answers,
    progress: toProgress(player.score, total),
  };
}

function showFeedback(player, isCorrect) {
  player.feedbackEl.textContent = isCorrect ? "答對了！" : "答錯了";
  player.feedbackEl.classList.toggle("is-correct", isCorrect);
  player.feedbackEl.classList.toggle("is-wrong", !isCorrect);
  player.feedbackEl.classList.add("is-show");
}

function hideFeedback(player) {
  player.feedbackEl.classList.remove("is-show", "is-correct", "is-wrong");
  player.feedbackEl.textContent = "";
}

function itemSrc(id) {
  return `img/items/${id}.png`;
}

function resetSceneAndPlayer(player, keepHidden) {
  stopWalkCycle(player);
  player.playerEl.classList.remove(
    "is-walk-left",
    "is-walk-right",
    "is-walk-forward",
    "is-arrive"
  );
  player.scene.classList.remove("is-arrive", "is-near", "is-turning");
  player.playerEl.classList.toggle("is-snap", Boolean(keepHidden));
  player.scene.classList.toggle("is-snap", Boolean(keepHidden));
  setSceneBg(player, "back");
  setPlayerSprite(player, player.assets.back);
  if (!keepHidden) {
    player.playerEl.classList.remove("is-snap");
    player.scene.classList.remove("is-snap");
  }
}

function startWalkCycle(player, frames, frameMs) {
  stopWalkCycle(player);
  const list = frames && frames.length ? frames : player.assets.walkBack;
  const delay = frameMs || WALK_FRAME_MS;
  player.walkFrame = 0;
  setPlayerSprite(player, list[0]);
  player.walkTimer = setInterval(() => {
    player.walkFrame = (player.walkFrame + 1) % list.length;
    setPlayerSprite(player, list[player.walkFrame]);
  }, delay);
}

function stopWalkCycle(player) {
  if (player.walkTimer) {
    clearInterval(player.walkTimer);
    player.walkTimer = null;
  }
}

function setSceneBg(player, name) {
  player.bgLayers.forEach((layer) => {
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

function setPlayerSprite(player, src) {
  if (player.playerImg.getAttribute("src") === src) return;
  player.playerImg.src = src;
}

function preloadSceneImages() {
  const sources = [
    "img/TGameNear.png",
    "img/TGameTurnLeft.png",
    "img/TGameTurnRight.png",
    ...[players.p1, players.p2].flatMap((player) => [
      player.assets.turn.left,
      player.assets.turn.right,
      ...player.assets.walkBack,
      ...player.assets.walkTurn.left,
      ...player.assets.walkTurn.right,
    ]),
  ];

  Array.from(new Set(sources)).forEach((src) => {
    const image = new Image();
    image.src = src;
  });
}

function showPlayerPlaceholder(player) {
  player.playerImg.classList.add("is-hidden");
  player.playerPlaceholder.classList.remove("is-hidden");
}

function hidePlayerPlaceholder(player) {
  player.playerPlaceholder.classList.add("is-hidden");
  player.playerImg.classList.remove("is-hidden");
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
  //   mode: "dual",
  //   reason: "complete",
  //   durationSec: 42,
  //   players: [
  //     { id: "p1", score: 6, total: 8, answers: [], progress: 100 },
  //     { id: "p2", score: 4, total: 8, answers: [], progress: 50 }
  //   ]
  // }
  // -------------------------------------------------------------------------

  console.log("[TGame dual result payload 待接後端]", payload);
}
