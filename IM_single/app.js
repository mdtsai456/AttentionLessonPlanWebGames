// =============================================================================
// IM_single / 指令出擊（Instruction Memory）
//
// 依 Unity Instruction Memory 的規則，每關隨機產生房間地圖。玩家左右移動，
// 靠近門或物品後，按空白鍵或點擊，執行 Take（拿取）、Place（放下）或
// GoTo（進入房間）。背包固定四格。
//
// 場次流程：
//   init → startGame → prepareStage（出題卡、生成地圖）
//        → beginCurrentStage（開始倒數與移動）
//        → 過關或逾時 → finishOrAdvance
// 完成第 3 關後顯示中場休息。其餘關卡進入下一關，全部完成後呼叫 finishGame。
//
// 目前由前端執行。檔案底部的 fetchQuestions／submitResult 預留題目讀取與成績送出介面。
// =============================================================================

// -----------------------------------------------------------------------------
// 常數
// -----------------------------------------------------------------------------

/** 第 3 關結束後顯示中場休息。索引從 0 開始，此時 index 即將變為 3。 */
const MIDWAY_STAGE = 3;
const TIME_LIMIT_SEC = 60;
/** 背包格數上限。 */
const BAG_SIZE = 4;
/** 左右移動速度（畫面寬度百分比 / 秒）。 */
const MOVE_SPEED = 26;
/** 玩家可與門或物品互動的水平距離，單位為畫面寬度百分比。 */
const NEAR_RANGE = 7.5;
/** 玩家移動的左右邊界，避免離開畫面。 */
const PLAYER_MIN = 10;
const PLAYER_MAX = 90;
/** 角色待機與行走動畫的每幀間隔。 */
const IDLE_FRAME_MS = 180;
const WALK_FRAME_MS = 90;
/** 進入房間時，黑色覆蓋層的淡入與淡出時長。 */
const ROOM_FADE_MS = 280;
/** GoTo 題進入正確房間後，等待玩家看清畫面再判定過關。 */
const GOTO_WAIT_MS = 1000;
/** 後端進度僅接受 0／50／100 三個值。 */
const PROGRESS_STEPS = [0, 50, 100];

// -----------------------------------------------------------------------------
// 房間與物品資料
// -----------------------------------------------------------------------------

/** Unity 房間類型 id。下方兩個表提供中文名稱與背景圖片的對應關係。 */
const ROOM_TYPES = ["Kitchen", "LivingRoom", "Bedroom", "Bathroom", "Study"];
const ROOM_LABEL = {
  Kitchen: "廚房",
  LivingRoom: "客廳",
  Bedroom: "臥室",
  Bathroom: "浴室",
  Study: "書房",
};
const ROOM_SCENE = {
  Kitchen: "img/scene/kitchen.png",
  LivingRoom: "img/scene/livingroom.png",
  Bedroom: "img/scene/bedroom.png",
  Bathroom: "img/scene/bathroom.png",
  Study: "img/scene/studyroom.png",
};

/** 物品 id 對應中文名稱。圖片路徑固定為 img/object/{id}.png。 */
const OBJECT_LABEL = {
  apple: "蘋果",
  banana: "香蕉",
  book: "書",
  boot: "靴子",
  carrot: "紅蘿蔔",
  chair: "椅子",
  fish: "魚",
  hammer: "槌子",
  hat: "帽子",
  key: "鑰匙",
  soccer: "足球",
  umbrella: "雨傘",
};
const OBJECTS = Object.keys(OBJECT_LABEL);

/**
 * 每個房間由左至右設置四個放置點。
 * x 是畫面寬度百分比。角色移動至該位置後，才能互動。
 */
const ZONE_LAYOUT = [
  { id: "ZoneC", x: 20 },
  { id: "ZoneA", x: 36 },
  { id: "ZoneB", x: 64 },
  { id: "ZoneD", x: 84 },
];

/**
 * 門在畫面上的水平位置。
 * 同一房間同時有上門與下門時，將兩者左右錯開，避免重疊。
 */
const DOOR_X = { left: 8, right: 92, up: 44, down: 56 };

const PLAYER_IDLE = [1, 2, 3, 4].map((n) => `img/player/dog_idle_0${n}.png`);
const PLAYER_WALK = [1, 2, 3, 4, 5, 6, 7, 8].map(
  (n) => `img/player/dog_walk_0${n}.png`
);

/**
 * 未連接後端時，使用此本地題庫。
 * problemType：Take 拿取物品／Place 放至指定房間／GoTo 進入指定房間。
 * targetRoom 為 "None" 時，不限制房間。
 */
const LOCAL_QUESTIONS = [
  {
    id: "P001",
    displayText: "請拿取蘋果",
    problemType: "Take",
    targetItems: ["apple"],
    targetRoom: "None",
    timeLimit: 60,
  },
  {
    id: "P002",
    displayText: "請前往浴室",
    problemType: "GoTo",
    targetItems: [],
    targetRoom: "Bathroom",
    timeLimit: 60,
  },
  {
    id: "P003",
    displayText: "請把書放到書房",
    problemType: "Place",
    targetItems: ["book"],
    targetRoom: "Study",
    timeLimit: 60,
  },
  {
    id: "P004",
    displayText: "請拿取香蕉和帽子",
    problemType: "Take",
    targetItems: ["banana", "hat"],
    targetRoom: "None",
    timeLimit: 60,
  },
  {
    id: "P005",
    displayText: "請前往廚房",
    problemType: "GoTo",
    targetItems: [],
    targetRoom: "Kitchen",
    timeLimit: 60,
  },
  {
    id: "P006",
    displayText: "請把足球放到客廳",
    problemType: "Place",
    targetItems: ["soccer"],
    targetRoom: "LivingRoom",
    timeLimit: 60,
  },
];

