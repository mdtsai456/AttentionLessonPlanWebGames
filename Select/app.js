// =============================================================================
// Select / 學生選遊戲頁
// 單人：五個遊戲、一條進度。雙人：左右各一份選單（不含指令出擊），
// 各自看自己當天的進度；兩邊都按 ENTER 且選同一個遊戲才進入。
// 進度依後端該生當天場次：DCCS 只打完前 3 關為 50%，打完後段或其它遊戲為 100%。
// =============================================================================

/** 五個遊戲的固定清單。id 對資料夾，name 給畫面顯示。 */
const GAMES = [
  { id: "DCCS", name: "賽道攔截" },
  { id: "DAT", name: "瓢蟲追擊令" },
  { id: "EFT", name: "漂浮泡泡" },
  { id: "TGame", name: "勇闖迷宮" },
  { id: "InstructionGame", name: "指令出擊" },
];

/** 雙人沒有指令出擊。 */
const DUO_GAMES = GAMES.filter((game) => game.id !== "InstructionGame");

const ROUTES = {
  DCCS: {
    single: "../Tutorial/DCCS_tutorial.html",
    double: "../Tutorial/DCCS_double_tutorial.html",
  },
  DAT: {
    single: "../Tutorial/DAT_tutorial.html",
    double: "../Tutorial/DAT_double_tutorial.html",
  },
  EFT: {
    single: "../Tutorial/EFT_tutorial.html",
    double: "../Tutorial/EFT_double_tutorial.html",
  },
  TGame: {
    single: "../Tutorial/TGame_tutorial.html",
    double: "../Tutorial/TGame_double_tutorial.html",
  },
  InstructionGame: {
    single: "../Tutorial/InstructionGame_tutorial.html",
    double: "../Tutorial/InstructionGame_tutorial.html",
  },
};

/** 進度只允許這三個值；其他數字會被正規化到最接近的一檔。 */
const PROGRESS_STEPS = [0, 50, 100];

const isDouble = ["double", "dual"].includes(sessionStorage.getItem("game_mode") || "single");

const singleStage = document.getElementById("single-stage");
const dualStage = document.getElementById("dual-stage");
const gameList = document.getElementById("game-list");
const errorMsg = document.getElementById("error-msg");
const enterBtn = document.getElementById("enter-btn");
const logoutBtn = document.getElementById("logout-btn");

const state = {
  selectedGameId: null,
  progressByGame: {},
};

const players = {
  1: { selectedGameId: null, confirmed: false, progressByGame: {} },
  2: { selectedGameId: null, confirmed: false, progressByGame: {} },
};

init();

/** 進頁後先拉進度，再把遊戲列表畫出來；同時查手錶專心判定。 */
async function init() {
  celebrateAttention();
  if (isDouble) {
    singleStage.hidden = true;
    dualStage.hidden = false;
    const [progress1, progress2] = await Promise.all([
      fetchStudentProgress(1),
      fetchStudentProgress(2),
    ]);
    players[1].progressByGame = progress1;
    players[2].progressByGame = progress2;
    renderPlayerGames(1);
    renderPlayerGames(2);
    return;
  }

  dualStage.hidden = true;
  state.progressByGame = await fetchStudentProgress(1);
  renderGames();
}

function renderGames() {
  gameList.innerHTML = GAMES.map((game) => gameCard(game, state.progressByGame)).join("");
}

function renderPlayerGames(slot) {
  const list = dualStage.querySelector(`[data-game-list="${slot}"]`);
  const player = players[slot];
  list.innerHTML = DUO_GAMES.map((game) => gameCard(game, player.progressByGame)).join("");
  list.querySelectorAll("[data-select-game]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.selectGame === player.selectedGameId);
  });
}

function gameCard(game, progressByGame) {
  const percent = normalizeProgress(progressByGame[game.id]);
  return `
    <article class="game-item" data-game-id="${game.id}">
      <button type="button" class="btn btn-game" data-select-game="${game.id}">
        ${game.name}
      </button>
      <div class="progress-row" aria-label="${game.name}進度 ${percent}%">
        <div class="progress-track" data-progress="${percent}">
          <div class="progress-fill"></div>
          <span class="progress-mark mark-mid${percent === 50 ? " is-reached" : ""}">✓</span>
          <span class="progress-mark mark-end${percent === 100 ? " is-reached" : ""}">✓</span>
        </div>
      </div>
    </article>
  `;
}

gameList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-game]");
  if (!button) return;
  selectGame(button.dataset.selectGame);
});

enterBtn.addEventListener("click", () => {
  enterSelectedGame();
});

dualStage.addEventListener("click", (event) => {
  const panel = event.target.closest("[data-player]");
  if (!panel) return;
  const slot = Number(panel.dataset.player);
  if (event.target.closest("[data-wait]")) {
    cancelConfirm(slot);
    return;
  }
  if (players[slot].confirmed) return;
  const button = event.target.closest("[data-select-game]");
  if (button) {
    selectPlayerGame(slot, button.dataset.selectGame);
    return;
  }
  if (event.target.closest("[data-enter]")) confirmPlayer(slot);
});

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await WebGameApi.logoutAll();
  } finally {
    sessionStorage.clear();
    location.href = "../Home/index.html";
  }
});

function selectGame(gameId) {
  state.selectedGameId = gameId;
  errorMsg.textContent = "";
  gameList.querySelectorAll("[data-select-game]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.selectGame === gameId);
  });
}

