// =============================================================================
// TGame2 / 勇闖迷宮（雙人）
// 左右各一組獨立 T 型迷宮與角色。P1 用 A / D，P2 用左右鍵。
// 每一關倒數 60 秒共用：任一人第一次按鍵時，兩邊同時開始計時；
// 時間到，兩邊一起進入下一關。時間內兩人各自連續作答，互不等待。
// 任一人的新題圖示載入中，兩人的按鍵和共用倒數一起暫停。
// =============================================================================

const TIME_LIMIT_SEC = 60;
const STAGE_COUNT = 6;
const MID_STAGE = 3;
const WALK_FRAME_MS = 90;
const TURN_WALK_FRAME_MS = 130;
const NEAR_MS = 1080;
const TURN_MS = 650;
const ARRIVE_MS = 320;
const PRELOAD_TIMEOUT_MS = 10000; // 某張圖卡住時最多等這麼久，避免永遠停在載入中
const SCENE_TURN = {
  left: "turn-left",
  right: "turn-right",
};

const PLAYER_BASE = {
  p1: "img/player1",
  p2: "img/player2",
};
// 保留預載圖片的參照，避免被 GC 回收後換格時又要重新解碼
const preloadedImages = [];

const ALL_ITEMS = [
  "apple", "banana", "carrot", "fish",
  "boot", "book", "chair", "hammer",
  "hat", "key", "soccer", "umbrella",
];

const DEFAULT_STAGE_RULES = [
  { prompt: "請選擇符合「可以吃的食物」的方向", correct: ["apple", "banana", "carrot"] },
  { prompt: "請選擇符合「可以坐的家具」的方向", correct: ["chair"] },
  { prompt: "請選擇符合「可以戴在頭上」的方向", correct: ["hat"] },
  { prompt: "請選擇符合「下雨時用的」的方向", correct: ["umbrella"] },
  { prompt: "請選擇符合「水裡游的動物」的方向", correct: ["fish"] },
  { prompt: "請選擇符合「用來閱讀的」的方向", correct: ["book"] },
];

let stageRules = DEFAULT_STAGE_RULES;
let customThemes = null;

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
const toastEl = document.getElementById("toast");