// -----------------------------------------------------------------------------
// DOM
// -----------------------------------------------------------------------------

const bg = document.getElementById("bg");
const doorsEl = document.getElementById("doors");
const zonesEl = document.getElementById("zones");
const player = document.getElementById("player");
const playerImg = document.getElementById("player-img");
const scoreBox = document.getElementById("score-box");
const timerBox = document.getElementById("timer-box");
const backpackEl = document.getElementById("backpack");
const minimapEl = document.getElementById("minimap");
const roomNameEl = document.getElementById("room-name");
const feedbackEl = document.getElementById("feedback");
const fadeEl = document.getElementById("fade");
const problemPanel = document.getElementById("problem-panel");
const problemTitle = document.getElementById("problem-title");
const problemText = document.getElementById("problem-text");
const problemItems = document.getElementById("problem-items");
const problemHint = document.getElementById("problem-hint");
const startStageBtn = document.getElementById("start-stage-btn");
const midwayPanel = document.getElementById("midway-panel");
const midwayText = document.getElementById("midway-text");
const continueBtn = document.getElementById("continue-btn");
const midwayBackBtn = document.getElementById("midway-back-btn");
const resultEl = document.getElementById("result");
const resultTitle = document.getElementById("result-title");
const resultScore = document.getElementById("result-score");
const resultHint = document.getElementById("result-hint");
const replayBtn = document.getElementById("replay-btn");
const backBtn = document.getElementById("back-btn");

/** 左右鍵的按住狀態。點擊互動時，改用 walkTarget 自動移動至目標。 */
const keys = { left: false, right: false };
window.addEventListener("webgame:pause", () => { keys.left = keys.right = false; });

const state = {
  questions: [], // 目前題目的題庫，來源為後端或本地。
  index: 0, // 用於地圖尺寸。正式關卡使用 stage。
  stage: 1, // 目前關卡（1-based，共 6 關）
  task: null, // 目前關卡的題目
  taskCursor: 0,
  stageTasks: [], // 本關已結束的題目
  levelAccuracies: [],
  finishedStages: 0,
  endingStage: false,
  score: 0, // 過關數
  remaining: 60, // 本關剩餘秒數
  playing: false, // 場次是否正在進行。結算後為 false。
  stageLive: false, // 本關是否已按開始，可開始移動與倒數。
  busy: false, // 進入房間或轉場時，停用操作。
  startedAt: 0, // 場次開始時間，用於送出 durationSec。
  stageStartedAt: 0, // 本關開始時間（該關 timeUsage）
  timerId: null, // 每秒倒數的 interval
  walkTimer: null, // 角色動畫的 interval
  walkFrame: 0,
  anim: "", // "idle" | "walk"
  playerX: 50, // 玩家水平位置（%）
  facing: "right",
  walkTarget: null, // { x, action }。點擊門或物品時，先自動靠近，再執行互動。
  rooms: [], // 二維陣列 rooms[row][col]
  rows: 2,
  cols: 2,
  row: 0, // 目前房間的列與欄。場次固定從 (0,0) 開始。
  col: 0,
  bag: [], // [{ id, from }]。from 表示拿取物品時所在的房間類型。
  completedItems: [], // 本關已正確完成的目標物品 id
  stageResults: [], // 各關卡的成績記錄，用於送出結果。
  lastTime: 0, // requestAnimationFrame 上一幀時間戳
};

init();

// -----------------------------------------------------------------------------
// 啟動與事件
// -----------------------------------------------------------------------------

/** 預載圖片、讀取題目並綁定操作後，開始第一場遊戲。 */
async function init() {
  preloadImages();
  renderBackpack();
  const data = await fetchQuestions();
  state.questions = data.questions;
  bindEvents();
  startGame();
}

/** 綁定按鈕、鍵盤、點擊門／物品，並啟動移動迴圈。 */
function bindEvents() {
  startStageBtn.addEventListener("click", beginCurrentStage);
  continueBtn.addEventListener("click", continueAfterMidway);
  midwayBackBtn.addEventListener("click", async () => {
    continueBtn.disabled = true;
    midwayBackBtn.disabled = true;
    await saveCurrentRun(MIDWAY_STAGE);
    location.href = "../Select/index.html";
  });
  replayBtn.addEventListener("click", startGame);
  backBtn.addEventListener("click", () => {
    location.href = "../Select/index.html";
  });
  document.getElementById("leave-btn").addEventListener("click", leaveGame);

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      keys.left = true;
      state.walkTarget = null; // 手動移動時，取消自動靠近。
      event.preventDefault();
    } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
      keys.right = true;
      state.walkTarget = null;
      event.preventDefault();
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      tryInteract();
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      keys.left = false;
    } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
      keys.right = false;
    }
  });

  doorsEl.addEventListener("click", (event) => {
    const door = event.target.closest("[data-dir]");
    if (!door) return;
    goToward(Number(door.dataset.x), () => useDoor(door.dataset.dir));
  });

  zonesEl.addEventListener("click", (event) => {
    const zone = event.target.closest("[data-zone]");
    if (!zone) return;
    goToward(Number(zone.dataset.x), () => useZone(zone.dataset.zone));
  });

  requestAnimationFrame(tickMove);
}

