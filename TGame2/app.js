// =============================================================================
// TGame2 / 勇闖迷宮（雙人）
// 左右各一組獨立 T 型迷宮與角色。P1 用 A / D，P2 用左右鍵。
// 每一關倒數 60 秒共用：任一人第一次按鍵時，兩邊同時開始計時；
// 時間到，兩邊一起進入下一關。時間內兩人各自連續作答，互不等待。
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
  await fetch(`${window.WedGameApi.resolveApiBase()}/sessions`, {
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

async function init() {
  preloadSceneImages();
  const result = await loadCsvFromUrl(CSV_URL); // 自動讀取 CSV，失敗就用預設題目
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

function startLevel(level) {
  clearInterval(session.timerId);
  session.roundToken += 1;
  session.level = level;
  session.remaining = TIME_LIMIT_SEC;
  session.timerStarted = false;
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
  // 計時不在這裡開始：等任一人第一次按鍵才同時開始（見 startLevelTimer）
}

function startLevelTimer() {
  if (session.timerStarted) return;
  session.timerStarted = true;
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
  const rule = stageRules[level - 1];
  const wrongItems =
    rule.wrong || ALL_ITEMS.filter((item) => !rule.correct.includes(item));
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
  setItemImage(player.itemLeft, question.leftItem);
  setItemImage(player.itemRight, question.rightItem);
  player.promptEl.textContent = question.prompt;
}

function renderPlayerHud(player) {
  player.scoreBox.textContent = `${player.score} 分`;
}

function renderTimer() {
  const waiting = session.playing && !session.timerStarted;
  timerBox.textContent = waiting
    ? `${TIME_LIMIT_SEC} 秒 · 按鍵開始`
    : `${Math.max(0, session.remaining)} 秒`;
}

function renderLevel() {
  levelBox.textContent = `第 ${session.level} / ${STAGE_COUNT} 關`;
}

async function chooseDirection(player, choice) {
  if (!session.playing || player.busy) return;

  const question = currentQuestion(player);
  if (!question) return;

  startLevelTimer();

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

// =============================================================================
// CSV 匯入題目
// 欄位：主題, 主題描述, 類型, 項目1 ~ 項目N（可再加一欄「年級」）
// 「類型」填 正確 / 錯誤；同一個主題可以分成多列。
// 項目名稱若有對應的 img/items/名稱.png 就顯示圖片，沒有就自動產生文字卡。
// =============================================================================

const CORRECT_TYPES = ["正確", "對", "correct", "true", "o", "1"];
const WRONG_TYPES = ["錯誤", "錯", "wrong", "false", "x", "0"];
const missingImages = new Set();

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

// 項目圖片：找不到 img/items/名稱.png 時，改用文字卡（SVG）
function setItemImage(el, id) {
  el.alt = id;
  el.onerror = () => {
    el.onerror = null;
    missingImages.add(id);
    el.src = labelCard(id);
  };
  el.src = missingImages.has(id) ? labelCard(id) : itemSrc(id);
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