//=============================================================================
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
const PRELOAD_TIMEOUT_MS = 8000;
const ITEM_SWAP_MAX_WAIT_MS = 300;
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
const leaveBtn = document.getElementById("leave-btn");
const toastEl = document.getElementById("toast");

const ALL_ITEMS = [
  "apple", "banana", "carrot", "fish",
  "boot", "book", "chair", "hammer",
  "hat", "key", "soccer", "umbrella",
];

const DEFAULT_STAGE_RULES  = [
  { prompt: "請選擇符合「可以吃的食物」的方向", correct: ["apple", "banana", "carrot"] },
  { prompt: "請選擇符合「可以坐的家具」的方向", correct: ["chair"] },
  { prompt: "請選擇符合「可以戴在頭上」的方向", correct: ["hat"] },
  { prompt: "請選擇符合「下雨時用的」的方向", correct: ["umbrella"] },
  { prompt: "請選擇符合「水裡游的動物」的方向", correct: ["fish"] },
  { prompt: "請選擇符合「用來閱讀的」的方向", correct: ["book"] },
];

let stageRules = DEFAULT_STAGE_RULES;
let customThemes = null; // 由 CSV 自動載入；失敗時維持 null 使用預設題目


const state = {
  level: 1,
  roundToken: 0,
  levelDeadline: 0,
  questionSeq: 0,
  currentQuestion: null,
  score: 0,
  wrong: 0,
  remaining: TIME_LIMIT_SEC,
  busy: false,
  ready: false,
  pendingCorrect: false,
  playing: false,
  paused: false,
  pausedRemainingMs: 0,
  pausedReactionMs: 0,
  answers: [],
  reactionSamples: [],
  questionShownAt: 0,
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
leaveBtn.addEventListener("click", leaveGame);
nextStageBtn.addEventListener("click", continueNextStage);

lobbyBtn.addEventListener("click", async () => {
  nextStageBtn.disabled = true;
  lobbyBtn.disabled = true;
  await saveCurrentRun(MID_STAGE);
  returnToLobby();
});

document.addEventListener("keydown", (event) => {
  if (event.repeat || !state.playing || state.paused || state.busy) return;

  if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
    event.preventDefault();
    chooseDirection("left");
  } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
    event.preventDefault();
    chooseDirection("right");
  }
});

async function init() {
  promptEl.textContent = "圖片載入中…";
  const scenesReady = preloadSceneImages();
  const ok = await loadCsvFromUrl(CSV_URL);
  if (!ok) showToast("讀取不到 主題資料.csv，改用預設題目", true);
  // 先排好六關，等場景、角色圖與第 1 關物品圖解碼完才開局；網路太慢時最多等 8 秒
  const rules = buildStageRules();
  stageRules = rules;
  await Promise.race([
    Promise.all([scenesReady, preloadLevelItems(1)]),
    wait(PRELOAD_TIMEOUT_MS),
  ]);
  startGame(rules);
}

function startGame(rules = buildStageRules()) {
  clearInterval(state.timerId);
  state.score = 0;
  state.wrong = 0;
  state.answers = [];
  state.reactionSamples = [];
  state.startedAt = window.WebGameRuntime.now();
  state.endReason = "";
  savedStage = 0;
  stageRules = rules;
  nextStageBtn.disabled = false;
  lobbyBtn.disabled = false;
  startLevel(1);
}

function startLevel(level) {
  clearInterval(state.timerId);
  state.roundToken += 1;
  state.level = level;
  state.levelDeadline = window.WebGameRuntime.now() + TIME_LIMIT_SEC * 1000;
  state.questionSeq = 0;
  state.remaining = TIME_LIMIT_SEC;
  state.busy = false;
  state.pendingCorrect = false;
  state.playing = true;
  state.paused = false;
  viewportGuard.hide();
  state.pausedReactionMs = 0;
  state.currentQuestion = makeQuestion(level, 0);
  preloadLevelItems(level);
  if (level < STAGE_COUNT) preloadLevelItems(level + 1);
  resultEl.classList.add("is-hidden");
  stageClearModal.classList.add("is-hidden");
  promptEl.classList.remove("is-hidden");
  resetSceneAndPlayer();
  itemLeft.classList.remove("is-fading");
  itemRight.classList.remove("is-fading");
  hideFeedback();
  renderQuestion();
  state.questionShownAt = window.WebGameRuntime.now();
  renderHud();
  state.timerId = setInterval(tick, 1000);
  viewportGuard.update();
}