// -----------------------------------------------------------------------------
// 關卡生命週期
// -----------------------------------------------------------------------------

/** 重新開始場次時，清除分數並從第 1 關開始。每關 60 秒，只有一題。完成或逾時後進入下一關。 */
function startGame() {
  clearInterval(state.timerId);
  state.timerId = null;
  stopWalkCycle();
  state.score = 0;
  state.playing = true;
  state.stageLive = false;
  state.busy = false;
  state.startedAt = window.WebGameRuntime.now();
  state.bag = [];
  state.completedItems = [];
  state.stageResults = [];
  state.levelAccuracies = [];
  state.finishedStages = 0;
  state.taskCursor = 0;
  state.endingStage = false;
  resultEl.classList.add("is-hidden");
  midwayPanel.classList.add("is-hidden");
  continueBtn.disabled = false;
  midwayBackBtn.disabled = false;
  hideFeedback();
  renderHud();
  renderBackpack();
  startStage(1);
}

function startStage(stageNumber) {
  state.stage = stageNumber;
  state.index = stageNumber - 1;
  state.remaining = TIME_LIMIT_SEC;
  state.stageTasks = [];
  state.endingStage = false;
  clearInterval(state.timerId);
  state.timerId = null;
  prepareTask();
}

/** 為本關題目產生地圖並放置物品，接著顯示題目卡。玩家按開始後，才開始倒數。 */
function prepareTask() {
  const list = state.questions;
  if (!list.length) {
    finishGame("complete");
    return;
  }
  state.task = list[state.taskCursor % list.length];
  state.taskCursor += 1;

  state.stageLive = false;
  state.busy = true;
  state.completedItems = [];
  state.bag = [];
  state.playerX = 50;
  state.facing = "right";
  state.walkTarget = null;
  keys.left = false;
  keys.right = false;

  const specs = generateLevelSpecs(state.stage - 1);
  state.rows = specs.rows;
  state.cols = specs.cols;
  state.rooms = generateMap(specs.rows, specs.cols);
  assignRoomTypes(state.rooms, state.task);
  placeItems(state.rooms, state.task);
  state.row = 0;
  state.col = 0;

  renderHud();
  renderBackpack();
  renderRoom();
  showProblemPanel(state.task);
}

/** 關閉題目卡，開始本關的 60 秒倒數與移動。 */
function beginCurrentStage() {
  problemPanel.classList.add("is-hidden");
  state.stageLive = true;
  state.busy = false;
  state.stageStartedAt = window.WebGameRuntime.now();
  if (!state.timerId) {
    state.timerId = setInterval(tickTimer, 1000);
  }
}

/** 中場按「繼續挑戰」後，進入下一關。 */
function continueAfterMidway() {
  midwayPanel.classList.add("is-hidden");
  startStage(state.stage + 1);
}

function currentProblem() {
  return state.task;
}

function currentRoom() {
  return state.rooms[state.row][state.col];
}

/**
 * 地圖尺寸使用 Unity 的規則。
 * 第 1、3、5 關的 index 為偶數，尺寸為 2×3。
 * 第 2、4、6 關的 index 為奇數，尺寸為 2×2。
 */
function generateLevelSpecs(index) {
  return index % 2 === 1 ? { rows: 2, cols: 2 } : { rows: 2, cols: 3 };
}

// -----------------------------------------------------------------------------
// 地圖生成
// -----------------------------------------------------------------------------

/**
 * 產生 rows×cols 的房間網格。先使用 DFS 連接所有房間，再隨機增加門。
 * 每個房間包含四個空的 zone。placeItems 隨後放入物品。
 */
function generateMap(rows, cols) {
  const rooms = [];
  for (let r = 0; r < rows; r++) {
    rooms[r] = [];
    for (let c = 0; c < cols; c++) {
      rooms[r][c] = {
        row: r,
        col: c,
        type: null,
        hasLeft: false,
        hasRight: false,
        hasUp: false,
        hasDown: false,
        zones: ZONE_LAYOUT.map((slot) => ({ id: slot.id, x: slot.x, item: null })),
      };
    }
  }

  const visited = new Set();
  dfs(0, 0);
  addExtraConnections(2);
  return rooms;

  /** 從 (0,0) 遍歷所有未訪問的相鄰房間，並建立連接門，避免房間孤立。 */
  function dfs(r, c) {
    visited.add(key(r, c));
    const neighbors = shuffle(getNeighbors(r, c));
    neighbors.forEach(([nr, nc, dir]) => {
      if (!visited.has(key(nr, nc))) {
        connect(rooms[r][c], rooms[nr][nc], dir);
        dfs(nr, nc);
      }
    });
  }

  /** 在已連通的地圖上隨機增加門，提供多條路線。 */
  function addExtraConnections(count) {
    for (let i = 0; i < count; i++) {
      const r = rand(rows);
      const c = rand(cols);
      const neighbors = getNeighbors(r, c);
      if (!neighbors.length) continue;
      const [nr, nc, dir] = neighbors[rand(neighbors.length)];
      connect(rooms[r][c], rooms[nr][nc], dir);
    }
  }

  function getNeighbors(r, c) {
    const list = [];
    if (c > 0) list.push([r, c - 1, "Left"]);
    if (c < cols - 1) list.push([r, c + 1, "Right"]);
    if (r > 0) list.push([r - 1, c, "Up"]);
    if (r < rows - 1) list.push([r + 1, c, "Down"]);
    return list;
  }
}