const session = {
  level: 1,
  roundToken: 0,
  remaining: TIME_LIMIT_SEC,
  playing: false,
  startedAt: 0,
  timerId: null,
  endReason: "",
  // 用於追蹤計時器是否已開始
  timerStarted: false,
  loadingStartedAt: 0,
  timerLastTickAt: 0,
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
//設定重新載入題目按鈕事件

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
  const grade = sessionStorage.getItem(isP1 ? "student1_grade" : "student2_grade");
  const school = sessionStorage.getItem(isP1 ? "student1_school" : "student2_school");
  const caseId =
    sessionStorage.getItem(isP1 ? "student1_case" : "student2_case") ||
    (studentKey.includes("_") ? studentKey.slice(studentKey.indexOf("_") + 1) : studentKey);
  const currentDay = parseInt(
    sessionStorage.getItem(isP1 ? "student1_day" : "student2_day")
      || (isP1 ? sessionStorage.getItem("current_day") || sessionStorage.getItem("currentDay") : "")
      || "1",
    10
  );
  const answered = Math.max(player.answers.length, 1);
  const wrong = Math.max(player.answers.length - player.score, 0);
  await window.WebGameApi.submitSession({
      lessonId: "1140908_TGame",
      data: {
        grade,
        caseId,
        school,
        currentDay,
        startTime: window.WebGameRuntime.toWallTime(session.startedAt || window.WebGameRuntime.now()),
        endTime: Date.now(),
        mode: "double",
        stats: [
          { apiname: "TGame_correct", value: player.score },
          { apiname: "TGame_wrong", value: wrong },
          { apiname: "TGame_accuracy", value: player.score / answered },
          { apiname: "TGame_duration", value: window.WebGameRuntime.now() - (session.startedAt || window.WebGameRuntime.now()) },
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
    }, { player: index + 1 }).catch((error) => console.error(error));
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

async function init() {
  showToast("載入中…");
  clearTimeout(toastTimer); // 載入時間可能超過提示的自動消失時間，載完再收起
  const [, result] = await Promise.all([
    preloadSceneImages(),
    loadCsvFromUrl(CSV_URL), // 自動讀取 CSV，失敗就用預設題目
  ]);
  toastEl.classList.remove("is-show");
  if (!result.ok) showToast("讀取不到 主題資料.csv，改用預設題目", true);
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
    loading: false,
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
  session.startedAt = window.WebGameRuntime.now();
  session.endReason = "";
  stageRules = buildStageRules();
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

async function startLevel(level) {
  clearInterval(session.timerId);
  session.roundToken += 1;
  session.level = level;
  session.remaining = TIME_LIMIT_SEC;
  session.timerStarted = false;
  session.loadingStartedAt = 0;
  session.timerLastTickAt = 0;
  session.playing = true;
  resultEl.classList.add("is-hidden");
  midBreakEl.classList.add("is-hidden");

  const token = session.roundToken;
  const shown = [players.p1, players.p2].map((player) => {
    player.busy = true;
    player.loading = true;
    player.questionSeq = 0;
    player.currentQuestion = makeQuestion(level, 0);
    player.promptEl.classList.remove("is-hidden");
    resetSceneAndPlayer(player);
    hideItemsNow(player.itemLeft, player.itemRight);
    hideFeedback(player);
    renderPlayerHud(player);
    return renderQuestion(player);
  });
  preloadStageImages(level);

  renderLevel();
  renderTimer();
  // 計時不在這裡開始：等任一人第一次按鍵才同時開始（見 startLevelTimer）

  // 兩人的圖示都載入完成才一起淡入、開放按鍵，誰先按都公平
  await Promise.all(shown);
  if (!sameRound(token)) return;
  [players.p1, players.p2].forEach((player) => {
    player.itemLeft.classList.remove("is-fading");
    player.itemRight.classList.remove("is-fading");
    player.questionShownAt = window.WebGameRuntime.now();
    player.busy = false;
    player.loading = false;
  });
  renderTimer();
}

function startLevelTimer() {
  if (session.timerStarted) return;
  session.timerStarted = true;
  session.timerLastTickAt = window.WebGameRuntime.now();
  renderTimer();
  session.timerId = setInterval(tick, 1000);
}

function tick() {
  if (!session.playing || !session.timerStarted) return;
  // 任一位玩家還在等題目圖示就不扣時間，載入時間不計入關卡時間
  if (itemsLoading()) return;
  const now = window.WebGameRuntime.now();
  session.remaining = Math.max(0, session.remaining - Math.max(0, now - session.timerLastTickAt) / 1000);
  session.timerLastTickAt = now;
  renderTimer();
  if (session.remaining <= 0) endLevel();
}

function itemsLoading() {
  return players.p1.loading || players.p2.loading;
}

function setPlayerLoading(player, loading) {
  const wasLoading = itemsLoading();
  const now = window.WebGameRuntime.now();
  if (!wasLoading && loading && session.timerStarted) {
    // 暫停前先結算秒內進度，短於一秒的載入也不會吃掉作答時間。
    tick();
    if (!session.playing) return;
  }
  player.loading = loading;
  if (!wasLoading && loading) {
    session.loadingStartedAt = now;
  } else if (wasLoading && !itemsLoading()) {
    // 只扣除這一題與共同暫停重疊的時間，答錯或換題也不會多扣。
    [players.p1, players.p2].forEach((p) => {
      p.questionShownAt += Math.max(0, now - Math.max(p.questionShownAt, session.loadingStartedAt));
    });
    session.loadingStartedAt = 0;
    session.timerLastTickAt = now;
  }
  renderTimer();
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

function wrongItemsFor(rule) {
  return rule.wrong || ALL_ITEMS.filter((item) => !rule.correct.includes(item));
}

function makeQuestion(level, seq) {
  const rule = stageRules[level - 1];
  const correctItem = pick(rule.correct);
  const wrongItem = pick(wrongItemsFor(rule));
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

// 等兩張圖都載入好才一起換上，避免先閃出上一題的圖示
async function renderQuestion(player) {
  const question = currentQuestion(player);
  if (!question) return;
  player.promptEl.textContent = question.prompt;
  const [leftSrc, rightSrc] = await Promise.all([
    itemImageForDisplay(question.leftItem),
    itemImageForDisplay(question.rightItem),
  ]);
  // 等待期間關卡結束或換了題目，就不要再改畫面
  if (currentQuestion(player) !== question || !session.playing) return;
  setItemImage(player.itemLeft, question.leftItem, leftSrc);
  setItemImage(player.itemRight, question.rightItem, rightSrc);
  await waitItemsDecoded(player.itemLeft, player.itemRight);
}

function renderPlayerHud(player) {
  player.scoreBox.textContent = `${player.score} 分`;
}

function renderTimer() {
  const waiting = session.playing && !session.timerStarted;
  const loading = itemsLoading();
  timerBox.textContent = loading
    ? `${Math.max(0, Math.ceil(session.remaining))} 秒 · 載入中`
    : waiting
    ? `${TIME_LIMIT_SEC} 秒 · 按鍵開始`
    : `${Math.max(0, Math.ceil(session.remaining))} 秒`;
}

function renderLevel() {
  levelBox.textContent = `第 ${session.level} / ${STAGE_COUNT} 關`;
}

async function chooseDirection(player, choice) {
  if (!session.playing || player.busy || itemsLoading()) return;

  const question = currentQuestion(player);
  if (!question) return;

  startLevelTimer();
  tick();
  if (!session.playing) return;

  const token = session.roundToken;
  player.busy = true;
  player.reactionSamples.push(Math.max(0, window.WebGameRuntime.now() - player.questionShownAt));
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

  // 答對就先決定下一題，趁走路動畫時在背景下載圖示
  let next = null;
  if (isCorrect) {
    player.questionSeq += 1;
    next = makeQuestion(session.level, player.questionSeq);
    preloadQuestionImages(next);
  }

  // 回合已換（關卡結束或下一關開始）就直接離開，busy 交給新回合處理
  await wait(NEAR_MS);
  if (!sameRound(token)) return;

  if (!isCorrect) {
    hideFeedback(player);
    resetSceneAndPlayer(player);
    player.questionShownAt = window.WebGameRuntime.now();
    player.busy = false;
    return;
  }

  player.playerEl.classList.remove("is-walk-forward");
  startWalkCycle(player, player.assets.walkTurn[choice], TURN_WALK_FRAME_MS);
  player.scene.classList.add("is-turning");
  setSceneBg(player, SCENE_TURN[choice]);
  await wait(TURN_MS);
  if (!sameRound(token)) return;

  player.currentQuestion = next;
  player.itemLeft.classList.add("is-fading");
  player.itemRight.classList.add("is-fading");
  setPlayerLoading(player, true);
  if (!sameRound(token)) return;
  await renderQuestion(player);
  if (!sameRound(token)) return;
  hideFeedback(player);
  resetSceneAndPlayer(player, true);
  await wait(40);
  if (!sameRound(token)) return;

  player.playerEl.classList.remove("is-snap");
  player.scene.classList.remove("is-snap");
  player.playerEl.classList.add("is-arrive");
  player.scene.classList.add("is-arrive");
  player.itemLeft.classList.remove("is-fading");
  player.itemRight.classList.remove("is-fading");
  player.questionShownAt = window.WebGameRuntime.now();
  setPlayerLoading(player, false);
  await wait(ARRIVE_MS);
  if (!sameRound(token)) return;

  player.busy = false;
}

function sameRound(token) {
  return token === session.roundToken && session.playing;
}

function settlePlayers() {
  session.loadingStartedAt = 0;
  [players.p1, players.p2].forEach((player) => {
    player.busy = false;
    player.loading = false;
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
  return `img/items/${encodeURIComponent(id)}.png`;
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

// 所有場景與角色圖都下載並解碼完才開始遊戲，第一次換格就不會跳格
async function preloadSceneImages() {
  const sources = [
    "img/TGameBack.png",
    "img/TGameNear.png",
    "img/TGameTurnLeft.png",
    "img/TGameTurnRight.png",
    ...[players.p1, players.p2].flatMap((player) => [
      player.assets.back,
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
    preloadedImages.push(image);
  });
  await Promise.race([
    Promise.allSettled(preloadedImages.map((image) => image.decode())),
    wait(PRELOAD_TIMEOUT_MS),
  ]);
}

function showPlayerPlaceholder(player) {
  player.playerImg.classList.add("is-hidden");
  player.playerPlaceholder.classList.remove("is-hidden");
}

function hidePlayerPlaceholder(player) {
  player.playerPlaceholder.classList.add("is-hidden");
  player.playerImg.classList.remove("is-hidden");
}

// =============================================================================
// CSV 匯入題目
// 欄位：主題, 主題描述, 類型, 項目1 ~ 項目N（可再加一欄「年級」）
// 「類型」填 正確 / 錯誤；同一個主題可以分成多列。
// 項目名稱若有對應的 img/items/名稱.png 就顯示圖片，沒有就自動產生文字卡。
// =============================================================================

const CORRECT_TYPES = ["正確", "對", "correct", "true", "o", "1"];
const WRONG_TYPES = ["錯誤", "錯", "wrong", "false", "x", "0"];

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const counts = [",", "\t", ";"].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

function parseCSV(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length) pushRow();
  return rows;
}

function buildThemesFromRows(rows) {
  const warnings = [];
  if (rows.length < 2) {
    throw new Error("檔案是空的，至少需要標題列與一列題目");
  }

  const header = rows[0].map((cell) => cell.trim());
  const topicCol = header.indexOf("主題");
  const typeCol = header.indexOf("類型");
  const descCol = header.indexOf("主題描述");
  const gradeCol = header.indexOf("年級");
  if (topicCol < 0 || typeCol < 0) {
    throw new Error("找不到「主題」或「類型」欄位，請確認第一列是標題列");
  }

  let itemCols = [];
  header.forEach((name, index) => {
    if (name.startsWith("項目")) itemCols.push(index);
  });
  if (!itemCols.length) {
    const start = Math.max(topicCol, typeCol, descCol, gradeCol) + 1;
    itemCols = header.map((_, index) => index).filter((index) => index >= start);
  }
  if (!itemCols.length) throw new Error("找不到「項目1、項目2…」欄位");

  const cell = (cells, index) => (index >= 0 ? (cells[index] || "").trim() : "");
  const byKey = new Map();

  rows.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const topic = cell(cells, topicCol);
    if (!topic) {
      warnings.push(`第 ${line} 列沒有主題，已略過`);
      return;
    }
    const kind = cell(cells, typeCol).toLowerCase();
    const isCorrect = CORRECT_TYPES.includes(kind);
    const isWrong = WRONG_TYPES.includes(kind);
    if (!isCorrect && !isWrong) {
      warnings.push(`第 ${line} 列的類型「${cell(cells, typeCol)}」看不懂（請填正確或錯誤），已略過`);
      return;
    }

    const grade = cell(cells, gradeCol);
    const key = `${grade}|${topic}`;
    if (!byKey.has(key)) {
      byKey.set(key, { topic, desc: "", grade, correct: [], wrong: [] });
    }
    const theme = byKey.get(key);
    const desc = cell(cells, descCol);
    if (desc && !theme.desc) theme.desc = desc;

    const target = isCorrect ? theme.correct : theme.wrong;
    itemCols
      .map((col) => cell(cells, col))
      .filter(Boolean)
      .forEach((item) => {
        if (!target.includes(item)) target.push(item);
      });
  });

  const themes = [];
  byKey.forEach((theme) => {
    theme.wrong = theme.wrong.filter((item) => !theme.correct.includes(item));
    if (!theme.correct.length) {
      warnings.push(`「${theme.topic}」沒有正確項目，已略過`);
      return;
    }
    themes.push(theme);
  });

  // 沒有「錯誤」列的主題：借用其他主題的正確項目當干擾選項
  const usable = themes.filter((theme) => {
    if (theme.wrong.length) return true;
    const borrowed = new Set();
    themes.forEach((other) => {
      if (other === theme) return;
      other.correct.forEach((item) => {
        if (!theme.correct.includes(item)) borrowed.add(item);
      });
    });
    if (!borrowed.size) {
      warnings.push(`「${theme.topic}」沒有錯誤項目可當干擾選項，已略過`);
      return false;
    }
    theme.wrong = [...borrowed];
    warnings.push(`「${theme.topic}」沒有錯誤項目，暫用其他主題的項目當干擾（建議補上錯誤列）`);
    return true;
  });

  if (!usable.length) throw new Error("沒有可用的主題");

  return {
    warnings,
    themes: usable.map((theme) => ({
      topic: theme.topic,
      grade: theme.grade,
      prompt: `請選擇符合「${theme.desc || theme.topic}」的方向`,
      correct: theme.correct,
      wrong: theme.wrong,
    })),
  };
}

// 相對於 index.html：上一層資料夾的 主題資料.csv
const CSV_URL = "../主題資料.csv";

async function loadCsvFromUrl(url) {
  try {
    const res = await fetch(encodeURI(url), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch (err) {
      text = new TextDecoder("big5").decode(buffer);
    }
    const { themes, warnings } = buildThemesFromRows(parseCSV(text));
    if (warnings.length) console.warn("CSV 提醒：\n" + warnings.join("\n"));
    customThemes = themes;
    return { ok: true, count: themes.length, warnings: warnings.length };
  } catch (err) {
    console.warn("讀取 CSV 失敗，沿用目前的題目：", err);
    return { ok: false, error: err };
  }
}

function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// 主題 ≤ 6：照檔案順序；主題 > 6：每次遊戲隨機抽 6 個；主題不足 6：循環補滿
function buildStageRules() {
  if (!customThemes || !customThemes.length) return DEFAULT_STAGE_RULES;
  const picked =
    customThemes.length > STAGE_COUNT
      ? shuffled(customThemes).slice(0, STAGE_COUNT)
      : customThemes.slice();
  for (let i = 0; picked.length < STAGE_COUNT; i += 1) {
    picked.push(customThemes[i % customThemes.length]);
  }
  return picked.map((theme) => ({
    prompt: theme.prompt,
    correct: theme.correct,
    wrong: theme.wrong,
  }));
}

let toastTimer = null;

function showToast(message, isError) {
  toastEl.textContent = message;
  toastEl.classList.toggle("is-error", Boolean(isError));
  toastEl.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("is-show"), 4500);
}

// 項目圖片：先用 Image() 載入並解碼，完成後才換到畫面上。
// 找不到圖或載入失敗時改用文字卡；失敗的項目過一段時間會重新嘗試，
// 避免短暫斷線讓整關都變成文字卡。
const ITEM_LOAD_TIMEOUT_MS = 5000;
const ITEM_RETRY_MS = 15000;
// id -> { promise: Promise<可直接用的 src>, img }
// 保留 Image 的引用，畫面上的 <img> 才能直接重用已解碼的圖、不必重新下載
const itemImageCache = new Map();

// 整關預載排在這裡一張一張送，不要一次把連線塞滿；
// 題目要用的圖才能立刻以高優先權發出，不被整關預載和角色動畫圖擋住。
const preloadQueue = [];
let preloading = false;

function queueItemPreload(ids) {
  ids.forEach((id) => {
    if (!itemImageCache.has(id) && !preloadQueue.includes(id)) preloadQueue.push(id);
  });
  pumpItemPreload();
}

function pumpItemPreload() {
  if (preloading || !preloadQueue.length) return;
  preloading = true;
  // 某張預載卡住時不要擋住後面的圖：等到上限時間就先換下一張，
  // 卡住那張仍在背景下載，載完一樣會進快取。
  const loading = loadItemImage(preloadQueue.shift());
  Promise.race([loading, wait(ITEM_LOAD_TIMEOUT_MS)]).then(() => {
    preloading = false;
    pumpItemPreload();
  });
}

function loadItemImage(id, priority = "low") {
  if (!itemImageCache.has(id)) {
    // 還排在預載佇列裡就直接插隊，用這次的優先權送出，不必等輪到它
    const queued = preloadQueue.indexOf(id);
    if (queued >= 0) preloadQueue.splice(queued, 1);
    const img = new Image();
    let settle;
    const promise = new Promise((resolve) => {
      settle = resolve;
      img.onload = () => {
        const src = img.src;
        img.decode().then(() => resolve(src), () => resolve(src));
      };
      img.onerror = () => {
        resolve(labelCard(id));
        setTimeout(() => {
          if (itemImageCache.get(id)?.promise === promise) itemImageCache.delete(id);
        }, ITEM_RETRY_MS);
      };
    });
    img.fetchPriority = priority;
    img.src = itemSrc(id);
    itemImageCache.set(id, { promise, img, settle });
  }
  return itemImageCache.get(id).promise;
}

// 畫面要顯示的圖最多等 ITEM_LOAD_TIMEOUT_MS，避免網路卡住時遊戲停住。
// 逾時就先用文字卡，並中止這次請求，下次出現時重新下載。
function itemImageForDisplay(id) {
  const loading = loadItemImage(id, "high");
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      const entry = itemImageCache.get(id);
      if (entry?.promise === loading) {
        entry.img.onload = entry.img.onerror = null;
        entry.img.removeAttribute("src");
        itemImageCache.delete(id);
        // 其他也在等這張圖的地方（另一位玩家）一起改用文字卡，不要白等
        entry.settle(labelCard(id));
      }
      resolve(labelCard(id));
    }, ITEM_LOAD_TIMEOUT_MS);
  });
  return Promise.race([loading, timeout]).finally(() => clearTimeout(timer));
}

// 題目要用的圖優先下載，不要排在整關預載和角色動畫圖後面
function preloadQuestionImages(question) {
  return Promise.all([
    loadItemImage(question.leftItem, "high"),
    loadItemImage(question.rightItem, "high"),
  ]);
}

// 開新關卡時在背景下載這一關會用到的所有圖示
function preloadStageImages(level) {
  const rule = stageRules[level - 1];
  preloadQueue.length = 0; // 上一關沒排完的就不用再載了
  queueItemPreload([...rule.correct, ...wrongItemsFor(rule)]);
}

// 畫面上的 <img> 自己載入失敗時（例如快取過期後重新下載失敗），一樣改用文字卡
function setItemImage(el, id, src) {
  el.alt = id;
  el.onerror = () => {
    el.onerror = null;
    el.src = labelCard(id);
  };
  el.src = src;
}

// 畫面圖示解碼失敗或逾時也改用文字卡，卡片解碼好才開放作答。
async function waitItemsDecoded(...items) {
  await Promise.all(items.map(async (el) => {
    const src = el.src;
    let timer;
    const decoded = await Promise.race([
      el.decode().then(() => true, () => false),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), ITEM_LOAD_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    // 舊題的等待不能覆寫新題；onerror 換上的文字卡則繼續等解碼。
    if (el.src !== src) {
      if (el.src.startsWith("data:image/svg+xml")) await el.decode().catch(() => {});
      return;
    }
    if (decoded) return;
    el.onerror = null;
    el.src = labelCard(el.alt);
    await el.decode().catch(() => {});
  }));
}

// 立刻隱藏，不播淡出，避免上一關的圖示在新關卡開始時慢慢淡掉
function hideItemsNow(...items) {
  items.forEach((el) => {
    el.style.transition = "none";
    el.classList.add("is-fading");
  });
  void items[0].offsetWidth;
  items.forEach((el) => {
    el.style.transition = "";
  });
}

function xmlEscape(text) {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function labelCard(text) {
  const chars = Array.from(text);
  const half = Math.ceil(chars.length / 2);
  const lines =
    chars.length > 3
      ? [chars.slice(0, half).join(""), chars.slice(half).join("")]
      : [text];
  const longest = Math.max(...lines.map((line) => Array.from(line).length));
  const size = Math.min(72, Math.floor(168 / longest));
  const lineHeight = size * 1.2;
  const firstY = 100 - ((lines.length - 1) * lineHeight) / 2;
  const tspans = lines
    .map(
      (line, index) =>
        `<text x="100" y="${firstY + index * lineHeight}" text-anchor="middle" dominant-baseline="central" font-size="${size}" font-weight="800" fill="#2f5d3a" font-family="'Microsoft JhengHei','Noto Sans TC','PingFang TC',sans-serif">${xmlEscape(line)}</text>`
    )
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">` +
    `<rect x="6" y="6" width="188" height="188" rx="36" fill="#fff" stroke="#57b8e8" stroke-width="8"/>` +
    tspans +
    `</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// 必須放在檔案最後：init() 會用到上面所有 const，太早呼叫會踩到暫時性死區
init();
