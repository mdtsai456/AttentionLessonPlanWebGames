// =============================================================================
// IM1 / 指令出擊（Instruction Memory）
//
// 對齊 Unity Instruction Memory：每關隨機產生房間地圖，玩家用左右移動
// 靠近門或物品，再以空白鍵／點擊執行 Take（拿取）、Place（放下）、
// GoTo（進房）。背包固定四格。
//
// 一局流程：
//   init → startGame → prepareStage（出題卡、生成地圖）
//        → beginCurrentStage（開始倒數與移動）
//        → 過關或逾時 → finishOrAdvance
//        → 第 3 關後中場休息，或進入下一關，全部完成則 finishGame
//
// 目前純前端；拉題與交卷的後端接點在檔案底部 fetchQuestions / submitResult。
// =============================================================================

// -----------------------------------------------------------------------------
// 常數
// -----------------------------------------------------------------------------

/** 第幾關結束後跳出中場休息（0-based：index 即將變成 3，也就是打完前 3 關）。 */
const MIDWAY_STAGE = 3;
/** 背包格數上限。 */
const BAG_SIZE = 4;
/** 左右移動速度（畫面寬度百分比 / 秒）。 */
const MOVE_SPEED = 26;
/** 與門、物品判定「靠近」的水平距離（同樣是畫面寬度百分比）。 */
const NEAR_RANGE = 7.5;
/** 玩家可走到的左右邊界，避免走出畫面。 */
const PLAYER_MIN = 10;
const PLAYER_MAX = 90;
/** 狗狗待機／走路動畫每幀間隔。 */
const IDLE_FRAME_MS = 180;
const WALK_FRAME_MS = 90;
/** 進房時黑幕淡入淡出時長。 */
const ROOM_FADE_MS = 280;
/** GoTo 題走進正確房間後，多等一下再過關，讓玩家看清楚。 */
const GOTO_WAIT_MS = 1000;
/** 後端進度只允許 0 / 50 / 100 三檔。 */
const PROGRESS_STEPS = [0, 50, 100];

// -----------------------------------------------------------------------------
// 房間與物品資料
// -----------------------------------------------------------------------------

/** Unity 房間類型 id；畫面中文名與背景圖用下面兩張表對應。 */
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

/** 物品 id → 中文名。圖檔路徑固定為 img/object/{id}.png。 */
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
 * 每個房間固定四個放置點（由左到右）。
 * x 是畫面寬度百分比，對應狗狗走到該位置才能互動。
 */
const ZONE_LAYOUT = [
  { id: "ZoneC", x: 20 },
  { id: "ZoneA", x: 36 },
  { id: "ZoneB", x: 64 },
  { id: "ZoneD", x: 84 },
];

/**
 * 門在畫面上的水平位置。
 * 同一房間若同時有上、下門，會左右錯開，避免疊在一起。
 */
const DOOR_X = { left: 8, right: 92, up: 44, down: 56 };

const PLAYER_IDLE = [1, 2, 3, 4].map((n) => `img/player/dog_idle_0${n}.png`);
const PLAYER_WALK = [1, 2, 3, 4, 5, 6, 7, 8].map(
  (n) => `img/player/dog_walk_0${n}.png`
);

/**
 * 後端尚未接上時使用的本地題庫。
 * problemType：Take 拿取 / Place 放到指定房間 / GoTo 走到指定房間
 * targetRoom 為 "None" 代表不限房間。
 */