/** 在相鄰房間建立對應的門，方向為左與右，或上與下。 */
function connect(a, b, dir) {
  if (dir === "Left") {
    a.hasLeft = true;
    b.hasRight = true;
  } else if (dir === "Right") {
    a.hasRight = true;
    b.hasLeft = true;
  } else if (dir === "Up") {
    a.hasUp = true;
    b.hasDown = true;
  } else if (dir === "Down") {
    a.hasDown = true;
    b.hasUp = true;
  }
}

/**
 * 為每個網格指定房間類型。
 * GoTo 題的起點 (0,0) 不可是目標房間。其他題型隨機指定起點類型。
 * 優先將目標房間與物品的預設房間類型指定至其他網格。
 * 其餘網格優先使用未出現的類型。五種房間皆使用後，才允許重複。
 */
function assignRoomTypes(rooms, problem) {
  const cells = rooms.flat();
  const required = [];
  if (problem.targetRoom && problem.targetRoom !== "None") {
    required.push(problem.targetRoom);
  }
  problem.targetItems.forEach((item) => {
    const prefer = itemHome(item);
    if (prefer && !required.includes(prefer)) required.push(prefer);
  });

  const startForbidden =
    problem.problemType === "GoTo" ? problem.targetRoom : null;
  const startPool = ROOM_TYPES.filter((type) => type !== startForbidden);
  rooms[0][0].type = pick(startPool);

  const used = new Set([rooms[0][0].type]);
  const rest = shuffle(cells.filter((room) => !(room.row === 0 && room.col === 0)));
  required
    .filter((type) => type !== rooms[0][0].type)
    .forEach((type, index) => {
      if (!rest[index]) return;
      rest[index].type = type;
      used.add(type);
    });

  rest.forEach((room) => {
    if (room.type) return;
    const unused = ROOM_TYPES.filter((type) => !used.has(type));
    room.type = unused.length ? pick(unused) : pick(ROOM_TYPES);
    used.add(room.type);
  });
}

/**
 * 將目標物品放入指定房間的 zone。其餘格子有 50% 機率放入干擾物。
 * Take 題若指定房間，目標只出現在該房間。
 * Place 題的目標初始位置不可在指定的放置房間，避免無須移動物品即可完成。
 */
function placeItems(rooms, problem) {
  const allRooms = rooms.flat();
  let hostRooms = allRooms;
  if (problem.problemType === "Take" && problem.targetRoom !== "None") {
    hostRooms = allRooms.filter((room) => room.type === problem.targetRoom);
  } else if (problem.problemType === "Place" && problem.targetRoom !== "None") {
    hostRooms = allRooms.filter((room) => room.type !== problem.targetRoom);
  }
  if (!hostRooms.length) hostRooms = allRooms;

  const hostZones = shuffle(
    hostRooms.flatMap((room) => room.zones.map((zone) => ({ room, zone })))
  );
  problem.targetItems.forEach((item, index) => {
    if (hostZones[index]) hostZones[index].zone.item = item;
  });

  const used = new Set(problem.targetItems);
  const deco = OBJECTS.filter((item) => !used.has(item));
  allRooms.forEach((room) => {
    room.zones.forEach((zone) => {
      if (zone.item) return;
      if (Math.random() < 0.5 && deco.length) zone.item = pick(deco);
    });
  });
}

/** 物品的預設房間類型，用於分配位置，不是必要條件。 */
function itemHome(item) {
  if (["apple", "banana", "carrot", "fish"].includes(item)) return "Kitchen";
  if (["book", "key", "hammer"].includes(item)) return "Study";
  if (["hat", "boot", "chair"].includes(item)) return "Bedroom";
  if (["soccer", "umbrella"].includes(item)) return "LivingRoom";
  return "LivingRoom";
}

// -----------------------------------------------------------------------------
// 畫面
// -----------------------------------------------------------------------------

/** 依目前房間重繪背景、門、物品與小地圖，並將角色設在 playerX。 */
function renderRoom() {
  const room = currentRoom();
  bg.style.backgroundImage = `url("${ROOM_SCENE[room.type]}")`;
  roomNameEl.textContent = ROOM_LABEL[room.type];
  player.style.left = `${state.playerX}%`;
  setPlayerFacing(state.facing);
  playAnim("idle");
  renderDoors(room);
  renderZones(room);
  renderMinimap();
  updateNearHints();
}

/**
 * 依房間的開門方向放置門。
 * 同時有上門與下門時，將兩者左右錯開。只有一個門時，置於中央。
 */
function renderDoors(room) {
  const dirs = [];
  if (room.hasLeft) dirs.push(["left", "左", DOOR_X.left]);
  if (room.hasRight) dirs.push(["right", "右", DOOR_X.right]);
  if (room.hasUp && room.hasDown) {
    dirs.push(["up", "上", DOOR_X.up]);
    dirs.push(["down", "下", DOOR_X.down]);
  } else if (room.hasUp) {
    dirs.push(["up", "上", 50]);
  } else if (room.hasDown) {
    dirs.push(["down", "下", 50]);
  }

  doorsEl.innerHTML = dirs
    .map(
      ([dir, label, x]) => `
        <button class="door" data-dir="${dir}" data-x="${x}" style="left:${x}%" type="button">
          <img src="img/item/closedoor.png" alt="${label}門" draggable="false" />
        </button>
      `
    )
    .join("");
}