function tick() {
  if (!state.playing || state.paused) return;
  state.remaining = Math.max(0, Math.ceil((state.levelDeadline - window.WebGameRuntime.now()) / 1000));
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
  // const rule = STAGE_RULES[level - 1];
  const rule = stageRules[level - 1];
  const wrongItems =  rule.wrong || ALL_ITEMS.filter((item) => !rule.correct.includes(item));
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

async function renderQuestion() {
  const question = currentQuestion();
  if (!question) return false;
  const token = state.roundToken;
  const isCurrent = () => token === state.roundToken && state.currentQuestion === question;
  state.ready = false;
  itemLeft.classList.add("is-fading");
  itemRight.classList.add("is-fading");
  setItemImage(itemLeft, question.leftItem);
  setItemImage(itemRight, question.rightItem);
  promptEl.textContent = question.prompt;
  if (!await window.TGameSupport.prepareItems([itemLeft, itemRight], ITEM_SWAP_MAX_WAIT_MS, isCurrent, labelCard)) return false;
  state.ready = true;
  state.questionShownAt = window.WebGameRuntime.now();
  itemLeft.classList.remove("is-fading");
  itemRight.classList.remove("is-fading");
  return true;
}

function renderHud() {
  scoreBox.textContent = `${state.score} 分`;
  timerBox.textContent = `${Math.max(0, state.remaining)} 秒`;
  levelBox.textContent = `${state.level} / ${STAGE_COUNT}`;
}

async function chooseDirection(choice) {
  if (!state.playing || state.paused || state.busy || !state.ready) return;
  if (window.WebGameRuntime.now() >= state.levelDeadline) {
    tick();
    return;
  }
  const token = state.roundToken;
  const question = currentQuestion();
  if (!question) return;

  state.busy = true;
  state.reactionSamples.push(Math.max(0, window.WebGameRuntime.now() - state.questionShownAt));
  const isCorrect = choice === question.correct;
  state.pendingCorrect = isCorrect;
  if (isCorrect) state.score += 1;
  else state.wrong += 1;

  state.answers.push({
    questionId: question.id,
    choice,
    correct: isCorrect,
    level: state.level,
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
  if (!sameRound(token)) return;

  if (!isCorrect) {
    hideFeedback();
    resetSceneAndPlayer();
    state.questionShownAt = window.WebGameRuntime.now();
    state.busy = false;
    return;
  }

  player.classList.remove("is-walk-forward");
  startWalkCycle(PLAYER_WALK_TURN[choice], TURN_WALK_FRAME_MS);
  scene.classList.add("is-turning");
  setSceneBg(SCENE_TURN[choice]);
  await wait(TURN_MS);

  if (!sameRound(token)) return;

  state.pendingCorrect = false;
  state.questionSeq += 1;
  state.currentQuestion = makeQuestion(state.level, state.questionSeq);
  itemLeft.classList.add("is-fading");
  itemRight.classList.add("is-fading");
  const questionReady = renderQuestion();
  hideFeedback();
  resetSceneAndPlayer(true);
  // 新物品圖解碼完才淡入，避免舊圖殘留或晚出現；最多等 300ms
  await Promise.all([
    wait(40),
    questionReady,
  ]);
  if (!sameRound(token)) return;
  state.questionShownAt = window.WebGameRuntime.now();
  player.classList.remove("is-snap");
  scene.classList.remove("is-snap");
  player.classList.add("is-arrive");
  scene.classList.add("is-arrive");
  itemLeft.classList.remove("is-fading");
  itemRight.classList.remove("is-fading");
  await wait(ARRIVE_MS);
  if (!sameRound(token)) return;
  state.busy = false;
}

function sameRound(token) {
  return token === state.roundToken && state.playing && !state.paused;
}

function pausePlay() {
  state.roundToken += 1;
  state.playing = false;
  state.paused = false;
  viewportGuard.hide();
  clearInterval(state.timerId);
  hideFeedback();
  resetSceneAndPlayer();
  itemLeft.classList.remove("is-fading");
  itemRight.classList.remove("is-fading");
  promptEl.classList.add("is-hidden");
}

function endLevel() {
  if (!state.playing) return;
  const finishedLevel = state.level;
  pausePlay();

  if (finishedLevel === MID_STAGE) {
    showLocalStageClear(true);
    return;
  }
  if (finishedLevel < STAGE_COUNT) {
    const token = state.roundToken;
    window.showStageClear(finishedLevel).then(() => {
      if (token === state.roundToken && !state.playing) startLevel(finishedLevel + 1);
    });
    return;
  }
  finishGame("complete");
}

function showLocalStageClear(isMidBreak) {
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

let savedStage = 0;

function completedStage() {
  const midOpen = !stageClearModal.classList.contains("is-hidden");
  const shared = document.querySelector(".shared-stage-clear");
  const sharedOpen = shared && !shared.hidden;
  if (state.endReason === "complete") return STAGE_COUNT;
  if (midOpen || sharedOpen) return state.level;
  return Math.max(0, state.level - 1);
}

async function leaveGame() {
  leaveBtn.disabled = true;
  const completed = completedStage();
  const stage = completed >= STAGE_COUNT ? STAGE_COUNT : completed >= MID_STAGE ? MID_STAGE : 0;
  if (stage && stage !== savedStage) await saveCurrentRun(stage);
  window.askLeave('../Select/index.html');
  leaveBtn.disabled = false;
}

function saveCurrentRun(stage) {
  savedStage = stage;
  const total = Math.max(state.score + state.wrong, 1);
  return submitResult({
    score: state.score,
    wrong: state.wrong,
    accuracy: Math.round(state.score / total * 100),
    duration: window.WebGameRuntime.now() - state.startedAt,
    stage,
    levelAccuracy: levelAccuracyText(stage),
    avgReactionMs: average(state.reactionSamples),
    questionCount: state.answers.length,
  });
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function levelAccuracyText(stageCount) {
  const values = [];
  for (let level = 1; level <= stageCount; level += 1) {
    const mine = state.answers.filter((answer) => answer.level === level);
    const ratio = mine.length
      ? mine.filter((answer) => answer.correct).length / mine.length
      : 0;
    values.push(Number(ratio.toFixed(4)));
  }
  return values.join(",");
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

// function itemSrc(id) {
//   return `img/items/${id}.png`;
// }
function itemSrc(id) {
  return `img/items/${encodeURIComponent(id)}.png`; //設定編碼，避免中文檔名出錯
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

// 預載過的 Image 物件留在這裡，避免被 GC 回收後又重新下載、解碼
const preloadedImages = new Map();

// 回傳 Promise<boolean>：圖片可用為 true，載入失敗為 false（不會 reject）
function preloadImage(src) {
  if (preloadedImages.has(src)) return preloadedImages.get(src).ready;
  const image = new Image();
  let ready;
  if (typeof image.decode === "function") {
    image.src = src;
    ready = image
      .decode()
      .then(() => true, () => image.complete && image.naturalWidth > 0);
  } else {
    ready = new Promise((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = src;
    });
  }
  preloadedImages.set(src, { image, ready });
  return ready;
}

function levelItemIds(level) {
  const rule = stageRules[level - 1];
  if (!rule) return [];
  const wrongItems =
    rule.wrong || ALL_ITEMS.filter((item) => !rule.correct.includes(item));
  return Array.from(new Set([...rule.correct, ...wrongItems]));
}

// 該關所有可能出現的物品圖先下載並解碼；找不到的直接記進 missingImages，之後改用文字卡
function preloadLevelItems(level) {
  return Promise.all(
    levelItemIds(level)
      .filter((id) => !missingImages.has(id))
      .map((id) =>
        preloadImage(itemSrc(id)).then((ok) => {
          if (!ok) missingImages.add(id);
        })
      )
  );
}

function preloadSceneImages() {
  const sources = [
    "img/TGameBack.png",
    "img/TGameNear.png",
    "img/TGameTurnLeft.png",
    "img/TGameTurnRight.png",
    PLAYER_BACK,
    PLAYER_TURN.left,
    PLAYER_TURN.right,
    ...PLAYER_WALK_BACK,
    ...PLAYER_WALK_TURN.left,
    ...PLAYER_WALK_TURN.right,
  ];
  return Promise.all(sources.map(preloadImage));
}

function showPlayerPlaceholder() {
  playerImg.classList.add("is-hidden");
  playerPlaceholder.classList.remove("is-hidden");
}

function hidePlayerPlaceholder() {
  playerPlaceholder.classList.add("is-hidden");
  playerImg.classList.remove("is-hidden");
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
// CSV parser that handles quoted fields and different delimiters
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
// Build themes from parsed CSV rows
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

// 相對於 index.html:上一層資料夾的 主題資料.csv
const CSV_URL = "../主題資料.csv";

async function loadCsvFromUrl(url) {
  try {
    const res = await fetch(encodeURI(url), { cache: "no-store" });
    if (!res.ok) return false;
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
    return true;
  } catch (err) {
    console.warn("讀取 CSV 失敗，改用預設或先前匯入的題目：", err);
    return false;
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

async function submitResult(data) {
  const grade = sessionStorage.getItem("grade") || sessionStorage.getItem("student1_grade");
  const caseId = sessionStorage.getItem("caseId") || sessionStorage.getItem("student1_case");
  const school = sessionStorage.getItem("school") || sessionStorage.getItem("student1_school");
  if (!grade || !caseId || !school) {
    console.warn("找不到登入學生資料，成績不送出");
    return;
  }
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
      startTime: window.WebGameRuntime.toWallTime(state.startedAt),
      endTime: Date.now(),
      mode: "single",
      stats: [
        { apiname: "TGame_correct", value: data.score },
        { apiname: "TGame_wrong", value: data.wrong },
        { apiname: "TGame_accuracy", value: data.accuracy / 100 },
        { apiname: "TGame_duration", value: data.duration },
        { apiname: "TGame_stage", value: data.stage },
        { apiname: "TGame_levelAccuracy", value: data.levelAccuracy },
        { apiname: "TGame_avgReactionMs", value: data.avgReactionMs },
        { apiname: "TGame_questionCount", value: data.questionCount },
      ],
    },
  };

  try {
    const res = await window.WebGameApi.submitSession(payload);
    if (res.status !== 201) {
      const errData = await res.json().catch(() => ({}));
      console.error(`成績送出失敗 ${res.status}:`, errData.detail || "寫入失敗");
    }
  } catch (err) {
    console.error("成績送出失敗：", err);
  }
}

function pauseForViewport() {
  if (!state.playing) return false;
  if (state.paused) {
    // 再次縮小時取消尚未完成的恢復，不能只檢查解碼結束時的尺寸。
    state.roundToken += 1;
    return true;
  }
  if (window.WebGameRuntime.now() >= state.levelDeadline) { tick();return false; }
  state.pausedRemainingMs = state.levelDeadline - window.WebGameRuntime.now();
  const lastAnswer = state.answers[state.answers.length - 1];
  state.pausedReactionMs = state.ready && (!state.busy || lastAnswer?.questionId !== state.currentQuestion.id)
    ? Math.max(0, window.WebGameRuntime.now() - state.questionShownAt) : 0;
  state.remaining = Math.ceil(state.pausedRemainingMs / 1000);
  state.paused = true;
  state.roundToken += 1;
  clearInterval(state.timerId);
  if (state.pendingCorrect) {
    state.questionSeq += 1;
    state.currentQuestion = makeQuestion(state.level, state.questionSeq);
  }
  state.pendingCorrect = false;
  state.busy = false;
  resetSceneAndPlayer();
  hideFeedback();
  void renderQuestion();
  renderHud();
  return true;
}

async function resumeViewport() {
  if (!state.playing || !state.paused || !viewportGuard.isUsable()) return false;
  const token = ++state.roundToken;
  const ready = await renderQuestion();
  if (!ready || token !== state.roundToken || !viewportGuard.isUsable()) return false;
  state.paused = false;
  state.levelDeadline = window.WebGameRuntime.now() + state.pausedRemainingMs;
  state.questionShownAt = window.WebGameRuntime.now() - state.pausedReactionMs;
  state.timerId = setInterval(tick, 1000);
  renderHud();
  return true;
}

const viewportGuard = window.TGameSupport.createViewportGuard({
  minWidth: 600, minHeight: 450,
  onBlock: pauseForViewport, onResume: resumeViewport, onLeave: leaveGame,
});

// 所有 const / function 都宣告完才啟動，避免 TDZ 錯誤
init();