const LOCAL_QUESTIONS = [
  {
    id: "P001",
    displayText: "請拿取蘋果",
    problemType: "Take",
    targetItems: ["apple"],
    targetRoom: "None",
    timeLimit: 45,
  },
  {
    id: "P002",
    displayText: "請前往浴室",
    problemType: "GoTo",
    targetItems: [],
    targetRoom: "Bathroom",
    timeLimit: 45,
  },
  {
    id: "P003",
    displayText: "請把書放到書房",
    problemType: "Place",
    targetItems: ["book"],
    targetRoom: "Study",
    timeLimit: 50,
  },
  {
    id: "P004",
    displayText: "請拿取香蕉和帽子",
    problemType: "Take",
    targetItems: ["banana", "hat"],
    targetRoom: "None",
    timeLimit: 50,
  },
  {
    id: "P005",
    displayText: "請前往廚房",
    problemType: "GoTo",
    targetItems: [],
    targetRoom: "Kitchen",
    timeLimit: 45,
  },
  {
    id: "P006",
    displayText: "請把足球放到客廳",
    problemType: "Place",
    targetItems: ["soccer"],
    targetRoom: "LivingRoom",
    timeLimit: 50,
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

/** 鍵盤左右是否按著；點擊互動時會改用 walkTarget 自動走過去。 */
const keys = { left: false, right: false };

const state = {
  questions: [], // 本題題庫（後端或本地）
  index: 0, // 目前關卡（0-based）
  score: 0, // 過關數
  remaining: 45, // 本關剩餘秒數
  playing: false, // 整局是否進行中（結算後為 false）
  stageLive: false, // 本關是否已按「開始」、可移動倒數
  busy: false, // 進房淡出、過場時鎖操作
  startedAt: 0, // 整局開始時間（交卷 durationSec）
  stageStartedAt: 0, // 本關開始時間（該關 timeUsage）
  timerId: null, // 每秒倒數的 interval
  walkTimer: null, // 狗狗動畫 interval
  walkFrame: 0,
  anim: "", // "idle" | "walk"
  playerX: 50, // 玩家水平位置（%）
  facing: "right",
  walkTarget: null, // { x, action } 點擊門／物品時自動走近再互動
  rooms: [], // 二維陣列 rooms[row][col]
  rows: 2,
  cols: 2,
  row: 0, // 目前所在房間列／欄；開局固定從 (0,0)
  col: 0,
  bag: [], // [{ id, from }] from 是拿起時所在房間類型
  completedItems: [], // 本關已正確完成的目標物品 id
  stageResults: [], // 每關紀錄，交卷用
  lastTime: 0, // requestAnimationFrame 上一幀時間戳
};

init();

// -----------------------------------------------------------------------------
// 啟動與事件
// -----------------------------------------------------------------------------

/** 預載圖片、拉題、綁定操作後開第一局。 */
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
  midwayBackBtn.addEventListener("click", () => {
    location.href = "../Select/index.html";
  });
  replayBtn.addEventListener("click", startGame);
  backBtn.addEventListener("click", () => {
    location.href = "../Select/index.html";
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      keys.left = true;
      state.walkTarget = null; // 手動移動會取消「自動走近」
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

/** 重開一局：清分數、背包、關卡紀錄，從第 1 題開始。 */
function startGame() {
  clearInterval(state.timerId);
  stopWalkCycle();
  state.index = 0;
  state.score = 0;
  state.playing = true;
  state.stageLive = false;
  state.busy = false;
  state.startedAt = Date.now();
  state.bag = [];
  state.completedItems = [];
  state.stageResults = [];
  resultEl.classList.add("is-hidden");
  midwayPanel.classList.add("is-hidden");
  hideFeedback();
  renderHud();
  renderBackpack();
  prepareStage();
}

/**
 * 準備目前這關：生地圖、放物品、把玩家放回中央，並跳出題目卡。
 * 此時還不能移動，要等玩家按「開始」。
 */
function prepareStage() {
  const problem = currentProblem();
  if (!problem) {
    finishGame("complete");
    return;
  }

  state.stageLive = false;
  state.busy = true;
  state.completedItems = [];
  state.bag = [];
  state.remaining = problem.timeLimit;
  state.playerX = 50;
  state.facing = "right";
  state.walkTarget = null;
  keys.left = false;
  keys.right = false;

  const specs = generateLevelSpecs(state.index);
  state.rows = specs.rows;
  state.cols = specs.cols;
  state.rooms = generateMap(specs.rows, specs.cols);
  assignRoomTypes(state.rooms, problem);
  placeItems(state.rooms, problem);
  state.row = 0;
  state.col = 0;

  clearInterval(state.timerId);
  renderHud();
  renderBackpack();
  renderRoom();
  showProblemPanel(problem);
}

/** 關掉題目卡，開始倒數與移動。 */
function beginCurrentStage() {
  problemPanel.classList.add("is-hidden");
  state.stageLive = true;
  state.busy = false;
  state.stageStartedAt = Date.now();
  clearInterval(state.timerId);
  state.timerId = setInterval(tickTimer, 1000);
}

/** 中場按「繼續挑戰」後，準備下一關（此時 index 已在 finishOrAdvance 加過）。 */
function continueAfterMidway() {
  midwayPanel.classList.add("is-hidden");
  prepareStage();
}

function currentProblem() {
  return state.questions[state.index];
}

function currentRoom() {
  return state.rooms[state.row][state.col];
}

/**
 * 地圖尺寸對齊 Unity：
 * 第 1、3、5 關（index 偶數）2×3；第 2、4、6 關（index 奇數）2×2。
 */
function generateLevelSpecs(index) {
  return index % 2 === 1 ? { rows: 2, cols: 2 } : { rows: 2, cols: 3 };
}

// -----------------------------------------------------------------------------
// 地圖生成
// -----------------------------------------------------------------------------

/**
 * 產生 rows×cols 的房間網格，先用 DFS 保證全部連通，再隨機加幾條額外門。
 * 每個房間帶四個空的 zone（稍後 placeItems 才放東西）。
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

  /** 從 (0,0) 走到所有未拜訪鄰居，走過就開門，確保沒有孤立房間。 */
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

  /** 在已連通的地圖上再亂開門，讓路線不只一條。 */
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

/** 兩邊房間對開同一扇門（左↔右、上↔下）。 */
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
 * 幫每個格子指定房間類型。
 * - 起點 (0,0)：GoTo 題不能一開始就站在目標房，其餘隨機。
 * - 目標房、以及目標物品「習慣出現」的房間會優先分到其他格子。
 * - 剩下的格子盡量不重複，用完五種房間後才允許重複。
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
 * 把本題目標物品放到合適房間的 zone，其餘格子有 50% 機率放干擾物。
 * Take 且指定房間：目標只出現在該房。
 * Place：目標不能一開始就在要放的那間（否則不用搬）。
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

/** 物品比較常出現的房間，用來讓地圖比較合理，不是硬性規則。 */
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

/** 依目前房間重畫背景、門、物品、小地圖，並把狗狗放到 playerX。 */
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
 * 依房間開門方向擺門。
 * 同時有上、下門時左右錯開；只有其中一個就放中間。
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
 * 畫出四個放置點。空位仍保留可點的 zone（放下用）；
 * 物品圖預設透明，靠近後 CSS .is-near 才顯示。
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
      html += `<span class="map-cell${here ? " is-here" : ""}" title="${ROOM_LABEL[state.rooms[r][c].type]}"></span>`;
    }
  }
  minimapEl.innerHTML = html;
}

function renderHud() {
  scoreBox.textContent = `${state.score} 分`;
  timerBox.textContent = `${Math.max(0, state.remaining)} 秒`;
}

/** 依 bag 畫四格；空格沒有圖。 */
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
  problemTitle.textContent = `第 ${state.index + 1} 關`;
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
 * 每幀移動。鍵盤優先；沒按鍵但有 walkTarget 時會自動走向點擊的門／物品。
 * 走到距離 ≤ 1.2 就執行當初記下的 action。
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

/**
 * 點門或物品：已經靠近就立刻互動，否則記下目標讓 tickMove 自動走過去。
 */
function goToward(x, action) {
  if (!state.playing || !state.stageLive || state.busy) return;
  if (Math.abs(state.playerX - x) <= NEAR_RANGE) {
    action();
    return;
  }
  state.walkTarget = { x, action };
}

/**
 * 依與玩家的距離切 .is-near：
 * 門靠近換成開門圖；物品靠近才顯示黃框與圖（CSS 控制透明度）。
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

/** 空白鍵／Enter：在靠近範圍內優先走門，否則與最近的放置點互動。 */
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
 * 進相鄰房間：淡出 → 換格子與入場位置（左右門從對面進來）→ 淡入。
 * GoTo 題若進到目標房，多等 GOTO_WAIT_MS 後過關。
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
 * 與放置點互動：空位就放下背包第一格；有物品就撿進背包。
 * 背包滿了只提示、不撿。
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
 * 記錄 Take / Place 是否算完成；GoTo 成敗在 useDoor 裡直接判斷，這裡不記物品。
 *
 * 正確動作：題型相符，且物品是目標、目前房間符合 targetRoom（None 則不限），
 * 就把該物品列入 completedItems。Take 題必須把東西留在背包，放下會被撤銷。
 *
 * 相反動作會撤銷：
 * - Place 題：從目標房把已放好的目標再拿起來
 * - Take 題：把已拿取的目標放回（from 符合題目房間，None 則一律算放掉）
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

/** targetRoom 為空或 "None" 時，任何房間都算符合。 */
function roomMatches(targetRoom, roomType) {
  return !targetRoom || targetRoom === "None" || targetRoom === roomType;
}

/** Take / Place：目標物品都進 completedItems 就過關。 */
function completedItemTask() {
  const problem = currentProblem();
  const unique = [...new Set(state.completedItems)];
  if (unique.length === problem.targetItems.length && problem.targetItems.length > 0) {
    passStage();
  }
}

function passStage() {
  if (!state.stageLive) return;
  state.stageLive = false;
  state.busy = true;
  commitStage(true);
  state.score += 1;
  renderHud();
  showFeedback("完成！", true);
  finishOrAdvance();
}

/** 本關時間到：記失敗，不扣整局，直接進入下一關或結算。 */
function timeOut() {
  if (!state.stageLive) return;
  state.stageLive = false;
  commitStage(false);
  showFeedback("時間到", false);
  finishOrAdvance();
}

/** 把這一關的對錯與耗時推進 stageResults，之後交卷會整包送出。 */
function commitStage(passed) {
  const problem = currentProblem();
  state.stageResults.push({
    problemID: problem.id,
    type: problem.problemType,
    timeLimit: problem.timeLimit,
    targetItemCount: problem.targetItems.length,
    passed,
    timeUsage: (Date.now() - state.stageStartedAt) / 1000,
  });
}

/**
 * 過關或逾時後的分流：最後一關結束整局；
 * 打完第 3 關（nextIndex === MIDWAY_STAGE）先中場；否則準備下一關。
 */
async function finishOrAdvance() {
  state.busy = true;
  clearInterval(state.timerId);
  await wait(700);
  hideFeedback();
  const nextIndex = state.index + 1;
  const isLast = nextIndex >= state.questions.length;
  const hitMidway = nextIndex === MIDWAY_STAGE;

  if (isLast) {
    finishGame("complete");
    return;
  }

  state.index = nextIndex;
  if (hitMidway) {
    showMidway();
    return;
  }
  prepareStage();
}

/** 中場畫面，並先送一次 progress = 50 的結果（對齊 Unity 中場交卷）。 */
function showMidway() {
  state.busy = true;
  midwayText.textContent = `目前 ${state.score} / ${state.questions.length} 分，要繼續挑戰嗎？`;
  midwayPanel.classList.remove("is-hidden");
  submitResult(buildPayload("midway", 50));
}

/** 全關結束結算。本遊戲不會因單關逾時直接結束整局。 */
function finishGame(reason) {
  if (!state.playing) return;
  state.playing = false;
  state.stageLive = false;
  state.busy = true;
  clearInterval(state.timerId);
  stopWalkCycle();
  problemPanel.classList.add("is-hidden");
  midwayPanel.classList.add("is-hidden");

  const total = state.questions.length;
  resultTitle.textContent = "闖關結束";
  resultScore.textContent = `${state.score} / ${total} 分`;
  resultHint.textContent = "所有指令都完成了";
  resultEl.classList.remove("is-hidden");

  submitResult(buildPayload(reason, toProgress(state.score, total)));
}

// -----------------------------------------------------------------------------
// 交卷資料
// -----------------------------------------------------------------------------

/** 組成 Unity SendInstructionMemoryResult 對齊的 payload。 */
function buildPayload(reason, progress) {
  const summary = summarize(state.stageResults);
  return {
    gameId: "InstructionGame",
    score: state.score,
    total: state.questions.length,
    durationSec: Math.round((Date.now() - state.startedAt) / 1000),
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

/** 依題型統計玩過／成功／失敗次數。passed == null 時只數該題型總數。 */
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

/** 切換待機／走路循環；同一種動畫已在播就不要重設，避免每幀閃回第一張。 */
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

/** 把得分百分比收成 0 / 50 / 100，給學生進度 API 用。 */
function toProgress(score, total) {
  if (!total) return 0;
  const percent = Math.round((score / total) * 100);
  return PROGRESS_STEPS.reduce((closest, step) =>
    Math.abs(step - percent) < Math.abs(closest - percent) ? step : closest
  );
}

// -----------------------------------------------------------------------------
// 後端接點（尚未接通，之後只改這兩函式即可）
// -----------------------------------------------------------------------------

/**
 * 讀取本題遊戲的題目。目前回傳本地假資料。
 */
async function fetchQuestions() {
  // -------------------------------------------------------------------------
  // 後端接點：拉題（之後接 API 時改這裡即可）
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
 * 把本局結果交給後端。目前只 log。
 * 中場（progress 50）與全破（progress 100）都會呼叫一次。
 */
async function submitResult(payload) {
  // -------------------------------------------------------------------------
  // 後端接點：交卷（之後接 API 時改這裡即可）
  //
  // 建議：POST /api/games/InstructionGame/result
  // payload 對齊 Unity IM SendInstructionMemoryResult：
  // {
  //   gameId: "InstructionGame",
  //   score: 4,
  //   total: 6,
  //   durationSec: 120,
  //   reason: "complete" | "midway",
  //   progress: 50,                     // 只會是 0 / 50 / 100
  //   stages: [{ problemID, type, timeLimit, targetItemCount, passed, timeUsage }],
  //   imTakePlayed, imTakePassed, imTakeFailed,
  //   imPlacePlayed, imPlacePassed, imPlaceFailed,
  //   imGotoPlayed, imGotoPassed, imGotoFailed
  // }
  //
  // const response = await fetch("/api/games/InstructionGame/result", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(payload),
  // });
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 後端接點：更新學生進度
  //
  // 建議：POST /api/students/me/progress
  // { gameId: "InstructionGame", progress: 50 }
  // 第 3 關結束（中場）送 50，全部完成送 100。
  // -------------------------------------------------------------------------

  console.log("[IM result payload 待接後端]", payload);
}