/**
 * 繪製四個放置點。空位保留可點擊的 zone，供放下物品使用。
 * 物品圖片預設為透明。角色靠近後，由 CSS 的 .is-near 顯示圖片。
 */
function renderZones(room) {
  zonesEl.innerHTML = room.zones
    .map((zone) => {
      const body = zone.item
        ? `<img src="${objectSrc(zone.item)}" alt="${OBJECT_LABEL[zone.item]}" />`
        : `<div class="zone-slot" aria-hidden="true"></div>`;
      return `<button class="zone" data-zone="${zone.id}" data-x="${zone.x}" style="left:${zone.x}%" type="button">${body}</button>`;
    })
    .join("");
}

/** 右上小地圖：目前房間標成黃色。 */
function renderMinimap() {
  minimapEl.style.gridTemplateColumns = `repeat(${state.cols}, var(--map-cell))`;
  let html = "";
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const here = r === state.row && c === state.col;

      // 開始：20260929，willie。
      // 有門時繪製通道。沒有門時不繪製通道。
      const room = state.rooms[r][c];
      const connections = [
        room.hasRight
          ? '<span class="map-connection is-right" aria-hidden="true"></span>'
          : "",
        room.hasDown
          ? '<span class="map-connection is-down" aria-hidden="true"></span>'
          : "",
      ].join("");
      // 結束：20260929，willie。

      html += `<span class="map-cell${here ? " is-here" : ""}" title="${ROOM_LABEL[room.type]}">${connections}</span>`;
    }
  }
  minimapEl.innerHTML = html;
}

function renderHud() {
  scoreBox.textContent = `${state.score} 分`;
  timerBox.textContent = `${Math.max(0, state.remaining)} 秒`;
}

/** 依 bag 繪製四個背包格。空格不顯示圖片。 */
function renderBackpack() {
  backpackEl.innerHTML = Array.from({ length: BAG_SIZE }, (_, index) => {
    const entry = state.bag[index];
    return `<div class="pack-slot">${
      entry ? `<img src="${objectSrc(entry.id)}" alt="${OBJECT_LABEL[entry.id]}" />` : ""
    }</div>`;
  }).join("");
}

/** 關卡開始前的題目卡：指令文字、目標物品圖、操作提示。 */
function showProblemPanel(problem) {
  problemTitle.textContent = `第 ${state.stage} 關`;
  problemText.textContent = problem.displayText;
  problemItems.innerHTML = problem.targetItems
    .map((item) => `<img src="${objectSrc(item)}" alt="${OBJECT_LABEL[item]}" />`)
    .join("");
  problemHint.textContent = controlHint(problem);
  problemPanel.classList.remove("is-hidden");
}

// -----------------------------------------------------------------------------
// 計時與移動
// -----------------------------------------------------------------------------

function tickTimer() {
  if (!state.playing || !state.stageLive) return;
  state.remaining -= 1;
  renderHud();
  if (state.remaining <= 0) timeOut();
}

/**
 * 每幀更新移動，優先處理鍵盤輸入。
 * 沒有按鍵且存在 walkTarget 時，自動移動至點擊的門或物品。
 * 距離 ≤ 1.2 時，執行已記錄的 action。
 */
function tickMove(now) {
  const dt = Math.min(0.05, (now - (state.lastTime || now)) / 1000);
  state.lastTime = now;

  if (state.playing && state.stageLive && !state.busy) {
    let dir = 0;
    if (keys.left) dir -= 1;
    if (keys.right) dir += 1;
    if (!dir && state.walkTarget != null) {
      const gap = state.walkTarget.x - state.playerX;
      if (Math.abs(gap) <= 1.2) {
        const action = state.walkTarget.action;
        state.walkTarget = null;
        if (action) action();
      } else {
        dir = gap > 0 ? 1 : -1;
      }
    }

    if (dir) {
      setPlayerFacing(dir < 0 ? "left" : "right");
      state.playerX = clamp(state.playerX + dir * MOVE_SPEED * dt, PLAYER_MIN, PLAYER_MAX);
      player.style.left = `${state.playerX}%`;
      playAnim("walk");
    } else {
      playAnim("idle");
    }
    updateNearHints();
  }

  requestAnimationFrame(tickMove);
}

/** 點擊門或物品時，若已靠近，則立即互動。否則記錄目標，由 tickMove 自動移動。 */
function goToward(x, action) {
  if (!state.playing || !state.stageLive || state.busy) return;
  if (Math.abs(state.playerX - x) <= NEAR_RANGE) {
    action();
    return;
  }
  state.walkTarget = { x, action };
}

/**
 * 依玩家與目標的距離切換 .is-near。
 * 靠近門時，顯示開門圖片。靠近物品時，顯示黃框與圖片。CSS 控制透明度。
 */
function updateNearHints() {
  doorsEl.querySelectorAll(".door").forEach((door) => {
    const near = Math.abs(state.playerX - Number(door.dataset.x)) <= NEAR_RANGE;
    door.classList.toggle("is-near", near);
    const img = door.querySelector("img");
    if (img) img.src = near ? "img/item/opendoor.png" : "img/item/closedoor.png";
  });
  zonesEl.querySelectorAll(".zone").forEach((zone) => {
    zone.classList.toggle(
      "is-near",
      Math.abs(state.playerX - Number(zone.dataset.x)) <= NEAR_RANGE
    );
  });
}

