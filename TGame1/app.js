// =============================================================================
// TGame1 / 勇闖迷宮
// 每個路口都是同一張 T 型背景。按鍵時先切到靠近圖，再切左右轉視角，
// 角色同步往前走並換成側身；落地後回到 TGameBack，只換牆上物品與題目。
// =============================================================================

const TIME_LIMIT_SEC = 60;
const STAGE_COUNT = 6;
const MID_STAGE = 3;
const WALK_FRAME_MS = 90;
const TURN_WALK_FRAME_MS = 130;
const NEAR_MS = 1080;
const TURN_MS = 650;
const ARRIVE_MS = 320;
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
const levelBox = document.getElementById("level-box");
const stageClearModal = document.getElementById("stage-clear-modal");
const stageClearTitle = document.getElementById("stage-clear-title");
const stageClearText = document.getElementById("stage-clear-text");
const nextStageBtn = document.getElementById("btn-next-stage");
const lobbyBtn = document.getElementById("btn-lobby");

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

const state = {
  level: 1,
  questionSeq: 0,
  currentQuestion: null,
  score: 0,
  wrong: 0,
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

backBtn.addEventListener("click", returnToLobby);

nextStageBtn.addEventListener("click", continueNextStage);

lobbyBtn.addEventListener("click", async () => {
  nextStageBtn.disabled = true;
  lobbyBtn.disabled = true;
  await saveCurrentRun(MID_STAGE);
  returnToLobby();
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
  startGame();
}

function startGame() {
  clearInterval(state.timerId);
  state.score = 0;
  state.wrong = 0;
  state.answers = [];
  state.startedAt = Date.now();
  state.endReason = "";
  nextStageBtn.disabled = false;
  lobbyBtn.disabled = false;
  startLevel(1);
}

function startLevel(level) {
  clearInterval(state.timerId);
  state.level = level;
  state.questionSeq = 0;
  state.remaining = TIME_LIMIT_SEC;
  state.busy = false;
  state.playing = true;
  state.currentQuestion = makeQuestion(level, 0);
  resultEl.classList.add("is-hidden");
  stageClearModal.classList.add("is-hidden");
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
    endLevel();
  }
}

function currentQuestion() {
  return state.currentQuestion;
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
  levelBox.textContent = `${state.level} / ${STAGE_COUNT}`;
}

async function chooseDirection(choice) {
  const question = currentQuestion();
  if (!question) return;

  state.busy = true;
  const isCorrect = choice === question.correct;
  if (isCorrect) state.score += 1;
  else state.wrong += 1;

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

  state.questionSeq += 1;
  state.currentQuestion = makeQuestion(state.level, state.questionSeq);
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

function pausePlay() {
  state.playing = false;
  clearInterval(state.timerId);
  hideFeedback();
  resetSceneAndPlayer();
  itemLeft.classList.remove("is-fading");
  itemRight.classList.remove("is-fading");
  promptEl.classList.add("is-hidden");
}

function endLevel() {
  if (!state.playing) return;
  pausePlay();

  if (state.level === MID_STAGE) {
    showStageClear(true);
    return;
  }
  if (state.level < STAGE_COUNT) {
    window.showStageClear(state.level).then(continueNextStage);
    return;
  }
  finishGame("complete");
}

function showStageClear(isMidBreak) {
  stageClearTitle.textContent = isMidBreak ? "挑戰完成！" : `第 ${state.level} 關結束`;
  stageClearText.innerHTML = isMidBreak
    ? "第 3 關已結束<br>要繼續遊玩嗎？"
    : "準備開始下一關嘍！";
  nextStageBtn.textContent = isMidBreak ? "繼續遊玩" : "繼續";
  lobbyBtn.classList.toggle("is-hidden", !isMidBreak);
  stageClearModal.classList.remove("is-hidden");
}

function continueNextStage() {
  startLevel(state.level + 1);
}

function returnToLobby() {
  location.href = "../Select/index.html";
}

function finishGame(reason) {
  pausePlay();
  state.endReason = reason;
  stageClearModal.classList.add("is-hidden");
  const total = state.score + state.wrong;
  resultTitle.textContent = "挑戰完成！";
  resultScore.textContent = `${state.score} / ${Math.max(total, 1)} 分`;
  resultHint.textContent = "六關都結束了，看看這次的得分";
  resultEl.classList.remove("is-hidden");
  void saveCurrentRun(STAGE_COUNT);
}

function saveCurrentRun(stage) {
  const total = Math.max(state.score + state.wrong, 1);
  return submitResult({
    score: state.score,
    wrong: state.wrong,
    accuracy: Math.round(state.score / total * 100),
    duration: Date.now() - state.startedAt,
    stage,
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

async function submitResult(data) {
  const url = "http://127.0.0.1:5001/api/sessions";
  const grade = sessionStorage.getItem("grade") || sessionStorage.getItem("student1_grade") || "G1";
  const caseId = sessionStorage.getItem("caseId") || sessionStorage.getItem("student1_case") || "S03";
  const school = sessionStorage.getItem("school") || sessionStorage.getItem("student1_school") || "KMU";
  const currentDay = parseInt(
    sessionStorage.getItem("currentDay")
      || sessionStorage.getItem("student1_day")
      || sessionStorage.getItem("current_day")
      || "1",
    10
  );

  const payload = {
    lessonId: "1140908_TGame",
    data: {
      grade,
      caseId,
      school,
      currentDay,
      startTime: state.startedAt,
      endTime: Date.now(),
      mode: "single",
      stats: [
        { apiname: "TGame_correct", value: data.score },
        { apiname: "TGame_wrong", value: data.wrong },
        { apiname: "TGame_accuracy", value: data.accuracy / 100 },
        { apiname: "TGame_duration", value: data.duration },
        { apiname: "TGame_stage", value: data.stage },
      ],
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status !== 201) {
      const errData = await res.json().catch(() => ({}));
      console.error(`成績送出失敗 ${res.status}:`, errData.detail || "寫入失敗");
    }
  } catch (err) {
    console.error("成績送出失敗：", err);
  }
}
