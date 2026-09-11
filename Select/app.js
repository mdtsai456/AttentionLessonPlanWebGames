// =============================================================================
// Select / 學生選遊戲頁
// 列出五個遊戲與進度條（0 / 50 / 100），點選後按 ENTER 開始。
// 進度目前用假資料；後端 API 尚未接上。
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
}

/** 讀取這位學生五個遊戲的進度。目前回傳假資料。 */
async function fetchStudentProgress() {
  // -------------------------------------------------------------------------
  // 後端接點：讀取對應學生的遊戲進度（之後接 API 時改這裡即可）
  //
  // 建議：GET /api/students/me/progress
  // 或：  GET /api/students/:studentId/progress
  //
  // 單人回傳範例：
  // {
  //   DCCS: 0,
  //   EFT: 0,
  //   DAT: 50,
  //   TGame: 0,
  //   InstructionGame: 100
  // }
  // 進度只會是 0 / 50 / 100。
  //
  // 雙人模式之後可改成：
  // {
  //   DAT: { students: [{ username: "A", percent: 50 }, { username: "B", percent: 0 }] }
  // }
  // 前端再依 students 畫兩條進度條。
  //
  // const response = await fetch("/api/students/me/progress");
  // if (!response.ok) return {};
  // return await response.json();
  // -------------------------------------------------------------------------

  return {
    DCCS: 0,
    EFT: 0,
    DAT: 50,
    TGame: 0,
    InstructionGame: 100,
  };
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