/** 按空白鍵或 Enter 時，優先進入互動範圍內的門。否則與最近的放置點互動。 */
function tryInteract() {
  if (!state.playing || !state.stageLive || state.busy) return;
  const door = nearest(doorsEl.querySelectorAll(".door"));
  const zone = nearest(zonesEl.querySelectorAll(".zone"));
  const doorDist = door ? Math.abs(state.playerX - Number(door.dataset.x)) : 99;
  const zoneDist = zone ? Math.abs(state.playerX - Number(zone.dataset.x)) : 99;
  if (door && doorDist <= NEAR_RANGE && doorDist <= zoneDist) {
    useDoor(door.dataset.dir);
    return;
  }
  if (zone && zoneDist <= NEAR_RANGE) useZone(zone.dataset.zone);
}

function nearest(nodes) {
  let best = null;
  let bestDist = 99;
  nodes.forEach((node) => {
    const dist = Math.abs(state.playerX - Number(node.dataset.x));
    if (dist < bestDist) {
      best = node;
      bestDist = dist;
    }
  });
  return best;
}

/**
 * 進入相鄰房間時，先淡出，再更新房間與入場位置，最後淡入。
 * 使用左右門時，從相鄰房間的對側進入。
 * GoTo 題進入目標房間後，等待 GOTO_WAIT_MS，再判定過關。
 */
async function useDoor(dir) {
  if (state.busy) return;
  const room = currentRoom();
  let nextRow = state.row;
  let nextCol = state.col;
  let entryX = 50;
  if (dir === "left" && room.hasLeft) {
    nextCol -= 1;
    entryX = DOOR_X.right;
  } else if (dir === "right" && room.hasRight) {
    nextCol += 1;
    entryX = DOOR_X.left;
  } else if (dir === "up" && room.hasUp) {
    nextRow -= 1;
    entryX = 50;
  } else if (dir === "down" && room.hasDown) {
    nextRow += 1;
    entryX = 50;
  } else {
    return;
  }

  state.busy = true;
  fadeEl.classList.add("is-on");
  await wait(ROOM_FADE_MS);
  state.row = nextRow;
  state.col = nextCol;
  state.playerX = entryX;
  state.walkTarget = null;
  renderRoom();
  fadeEl.classList.remove("is-on");
  handleProcess("GoTo", currentRoom().type, "None");
  const problem = currentProblem();
  const success =
    problem.problemType === "GoTo" && problem.targetRoom === currentRoom().type;
  await wait(success ? GOTO_WAIT_MS : 80);
  if (success && state.stageLive) {
    passStage();
    return;
  }
  state.busy = false;
}

/**
 * 與放置點互動時，若為空位，則放下背包第一格的物品。
 * 若有物品，則放入背包。背包已滿時，只顯示提示。
 */
function useZone(zoneId) {
  if (state.busy) return;
  const zone = currentRoom().zones.find((item) => item.id === zoneId);
  if (!zone) return;

  if (!zone.item) {
    const first = state.bag[0];
    if (!first) return;
    state.bag.shift();
    zone.item = first.id;
    renderZones(currentRoom());
    renderBackpack();
    updateNearHints();
    handleProcess("Place", first.id, first.from);
    return;
  }

  if (state.bag.length >= BAG_SIZE) {
    showFeedback("背包滿了", false);
    return;
  }
  const taken = zone.item;
  state.bag.push({ id: taken, from: currentRoom().type });
  zone.item = null;
  renderZones(currentRoom());
  renderBackpack();
  updateNearHints();
  handleProcess("Take", taken, "None");
}

// -----------------------------------------------------------------------------
// 過關判定（對齊 Unity Instruction Memory）
// -----------------------------------------------------------------------------

/**
 * 記錄 Take／Place 的完成狀態。GoTo 由 useDoor 判定，不在此記錄物品。
 * 題型、目標物品與目前房間皆符合時，將物品加入 completedItems。
 * targetRoom 為 None 時，不限制房間。Take 題須將物品留在背包，放下後取消完成狀態。
 * Place 題從目標房間再次拿起目標物品時，取消完成狀態。
 * Take 題放回物品且 from 符合指定房間時，取消完成狀態。指定房間為 None 時，放回即取消。
 */
function handleProcess(type, id, from) {
  const problem = currentProblem();
  if (!problem || type === "GoTo") return;

  if (type === problem.problemType) {
    if (isTargetItem(id) && roomMatches(problem.targetRoom, currentRoom().type)) {
      if (!state.completedItems.includes(id)) state.completedItems.push(id);
    }
  } else if (isTargetItem(id)) {
    if (type === "Take" && roomMatches(problem.targetRoom, currentRoom().type)) {
      state.completedItems = state.completedItems.filter((item) => item !== id);
    } else if (type === "Place" && roomMatches(problem.targetRoom, from)) {
      state.completedItems = state.completedItems.filter((item) => item !== id);
    }
  }

  if (type === problem.problemType) completedItemTask();
}

function isTargetItem(id) {
  return currentProblem().targetItems.includes(id);
}

/** targetRoom 為空或 "None" 時，所有房間皆符合條件。 */
function roomMatches(targetRoom, roomType) {
  return !targetRoom || targetRoom === "None" || targetRoom === roomType;
}

/** Take／Place 題的所有目標物品皆加入 completedItems 時，判定過關。 */
function completedItemTask() {
  const problem = currentProblem();
  const unique = [...new Set(state.completedItems)];
  if (unique.length === problem.targetItems.length && problem.targetItems.length > 0) {
    passStage();
  }
}

