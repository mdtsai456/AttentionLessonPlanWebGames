// =============================================================================
// Back / 老師後台：查看學生進度
// 流程：選學生 → 選第幾天 → 顯示當天五個遊戲的進度（0 / 50 / 100）。
// 名單與場次來自後端；DCCS 只打完前 3 關為 50%，打完後段或其它遊戲為 100%。
// =============================================================================

/** 五個遊戲的固定清單；id 對應後端欄位，name 給畫面顯示。 */
const GAMES = [
  { id: "DCCS", name: "賽道攔截" },
  { id: "EFT", name: "瓢蟲追擊令" },
  { id: "DAT", name: "漂浮泡泡" },
  { id: "TGame", name: "勇闖迷宮" },
  { id: "InstructionGame", name: "指令出擊" },
];

/** 進度只允許這三個值；其他數字會被正規化到最接近的一檔。 */
const PROGRESS_STEPS = [0, 50, 100];

const studentSelect = document.getElementById("student-select");
const dayRow = document.getElementById("day-row");
const gameList = document.getElementById("game-list");
const emptyHint = document.getElementById("empty-hint");
const logoutBtn = document.getElementById("logout-btn");

const state = {
  students: [], // [{ id, name, username }]
  days: [], // 該學生有資料的天數，例如 [1, 2, 3, 4, 5]
  sessions: [], // 目前學生的場次，選天時直接從這裡算進度
  selectedStudentId: "",
  selectedDay: null, // 尚未選天時為 null
  progressByGame: {}, // { [gameId]: 0 | 50 | 100 }
};

init();

/** 進頁後先確認老師 token，再拉學生名單。 */
async function init() {
  const token = sessionStorage.getItem("token");
  if (!token || sessionStorage.getItem("user_role") !== "teacher") {
    location.href = "../Home/index.html";
    return;
  }

  state.students = await fetchTeacherStudents();
  renderStudents();
  renderDays();
  renderProgress();
}

studentSelect.addEventListener("change", () => {
  selectStudent(studentSelect.value);
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

dayRow.addEventListener("click", (event) => {
  const button = event.target.closest("[data-day]");
  if (!button || button.disabled) return; // 還沒選學生時天數按鈕會 disabled
  selectDay(Number(button.dataset.day));
});

/**
 * 換成另一位學生時，清掉已選天數與進度，再重抓該學生的天數。
 * @param {string} studentId 下拉選單的 value；空字串代表回到「請選擇學生」
 */
async function selectStudent(studentId) {
  state.selectedStudentId = studentId;
  state.selectedDay = null;
  state.progressByGame = {};
  state.sessions = studentId ? await fetchStudentSessions(studentId) : [];
  state.days = daysFromSessions(state.sessions);
  renderDays();
  renderProgress();
}

/** 選天立刻更新按下狀態與進度；場次已在選學生時抓好。 */
function selectDay(day) {
  if (!state.selectedStudentId) return;
  state.selectedDay = day;
  state.progressByGame = progressFromSessions(state.sessions, day);
  markSelectedDay(day);
  renderProgress();
}

function markSelectedDay(day) {
  dayRow.querySelectorAll("[data-day]").forEach((button) => {
    button.classList.toggle("is-selected", Number(button.dataset.day) === day);
  });
}

/** 把學生名單填進下拉選單；第一個 option 是提示文字。 */
function renderStudents() {
  const options = state.students
    .map(
      (student) =>
        `<option value="${student.id}">${student.name}</option>`
    )
    .join("");

  studentSelect.innerHTML = `
    <option value="">請選擇學生</option>
    ${options}
  `;
}

/**
 * 畫第 1～5 天按鈕。
 * 還沒選學生時先顯示 1～5 天但全部 disabled；
 * 有學生則用後端回傳的 days（沒資料時仍顯示 1～5 天當版面）。
 */
function renderDays() {
  const hasStudent = Boolean(state.selectedStudentId);
  const days = state.days.length ? state.days : [1, 2, 3, 4, 5];

  dayRow.innerHTML = days
    .map((day) => {
      const selected = state.selectedDay === day ? " is-selected" : "";
      const disabled = hasStudent ? "" : " disabled";
      return `
        <button
          type="button"
          class="btn btn-day${selected}"
          data-day="${day}"
          ${disabled}
        >
          第 ${day} 天
        </button>
      `;
    })
    .join("");
}

/**
 * 學生與天數都選好才畫進度列表；
 * 否則顯示提示：「請先選擇學生與天數」或「請選擇第幾天」。
 */
function renderProgress() {
  const ready = state.selectedStudentId && state.selectedDay != null;

  if (!ready) {
    gameList.innerHTML = "";
    emptyHint.textContent = state.selectedStudentId
      ? "請選擇第幾天"
      : "請先選擇學生與天數";
    emptyHint.classList.remove("is-hidden");
    return;
  }

  emptyHint.classList.add("is-hidden");
  gameList.innerHTML = GAMES.map((game) => {
    const percent = normalizeProgress(state.progressByGame[game.id]);
    return `
      <article class="game-item" data-game-id="${game.id}">
        <span class="game-chip">${game.name}</span>
        <div class="progress-row" aria-label="${game.name}進度 ${percent}%">
          <div class="progress-track" data-progress="${percent}">
            <div class="progress-fill"></div>
            <span class="progress-mark mark-mid${percent === 50 ? " is-reached" : ""}">✓</span>
            <span class="progress-mark mark-end${percent === 100 ? " is-reached" : ""}">✓</span>
          </div>
        </div>
        <span class="game-percent">${percent}%</span>
      </article>
    `;
  }).join("");
}

function teacherToken() {
  return sessionStorage.getItem("token");
}

function teacherSchool() {
  return sessionStorage.getItem("teacher_school") || "";
}

async function fetchStudentSessions(studentKey) {
  const token = teacherToken();
  const school = teacherSchool();
  if (!token || !studentKey || !school) return [];

  const res = await WedGameApi.authGet(
    `/students/${encodeURIComponent(studentKey)}/report?school=${encodeURIComponent(school)}`,
    token
  );
  if (!res.ok) return [];
  const body = await res.json();
  return Array.isArray(body.records) ? body.records : [];
}

/** 讀取這位老師所帶的學生名單。 */
async function fetchTeacherStudents() {
  const token = teacherToken();
  if (!token) return [];

  try {
    const res = await WedGameApi.authGet("/me/students", token);
    if (!res.ok) return [];
    const body = await res.json();
    return (body.students || []).map((student) => ({
      id: student.studentKey,
      name: student.studentKey,
      username: student.caseId,
      school: student.school,
    }));
  } catch (_err) {
    return [];
  }
}

function daysFromSessions(sessions) {
  const days = [
    ...new Set(
      sessions
        .map((session) => Number(session.currentDay))
        .filter((day) => Number.isFinite(day) && day >= 1)
    ),
  ].sort((a, b) => a - b);
  return days.length ? days : [1, 2, 3, 4, 5];
}

function progressFromSessions(sessions, day) {
  const progress = emptyProgress();
  sessions.forEach((session) => {
    if (Number(session.currentDay) !== Number(day)) return;
    const gameId = WedGameApi.mapGameId(session.gameType);
    if (!Object.prototype.hasOwnProperty.call(progress, gameId)) return;
    progress[gameId] = Math.max(
      progress[gameId],
      WedGameApi.progressFromRecord(gameId, session)
    );
  });
  return progress;
}

/** 產生五個遊戲皆為 0% 的進度物件。 */
function emptyProgress() {
  return GAMES.reduce((result, game) => {
    result[game.id] = 0;
    return result;
  }, {});
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
