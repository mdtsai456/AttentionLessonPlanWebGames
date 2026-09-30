// =============================================================================
// TGame2 / 勇闖迷宮（雙人）
// 左右各一組獨立 T 型迷宮與角色。P1 用 A / D，P2 用左右鍵。
// 每一關倒數 60 秒共用；時間內兩人各自連續作答，互不等待。
// =============================================================================

const TIME_LIMIT_SEC = 60;
const STAGE_COUNT = 6;
const MID_STAGE = 3;
const WALK_FRAME_MS = 90;
const TURN_WALK_FRAME_MS = 130;
const NEAR_MS = 1080;
const TURN_MS = 650;
const ARRIVE_MS = 320;
const SCENE_TURN = {
  left: "turn-left",
  right: "turn-right",
};

const PLAYER_BASE = {
  p1: "img/player1",
  p2: "img/player2",
};

const ALL_ITEMS = [
  "apple", "banana", "carrot", "fish",
  "boot", "book", "chair", "hammer",
  "hat", "key", "soccer", "umbrella",
];

const STAGE_RULES = [
  { prompt: "請選擇符合「可以吃的食物」的方向", correct: ["apple", "banana", "carrot"] },
  { prompt: "請選擇符合「可以坐的家具」的方向", correct: ["chair"] },
  { prompt: "請選擇符合「可以戴在頭上」的方向", correct: ["hat"] },
  { prompt: "請選擇符合「下雨時用的」的方向", correct: ["umbrella"] },
  { prompt: "請選擇符合「水裡游的動物」的方向", correct: ["fish"] },
  { prompt: "請選擇符合「用來閱讀的」的方向", correct: ["book"] },
];

const timerBox = document.getElementById("timer-box");
const resultEl = document.getElementById("result");
const resultTitle = document.getElementById("result-title");
const resultScoreP1 = document.getElementById("result-score-p1");
const resultScoreP2 = document.getElementById("result-score-p2");
const resultHint = document.getElementById("result-hint");
const replayBtn = document.getElementById("replay-btn");
const backBtn = document.getElementById("back-btn");

const levelBox = document.getElementById("level-box");
const midBreakEl = document.getElementById("mid-break");