function passStage() {
  if (!state.stageLive || state.endingStage) return;
  state.stageLive = false;
  state.busy = true;
  commitStage(true);
  state.score += 1;
  renderHud();
  showFeedback("完成！", true);
  endStage();
}

/** 本關的 60 秒結束時，將題目記為未完成，並進入下一關或結算。 */
function timeOut() {
  if (!state.stageLive || state.endingStage) return;
  state.stageLive = false;
  commitStage(false);
  showFeedback("時間到", false);
  endStage();
}

/** 記錄本關題目的作答結果。 */
function commitStage(passed) {
  const problem = currentProblem();
  const record = {
    problemID: problem.id,
    type: problem.problemType,
    timeLimit: TIME_LIMIT_SEC,
    targetItemCount: problem.targetItems.length,
    passed,
    timeUsage: (window.WebGameRuntime.now() - state.stageStartedAt) / 1000,
  };
  state.stageResults.push(record);
  state.stageTasks.push(record);
}

/** 題目完成或 60 秒結束後，進入下一關。第 3 關後顯示中場休息，第 6 關後結算。 */
async function endStage() {
  if (state.endingStage) return;
  state.endingStage = true;
  state.busy = true;
  state.stageLive = false;
  clearInterval(state.timerId);
  state.timerId = null;
  const tasks = state.stageTasks;
  const rate = tasks.length ? tasks.filter((item) => item.passed).length / tasks.length : 0;
  state.levelAccuracies.push(Number(rate.toFixed(4)));
  state.finishedStages = state.stage;
  await wait(700);
  hideFeedback();
  if (state.stage >= 6) {
    finishGame("complete");
    return;
  }
  if (state.stage === MIDWAY_STAGE) {
    showMidway();
    return;
  }
  await window.showStageClear(state.stage);
  startStage(state.stage + 1);
}

/** 顯示中場畫面，並送出 progress = 50 的結果，使用 Unity 的中場送出規則。 */
function showMidway() {
  state.busy = true;
  midwayText.innerHTML = "第 3 關已結束<br>要繼續遊玩嗎？";
  midwayPanel.classList.remove("is-hidden");
}

/** 所有關卡結束後結算。單關逾時不會結束整場遊戲。 */
function finishGame(reason) {
  if (!state.playing) return;
  state.playing = false;
  state.stageLive = false;
  state.busy = true;
  clearInterval(state.timerId);
  stopWalkCycle();
  problemPanel.classList.add("is-hidden");
  midwayPanel.classList.add("is-hidden");

  const answered = Math.max(state.stageResults.length, 1);
  resultTitle.textContent = "挑戰完成！";
  resultScore.textContent = `${state.score} / ${answered} 分`;
  resultHint.textContent = "六關都結束了";
  resultEl.classList.remove("is-hidden");

  void saveCurrentRun(6);
}

let savedStage = 0;

async function leaveGame() {
  const leaveBtn = document.getElementById("leave-btn");
  leaveBtn.disabled = true;
  const completed = state.finishedStages;
  const stage = completed >= 6 ? 6 : completed >= MIDWAY_STAGE ? MIDWAY_STAGE : 0;
  if (stage && stage !== savedStage) await saveCurrentRun(stage);
  window.askLeave("../Select/index.html");
  leaveBtn.disabled = false;
}

function saveCurrentRun(stage) {
  savedStage = stage;
  const answered = Math.max(state.stageResults.length, 1);
  const failed = state.stageResults.filter((item) => !item.passed).length;
  return submitResult({
    score: state.score,
    wrong: failed,
    accuracy: Math.round((state.score / answered) * 100),
    duration: window.WebGameRuntime.now() - state.startedAt,
    stage,
    levelAccuracy: state.levelAccuracies.slice(0, stage).join(","),
    avgReactionMs: averageReaction(state.stageResults),
  });
}

function averageReaction(stages) {
  if (!stages.length) return 0;
  const total = stages.reduce((sum, item) => sum + Number(item.timeUsage || 0), 0);
  return (total / stages.length) * 1000;
}

// -----------------------------------------------------------------------------
// 成績送出資料
// -----------------------------------------------------------------------------

/** 建立符合 Unity SendInstructionMemoryResult 格式的 payload。 */
function buildPayload(reason, progress) {
  const summary = summarize(state.stageResults);
  return {
    gameId: "InstructionGame",
    score: state.score,
    total: state.questions.length,
    durationSec: Math.round((window.WebGameRuntime.now() - state.startedAt) / 1000),
    reason,
    progress,
    stages: state.stageResults,
    imTakePlayed: summary.takePlayed,
    imTakePassed: summary.takePassed,
    imTakeFailed: summary.takeFailed,
    imPlacePlayed: summary.placePlayed,
    imPlacePassed: summary.placePassed,
    imPlaceFailed: summary.placeFailed,
    imGotoPlayed: summary.gotoPlayed,
    imGotoPassed: summary.gotoPassed,
    imGotoFailed: summary.gotoFailed,
  };
}

/** 依題型統計遊玩、成功與失敗次數。passed == null 時，只計算該題型的總數。 */
function summarize(stages) {
  const count = (type, passed) =>
    stages.filter((stage) => stage.type === type && (passed == null || stage.passed === passed)).length;
  return {
    takePlayed: count("Take"),
    takePassed: count("Take", true),
    takeFailed: count("Take", false),
    placePlayed: count("Place"),
    placePassed: count("Place", true),
    placeFailed: count("Place", false),
    gotoPlayed: count("GoTo"),
    gotoPassed: count("GoTo", true),
    gotoFailed: count("GoTo", false),
  };
}