function selectPlayerGame(slot, gameId) {
  players[slot].selectedGameId = gameId;
  playerError(slot).textContent = "";
  const list = dualStage.querySelector(`[data-game-list="${slot}"]`);
  list.querySelectorAll("[data-select-game]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.selectGame === gameId);
  });
}

function confirmPlayer(slot) {
  const player = players[slot];
  if (!player.selectedGameId) {
    playerError(slot).textContent = "請先選擇一個遊戲";
    return;
  }
  player.confirmed = true;
  playerError(slot).textContent = "";
  dualStage.querySelector(`[data-wait="${slot}"]`).hidden = false;
  tryLaunch();
}

function cancelConfirm(slot) {
  players[slot].confirmed = false;
  dualStage.querySelector(`[data-wait="${slot}"]`).hidden = true;
}

function tryLaunch() {
  if (!players[1].confirmed || !players[2].confirmed) return;
  if (players[1].selectedGameId !== players[2].selectedGameId) {
    cancelConfirm(1);
    cancelConfirm(2);
    playerError(1).textContent = "請選擇同一個遊戲";
    playerError(2).textContent = "請選擇同一個遊戲";
    return;
  }
  goToGame(players[1].selectedGameId, true);
}

function playerError(slot) {
  return dualStage.querySelector(`[data-error="${slot}"]`);
}

function enterSelectedGame() {
  if (!state.selectedGameId) {
    errorMsg.textContent = "請先選擇一個遊戲";
    return;
  }
  errorMsg.textContent = "";
  goToGame(state.selectedGameId, false);
}

function goToGame(gameId, doubleMode) {
  const pages = ROUTES[gameId];
  if (!pages) {
    const message = "這個遊戲尚未開放";
    if (doubleMode) {
      playerError(1).textContent = message;
      playerError(2).textContent = message;
    } else {
      errorMsg.textContent = message;
    }
    return;
  }
  location.href = doubleMode ? pages.double : pages.single;
}

function emptyProgress(games = GAMES) {
  return games.reduce((result, game) => {
    result[game.id] = 0;
    return result;
  }, {});
}

function progressFromRecords(records, day, games = GAMES) {
  const progress = emptyProgress(games);
  const targetDay = Number(day);
  records.forEach((record) => {
    if (Number(record.currentDay) !== targetDay) return;
    const gameId = WebGameApi.mapGameId(record.gameType);
    if (!Object.prototype.hasOwnProperty.call(progress, gameId)) return;
    progress[gameId] = Math.max(
      progress[gameId],
      WebGameApi.progressFromRecord(gameId, record)
    );
  });
  return progress;
}

/** 讀取這位學生當天的進度。slot 1 用 student1_*，slot 2 用 student2_*。 */
async function fetchStudentProgress(slot) {
  const games = isDouble ? DUO_GAMES : GAMES;
  const progress = emptyProgress(games);
  const token = sessionStorage.getItem(`student${slot}_token`)
    || (slot === 1 ? sessionStorage.getItem("token") : "");
  const studentKey = sessionStorage.getItem(`student${slot}_key`);
  const school = sessionStorage.getItem(`student${slot}_school`)
    || (slot === 1 ? sessionStorage.getItem("school") : "");
  const day = sessionStorage.getItem(`student${slot}_day`)
    || (slot === 1 ? sessionStorage.getItem("current_day") || sessionStorage.getItem("currentDay") : "")
    || "1";

  if (!token || !studentKey || !school) return progress;

  try {
    const res = await WebGameApi.authGet(
      `/students/${encodeURIComponent(studentKey)}/report?school=${encodeURIComponent(school)}`,
      token
    );
    if (!res.ok) return progress;
    const body = await res.json();
    return progressFromRecords(body.records || [], day, games);
  } catch (_err) {
    return progress;
  }
}

/**
 * 手錶判定專心就放煙火。每次登入只放一次（登入時 sessionStorage 會清空）；
 * 還沒達標時，每次回到這頁都會再查一次。雙人時兩位各自查，任一位達標就放。
 * 雙人一律說「你們」，不點名是哪一位，避免兩人互相比較。
 */
async function celebrateAttention() {
  const SHOWN_KEY = "attention_fireworks_shown";
  if (sessionStorage.getItem(SHOWN_KEY) || !window.showFireworks) return;

  const isDouble = sessionStorage.getItem("game_mode") === "double";
  const tokens = isDouble
    ? [sessionStorage.getItem("student1_token"), sessionStorage.getItem("student2_token")]
    : [sessionStorage.getItem("student1_token") || sessionStorage.getItem("token")];
  const results = await Promise.all(tokens.map((token) => WebGameApi.fetchAttention(token)));
  if (!results.includes(1)) return;

  const message = isDouble
    ? "聽說這裡有專心的小朋友，原來是你們！"
    : "聽說這裡有專心的小朋友，原來是你！";
  sessionStorage.setItem(SHOWN_KEY, "1");
  window.showFireworks(message);
}

/**
 * 把任意數字收成 0、50 或 100（取最接近的一檔）。
 * 後端若回傳其他值，畫面仍能對應到三格進度條。
 */
function normalizeProgress(value) {
  const number = Number(value) || 0;
  return PROGRESS_STEPS.reduce((closest, step) =>
    Math.abs(step - number) < Math.abs(closest - number) ? step : closest
  );
}