const session = {
  level: 1,
  roundToken: 0,
  remaining: TIME_LIMIT_SEC,
  playing: false,
  startedAt: 0,
  timerId: null,
  endReason: "",
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

document.getElementById("mid-continue").addEventListener("click", () => {
  startLevel(session.level + 1);
});
document.getElementById("leave-btn").addEventListener("click", leaveGame);

let savedStage = 0;

function completedStage() {
  const midOpen = !midBreakEl.classList.contains("is-hidden");
  const shared = document.querySelector(".shared-stage-clear");
  const sharedOpen = shared && !shared.hidden;
  if (session.endReason === "complete") return STAGE_COUNT;
  if (midOpen || sharedOpen) return session.level;
  return Math.max(0, session.level - 1);
}

async function leaveGame() {
  const leaveBtn = document.getElementById("leave-btn");
  leaveBtn.disabled = true;
  const completed = completedStage();
  const stage = completed >= STAGE_COUNT ? STAGE_COUNT : completed >= MID_STAGE ? MID_STAGE : 0;
  if (stage) await saveBoth(stage);
  window.askLeave("../Select/index.html");
  leaveBtn.disabled = false;
}

async function saveBoth(stage) {
  if (!stage || stage === savedStage) return;
  savedStage = stage;
  await Promise.all([players.p1, players.p2].map((player, index) => savePlayer(player, index, stage)));
}

function levelAccuracyText(player, stageCount) {
  const values = [];
  for (let level = 1; level <= stageCount; level += 1) {
    const mine = player.answers.filter((answer) => answer.level === level);
    const ratio = mine.length
      ? mine.filter((answer) => answer.correct).length / mine.length
      : 0;
    values.push(Number(ratio.toFixed(4)));
  }
  return values.join(",");
}

async function savePlayer(player, index, stage) {
  const isP1 = index === 0;
  const studentKey = sessionStorage.getItem(isP1 ? "student1_key" : "student2_key") || "";
  const grade = sessionStorage.getItem(isP1 ? "student1_grade" : "student2_grade") || "G1";
  const school = sessionStorage.getItem(isP1 ? "student1_school" : "student2_school") || "KMU";
  const caseId =
    sessionStorage.getItem(isP1 ? "student1_case" : "student2_case") ||
    (studentKey.includes("_") ? studentKey.slice(studentKey.indexOf("_") + 1) : studentKey) ||
    (isP1 ? "S01" : "S02");
  const currentDay = parseInt(
    sessionStorage.getItem(isP1 ? "student1_day" : "student2_day")
      || (isP1 ? sessionStorage.getItem("current_day") || sessionStorage.getItem("currentDay") : "")
      || "1",
    10
  );
  const answered = Math.max(player.answers.length, 1);
  const wrong = Math.max(player.answers.length - player.score, 0);
  await fetch("http://127.0.0.1:5001/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lessonId: "1140908_TGame",
      data: {
        grade,
        caseId,
        school,
        currentDay,
        startTime: session.startedAt || Date.now(),
        endTime: Date.now(),
        mode: "double",
        stats: [
          { apiname: "TGame_correct", value: player.score },
          { apiname: "TGame_wrong", value: wrong },
          { apiname: "TGame_accuracy", value: player.score / answered },
          { apiname: "TGame_duration", value: Date.now() - (session.startedAt || Date.now()) },
          { apiname: "TGame_stage", value: stage },
          { apiname: "TGame_levelAccuracy", value: levelAccuracyText(player, stage) },
          {
            apiname: "TGame_avgReactionMs",
            value: player.reactionSamples.length
              ? player.reactionSamples.reduce((sum, value) => sum + value, 0) / player.reactionSamples.length
              : 0,
          },
          { apiname: "TGame_questionCount", value: player.answers.length },
        ],
      },
    }),
  }).catch((error) => console.error(error));
}