function controlHint(problem) {
  if (problem.problemType === "GoTo") return "用左右鍵走到門前，按空白鍵進入正確房間";
  if (problem.problemType === "Place") return "先拿起物品，走到目標房間的空位再放下";
  return "靠近物品按空白鍵拿取，放進背包";
}

function objectSrc(id) {
  return `img/object/${id}.png`;
}

function showFeedback(text, ok) {
  feedbackEl.textContent = text;
  feedbackEl.classList.toggle("is-correct", ok);
  feedbackEl.classList.toggle("is-wrong", !ok);
  feedbackEl.classList.add("is-show");
}

function hideFeedback() {
  feedbackEl.classList.remove("is-show", "is-correct", "is-wrong");
  feedbackEl.textContent = "";
}

function setPlayerFacing(facing) {
  state.facing = facing;
  player.classList.toggle("is-left", facing === "left");
}

/** 切換待機與行走動畫。相同動畫正在播放時，不重置，避免每幀返回第一張圖片。 */
function playAnim(name) {
  if (state.anim === name && state.walkTimer) return;
  stopWalkCycle();
  state.anim = name;
  const frames = name === "walk" ? PLAYER_WALK : PLAYER_IDLE;
  const delay = name === "walk" ? WALK_FRAME_MS : IDLE_FRAME_MS;
  state.walkFrame = 0;
  setPlayerSprite(frames[0]);
  state.walkTimer = setInterval(() => {
    state.walkFrame = (state.walkFrame + 1) % frames.length;
    setPlayerSprite(frames[state.walkFrame]);
  }, delay);
}

function stopWalkCycle() {
  if (!state.walkTimer) return;
  clearInterval(state.walkTimer);
  state.walkTimer = null;
}

function setPlayerSprite(src) {
  if (playerImg.getAttribute("src") === src) return;
  playerImg.src = src;
}

function preloadImages() {
  [
    ...Object.values(ROOM_SCENE),
    ...OBJECTS.map(objectSrc),
    "img/item/closedoor.png",
    "img/item/opendoor.png",
    ...PLAYER_IDLE,
    ...PLAYER_WALK,
  ].forEach((src) => {
    const image = new Image();
    image.src = src;
  });
}

function shuffle(list) {
  const copy = [...list];
  for (let i = 0; i < copy.length; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function rand(max) {
  return Math.floor(Math.random() * max);
}

function key(r, c) {
  return `${r},${c}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 將得分百分比轉換為 0／50／100，供學生進度 API 使用。 */
function toProgress(score, total) {
  if (!total) return 0;
  const percent = Math.round((score / total) * 100);
  return PROGRESS_STEPS.reduce((closest, step) =>
    Math.abs(step - percent) < Math.abs(closest - percent) ? step : closest
  );
}

// -----------------------------------------------------------------------------
// 預留的後端介面。連接後端時，修改這兩個函式。
// -----------------------------------------------------------------------------

/** 讀取目前遊戲的題目。現階段回傳本地模擬資料。 */
async function fetchQuestions() {
  // -------------------------------------------------------------------------
  // 預留的題目讀取介面。連接 API 時，修改此處。
  //
  // 建議：GET /api/games/InstructionGame/questions
  //
  // 回傳範例：
  // {
  //   questions: [
  //     {
  //       id: "P001",
  //       displayText: "請拿取蘋果",
  //       problemType: "Take",          // Take | Place | GoTo
  //       targetItems: ["apple"],       // GoTo 可為 []
  //       targetRoom: "None",           // Kitchen | LivingRoom | Bedroom | Bathroom | Study | None
  //       timeLimit: 45
  //     }
  //   ]
  // }
  //
  // const response = await fetch("/api/games/InstructionGame/questions");
  // if (!response.ok) return { questions: LOCAL_QUESTIONS };
  // return await response.json();
  // -------------------------------------------------------------------------

  return { questions: LOCAL_QUESTIONS };
}

/**
 * 將本場結果送至後端。現階段只輸出日誌。
 * 中場 progress 為 50，全部完成時為 100。兩個階段各呼叫一次。
 */
async function submitResult(data) {

  const grade = sessionStorage.getItem("grade") || sessionStorage.getItem("student1_grade");
  const caseId = sessionStorage.getItem("caseId") || sessionStorage.getItem("student1_case");
  const school = sessionStorage.getItem("school") || sessionStorage.getItem("student1_school");
  // 未取得登入學生資料時，不送出成績，避免將未登入的成績寫入正式資料庫。
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
    lessonId: "1140908_IM",
    data: {
      grade,
      caseId,
      school,
      currentDay,
      startTime: window.WebGameRuntime.toWallTime(state.startedAt),
      endTime: Date.now(),
      mode: "single",
      stats: [
        { apiname: "IM_correct", value: data.score },
        { apiname: "IM_wrong", value: data.wrong },
        { apiname: "IM_accuracy", value: data.accuracy / 100 },
        { apiname: "IM_duration", value: data.duration },
        { apiname: "IM_stage", value: data.stage },
        { apiname: "IM_levelAccuracy", value: data.levelAccuracy },
        { apiname: "IM_avgReactionMs", value: data.avgReactionMs },
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
