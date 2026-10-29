// =============================================================================
// Select / 學生選遊戲頁
// 單人模式顯示五款遊戲與一份進度。雙人模式左右各顯示一份選單，不含指令出擊，
// 並分別顯示當日進度。兩人皆按 ENTER 且選擇相同遊戲後，才進入遊戲。
// 進度使用後端的當日場次。DCCS 完成前 3 關為 50%，完成後段或其他遊戲為 100%。
// =============================================================================

const { GAMES, emptyProgress, dayProgress, normalizeProgress } = WebGameApi;

/** 雙人模式不包含指令出擊。 */
const DUO_GAMES = GAMES.filter((game) => game.id !== "InstructionGame");

/** 等待遮罩上稱呼另一位玩家。 */
const PARTNER_NAME = { 1: "玩家二", 2: "玩家一" };

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

/**
 * 進入頁面後，先用骨架（進度 0%）立即畫出清單，避免等待進度資料時整塊空白，
 * 再各自等自己的進度回來後更新畫面。雙人模式兩位玩家的進度分開等待，
 * 其中一位回來得慢，不會拖累另一位的清單一起停在空白。
 */
async function init() {
  celebrateAttention();
  renderAccounts();
  if (isDouble) {
    singleStage.hidden = true;
    dualStage.hidden = false;
    players[1].progressByGame = emptyProgress(DUO_GAMES);
    players[2].progressByGame = emptyProgress(DUO_GAMES);
    renderPlayerGames(1);
    renderPlayerGames(2);
    fetchStudentProgress(1).then((progress) => {
      players[1].progressByGame = progress;
      renderPlayerGames(1);
    });
    fetchStudentProgress(2).then((progress) => {
      players[2].progressByGame = progress;
      renderPlayerGames(2);
    });
    return;
  }

  dualStage.hidden = true;
  state.progressByGame = emptyProgress(GAMES);
  renderGames();
  state.progressByGame = await fetchStudentProgress(1);
  renderGames();
}

/** 學生登入時填的第幾天。slot 1 可沿用舊版的 current_day。 */
function studentDay(slot) {
  return sessionStorage.getItem(`student${slot}_day`)
    || (slot === 1 ? sessionStorage.getItem("current_day") || sessionStorage.getItem("currentDay") : "")
    || "1";
}

/** 在標題下顯示登入帳號與第幾天，讓學生確認沒有登錯。舊的登入沒有存帳號，改顯示個案編號。 */
function renderAccounts() {
  document.querySelectorAll("[data-who]").forEach((element) => {
    const slot = Number(element.dataset.who);
    const account = sessionStorage.getItem(`student${slot}_account`)
      || sessionStorage.getItem(`student${slot}_case`) || "--";
    element.textContent = `帳號 ${account}・第 ${studentDay(slot)} 天`;
  });
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

// 進入說明頁後按上一頁回來（bfcache）時，清掉「準備進入遊戲…」，讓兩人重新確認。
window.addEventListener("pageshow", (event) => {
  if (!event.persisted || !isDouble) return;
  cancelConfirm(1);
  cancelConfirm(2);
});

logoutBtn.addEventListener("click", async () => {
  const message = isDouble ? "兩位學生都會一起登出，回到登入頁。" : "登出後會回到登入頁。";
  const labels = { title: "確定要登出嗎？", stayText: "取消", leaveText: "登出" };
  if (!(await window.confirmLeave(message, labels))) return;
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
  showWait(slot, `已選：${gameName(player.selectedGameId)}（點此取消）\n等待${PARTNER_NAME[slot]}確認`);
  tryLaunch();
}

function cancelConfirm(slot) {
  players[slot].confirmed = false;
  waitMask(slot).hidden = true;
  waitMask(slot).disabled = false;
}

function tryLaunch() {
  if (!players[1].confirmed || !players[2].confirmed) return;
  const [first, second] = [players[1].selectedGameId, players[2].selectedGameId];
  if (first !== second) {
    cancelConfirm(1);
    cancelConfirm(2);
    const message = `玩家一選「${gameName(first)}」，玩家二選「${gameName(second)}」，請選擇同一個遊戲`;
    playerError(1).textContent = message;
    playerError(2).textContent = message;
    return;
  }
  // 導向說明頁要等登入驗證，會停留幾秒；先告訴兩人正在進入，遮罩也不能再取消。
  [1, 2].forEach((slot) => {
    showWait(slot, "準備進入遊戲…");
    waitMask(slot).disabled = true;
  });
  goToGame(first, true);
}

function waitMask(slot) {
  return dualStage.querySelector(`[data-wait="${slot}"]`);
}

function showWait(slot, text) {
  waitMask(slot).textContent = text;
  waitMask(slot).hidden = false;
}

function gameName(gameId) {
  return GAMES.find((game) => game.id === gameId).name;
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

/** 讀取學生當日的進度。slot 1 使用 student1_*，slot 2 使用 student2_*。 */
async function fetchStudentProgress(slot) {
  const games = isDouble ? DUO_GAMES : GAMES;
  const progress = dayProgress([], 0, games); // 讀不到成績時，各遊戲都是 0
  const token = sessionStorage.getItem(`student${slot}_token`)
    || (slot === 1 ? sessionStorage.getItem("token") : "");
  const studentKey = sessionStorage.getItem(`student${slot}_key`);
  const school = sessionStorage.getItem(`student${slot}_school`)
    || (slot === 1 ? sessionStorage.getItem("school") : "");
  const day = studentDay(slot);

  if (!token || !studentKey || !school) return progress;

  try {
    const res = await WebGameApi.authGet(
      `/students/${encodeURIComponent(studentKey)}/report?school=${encodeURIComponent(school)}`,
      token
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    return dayProgress(body.records || [], day, games);
  } catch (_err) {
    // 讀取失敗時說明，免得 0% 看起來像沒玩過；進度仍以 0 顯示，可以選遊戲。
    const stage = isDouble ? dualStage : singleStage;
    stage.querySelector(`[data-progress-error="${slot}"]`).textContent =
      "進度讀取失敗，請檢查網路後重新整理頁面。";
    return progress;
  }
}

/**
 * 手錶判定專心時，顯示煙火。每次登入僅顯示一次。登入時會清空 sessionStorage。
 * 未達標時，每次返回此頁都重新查詢。雙人模式分別查詢兩位學生，任一位達標即顯示煙火。
 * 雙人模式的提示使用「你們」，不指明達標的學生，避免互相比較。
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