document.getElementById("mid-lobby").addEventListener("click", async () => {
  document.getElementById("mid-continue").disabled = true;
  document.getElementById("mid-lobby").disabled = true;
  await saveBoth(MID_STAGE);
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

function init() {
  preloadSceneImages();
  startGame();
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
    questionSeq: 0,
    currentQuestion: null,
    reactionSamples: [],
    questionShownAt: 0,
    score: 0,
    busy: false,
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

function startGame() {
  clearInterval(session.timerId);
  savedStage = 0;
  session.startedAt = Date.now();
  session.endReason = "";
  resultEl.classList.add("is-hidden");
  midBreakEl.classList.add("is-hidden");
  document.getElementById("mid-continue").disabled = false;
  document.getElementById("mid-lobby").disabled = false;

  [players.p1, players.p2].forEach((player) => {
    player.score = 0;
    player.answers = [];
    player.reactionSamples = [];
    player.promptEl.classList.remove("is-hidden");
  });

  startLevel(1);
}

function startLevel(level) {
  clearInterval(session.timerId);
  session.roundToken += 1;
  session.level = level;
  session.remaining = TIME_LIMIT_SEC;
  session.playing = true;
  resultEl.classList.add("is-hidden");
  midBreakEl.classList.add("is-hidden");

  [players.p1, players.p2].forEach((player) => {
    player.busy = false;
    player.questionSeq = 0;
    player.currentQuestion = makeQuestion(level, 0);
    player.promptEl.classList.remove("is-hidden");
    player.itemLeft.classList.remove("is-fading");
    player.itemRight.classList.remove("is-fading");
    resetSceneAndPlayer(player);
    hideFeedback(player);
    renderQuestion(player);
    player.questionShownAt = Date.now();
    renderPlayerHud(player);
  });

  renderLevel();
  renderTimer();
  session.timerId = setInterval(tick, 1000);
}

function tick() {
  if (!session.playing) return;
  session.remaining -= 1;
  renderTimer();
  if (session.remaining <= 0) endLevel();
}

function endLevel() {
  if (!session.playing) return;
  const finishedLevel = session.level;
  session.playing = false;
  session.roundToken += 1;
  clearInterval(session.timerId);
  settlePlayers();

  if (finishedLevel === MID_STAGE) {
    document.getElementById("mid-continue").disabled = false;
    document.getElementById("mid-lobby").disabled = false;
    midBreakEl.classList.remove("is-hidden");
    return;
  }
  if (finishedLevel < STAGE_COUNT) {
    window.showStageClear(finishedLevel).then(() => startLevel(finishedLevel + 1));
    return;
  }
  finishGame();
}

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function makeQuestion(level, seq) {
  const rule = STAGE_RULES[level - 1];
  const wrongItems = ALL_ITEMS.filter((item) => !rule.correct.includes(item));
  const correctItem = pick(rule.correct);
  const wrongItem = pick(wrongItems);
  const correctSide = Math.random() < 0.5 ? "left" : "right";
  return {
    id: `s${level}-${seq}`,
    prompt: rule.prompt,
    leftItem: correctSide === "left" ? correctItem : wrongItem,
    rightItem: correctSide === "right" ? correctItem : wrongItem,
    correct: correctSide,
  };
}

function currentQuestion(player) {
  return player.currentQuestion;
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

function renderLevel() {
  levelBox.textContent = `第 ${session.level} / ${STAGE_COUNT} 關`;
}

async function chooseDirection(player, choice) {
  if (!session.playing || player.busy) return;

  const question = currentQuestion(player);
  if (!question) return;

  const token = session.roundToken;
  player.busy = true;
  player.reactionSamples.push(Math.max(0, Date.now() - player.questionShownAt));
  const isCorrect = choice === question.correct;
  if (isCorrect) player.score += 1;

  player.answers.push({
    questionId: question.id,
    choice,
    correct: isCorrect,
    level: session.level,
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
  if (!sameRound(token)) {
    player.busy = false;
    return;
  }

  if (!isCorrect) {
    hideFeedback(player);
    resetSceneAndPlayer(player);
    player.questionShownAt = Date.now();
    player.busy = false;
    return;
  }

  player.playerEl.classList.remove("is-walk-forward");
  startWalkCycle(player, player.assets.walkTurn[choice], TURN_WALK_FRAME_MS);
  player.scene.classList.add("is-turning");
  setSceneBg(player, SCENE_TURN[choice]);
  await wait(TURN_MS);

  if (!sameRound(token)) {
    player.busy = false;
    return;
  }

  player.questionSeq += 1;
  player.currentQuestion = makeQuestion(session.level, player.questionSeq);
  player.itemLeft.classList.add("is-fading");
  player.itemRight.classList.add("is-fading");
  renderQuestion(player);
  player.questionShownAt = Date.now();
  hideFeedback(player);
  resetSceneAndPlayer(player, true);
  await wait(40);
  if (!sameRound(token)) {
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

function sameRound(token) {
  return token === session.roundToken && session.playing;
}

function settlePlayers() {
  [players.p1, players.p2].forEach((player) => {
    player.busy = false;
    hideFeedback(player);
    resetSceneAndPlayer(player);
    player.itemLeft.classList.remove("is-fading");
    player.itemRight.classList.remove("is-fading");
  });
}

function finishGame() {
  if (session.endReason === "complete") return;
  session.playing = false;
  session.endReason = "complete";
  session.roundToken += 1;
  clearInterval(session.timerId);
  midBreakEl.classList.add("is-hidden");
  settlePlayers();
  [players.p1, players.p2].forEach((player) => {
    player.promptEl.classList.add("is-hidden");
  });

  resultTitle.textContent = "挑戰完成！";
  resultScoreP1.textContent = `P1：${players.p1.score} / ${Math.max(players.p1.answers.length, 1)} 分`;
  resultScoreP2.textContent = `P2：${players.p2.score} / ${Math.max(players.p2.answers.length, 1)} 分`;
  resultHint.textContent = "六關都結束了，看看這次的得分";
  resultEl.classList.remove("is-hidden");
  void saveBoth(STAGE_COUNT);
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

