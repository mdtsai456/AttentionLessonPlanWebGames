// =============================================================================
// Select / 學生選遊戲頁
// 列出五個遊戲與進度條（0 / 50 / 100），點選後按 ENTER 開始。
// 進度依後端該生當天場次：DCCS 只打完前 3 關為 50%，打完後段或其它遊戲為 100%。
// =============================================================================

/** 五個遊戲的固定清單；id 給後端，name 給畫面顯示。 */
const GAMES = [
  { id: "DCCS", name: "賽道攔截" },
  { id: "EFT", name: "瓢蟲追擊令" },
  { id: "DAT", name: "漂浮泡泡" },
  { id: "TGame", name: "勇闖迷宮" },
  { id: "InstructionGame", name: "指令出擊" },
];

/** 進度只允許這三個值；其他數字會被正規化到最接近的一檔。 */
const PROGRESS_STEPS = [0, 50, 100];

const gameList = document.getElementById("game-list");
const errorMsg = document.getElementById("error-msg");
const enterBtn = document.getElementById("enter-btn");
const logoutBtn = document.getElementById("logout-btn");

const state = {
  selectedGameId: null, // 目前選到的遊戲 id，尚未選擇時為 null
  progressByGame: {}, // { [gameId]: 0 | 50 | 100 }
};

init();

/** 進頁後先拉進度，再把遊戲列表畫出來。 */
async function init() {
  state.progressByGame = await fetchStudentProgress();
  renderGames();
}

/**
 * 依 GAMES 畫出每列：遊戲按鈕 + 進度條。
 * 50% 會點亮中間勾、100% 會點亮終點勾。
 */
function renderGames() {
  gameList.innerHTML = GAMES.map((game) => {
    const percent = normalizeProgress(state.progressByGame[game.id]);
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
  }).join("");
}

gameList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-game]");
  if (!button) return;
  selectGame(button.dataset.selectGame);
});

enterBtn.addEventListener("click", () => {
  enterSelectedGame();
});

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await WedGameApi.logoutAll();
  } finally {
    sessionStorage.clear();
    location.href = "../Home/index.html";
  }
});

/** 記錄選到的遊戲，並只讓該顆按鈕呈現按下狀態。 */
function selectGame(gameId) {
  state.selectedGameId = gameId;
  errorMsg.textContent = "";
  gameList.querySelectorAll("[data-select-game]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.selectGame === gameId);
  });
}

/** 確認已選遊戲後組 payload；目前只 log，之後改呼叫開始遊戲 API。 */
async function enterSelectedGame() {
  if (!state.selectedGameId) {
    errorMsg.textContent = "請先選擇一個遊戲";
    return;
  }

  const game = GAMES.find((item) => item.id === state.selectedGameId);
  const payload = {
    gameId: game.id,
    gameName: game.name,
    progress: normalizeProgress(state.progressByGame[game.id]),
  };

  // -------------------------------------------------------------------------
  // 後端接點：開始遊戲（之後接 API 時改這裡即可）
  //
  // 建議：POST /api/games/start
  // payload 範例：
  // {
  //   gameId: "DAT",
  //   gameName: "漂浮泡泡",
  //   progress: 50   // 只會是 0 / 50 / 100
  // }
  //
  // const response = await fetch("/api/games/start", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(payload),
  // });
  // if (!response.ok) {
  //   errorMsg.textContent = "無法開始遊戲，請稍後再試";
  //   return;
  // }
  // const data = await response.json();
  // location.href = data.redirectUrl;
  // -------------------------------------------------------------------------

  console.log("[start game payload 待接後端]", payload);
  errorMsg.textContent = "";

  const storedMode = sessionStorage.getItem("game_mode") || "single";
  const isDouble = storedMode === "double" || storedMode === "dual";
  const ROUTES = {
    DCCS: {
      single: "../DCCS/index.html",
      double: "../DCCS/double.html",
    },
    EFT: {
      single: "../DAT_single/DAT_tutorial.html",
      double: "../DAT_double/DAT_double.html",
    },
    DAT: {
      single: "../EFT_single/EFT_single.html",
      double: "../EFT_double/EFT_double.html",
    },
    TGame: {
      single: "../TGame1/index.html",
      double: "../TGame2/index.html",
    },
    InstructionGame: {
      single: "../IM1/index.html",
      double: "../IM1/index.html",
    },
  };
  const pages = ROUTES[game.id];
  if (pages) {
    location.href = isDouble ? pages.double : pages.single;
    return;
  }
  errorMsg.textContent = "這個遊戲尚未開放";
}

function emptyProgress() {
  return GAMES.reduce((result, game) => {
    result[game.id] = 0;
    return result;
  }, {});
}

function progressFromRecords(records, day) {
  const progress = emptyProgress();
  const targetDay = Number(day);
  records.forEach((record) => {
    if (Number(record.currentDay) !== targetDay) return;
    const gameId = WedGameApi.mapGameId(record.gameType);
    if (!Object.prototype.hasOwnProperty.call(progress, gameId)) return;
    progress[gameId] = Math.max(
      progress[gameId],
      WedGameApi.progressFromRecord(gameId, record)
    );
  });
  return progress;
}

/** 讀取這位學生當天五個遊戲的進度。 */
async function fetchStudentProgress() {
  const progress = emptyProgress();
  const token = sessionStorage.getItem("student1_token") || sessionStorage.getItem("token");
  const studentKey = sessionStorage.getItem("student1_key");
  const school = sessionStorage.getItem("student1_school") || sessionStorage.getItem("school");
  const day = sessionStorage.getItem("student1_day") || sessionStorage.getItem("current_day") || "1";

  if (!token || !studentKey || !school) return progress;

  try {
    const res = await WedGameApi.authGet(
      `/students/${encodeURIComponent(studentKey)}/report?school=${encodeURIComponent(school)}`,
      token
    );
    if (!res.ok) return progress;
    const body = await res.json();
    return progressFromRecords(body.records || [], day);
  } catch (_err) {
    return progress;
  }
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
