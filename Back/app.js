const GAMES = [
  { id: "DCCS", name: "賽道攔截" },
  { id: "EFT", name: "瓢蟲追擊令" },
  { id: "DAT", name: "漂浮泡泡" },
  { id: "TGame", name: "勇闖迷宮" },
  { id: "InstructionGame", name: "指令出擊" },
];

const PROGRESS_STEPS = [0, 50, 100];

const studentSelect = document.getElementById("student-select");
const dayRow = document.getElementById("day-row");
const gameList = document.getElementById("game-list");
const emptyHint = document.getElementById("empty-hint");

const state = {
  students: [],
  days: [],
  selectedStudentId: "",
  selectedDay: null,
  progressByGame: {},
};

init();

async function init() {
  state.students = await fetchTeacherStudents();
  renderStudents();
  renderDays();
  renderProgress();
}

studentSelect.addEventListener("change", () => {
  selectStudent(studentSelect.value);
});

dayRow.addEventListener("click", (event) => {
  const button = event.target.closest("[data-day]");
  if (!button || button.disabled) return;
  selectDay(Number(button.dataset.day));
});

async function selectStudent(studentId) {
  state.selectedStudentId = studentId;
  state.selectedDay = null;
  state.progressByGame = {};
  state.days = studentId ? await fetchStudentDays(studentId) : [];
  renderDays();
  renderProgress();
}

async function selectDay(day) {
  if (!state.selectedStudentId) return;
  state.selectedDay = day;
  state.progressByGame = await fetchStudentDayProgress(state.selectedStudentId, day);
  renderDays();
  renderProgress();
}

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

async function fetchTeacherStudents() {
  // -------------------------------------------------------------------------
  // 後端接點：讀取這位老師所帶的學生名單（之後接 API 時改這裡即可）
  //
  // 建議：GET /api/teachers/me/students
  //
  // 回傳範例：
  // [
  //   { id: "s001", name: "王小明", username: "ming" },
  //   { id: "s002", name: "李小華", username: "hua" }
  // ]
  //
  // const response = await fetch("/api/teachers/me/students");
  // if (!response.ok) return [];
  // return await response.json();
  // -------------------------------------------------------------------------

  return [
    { id: "s001", name: "王小明", username: "ming" },
    { id: "s002", name: "李小華", username: "hua" },
    { id: "s003", name: "陳小美", username: "mei" },
    { id: "s004", name: "林小宇", username: "yu" },
  ];
}

async function fetchStudentDays(studentId) {
  // -------------------------------------------------------------------------
  // 後端接點：讀取該學生有進度資料的天數（之後接 API 時改這裡即可）
  //
  // 建議：GET /api/teachers/students/:studentId/days
  //
  // 回傳範例：
  // [1, 2, 3, 4, 5]
  //
  // const response = await fetch(`/api/teachers/students/${studentId}/days`);
  // if (!response.ok) return [];
  // return await response.json();
  // -------------------------------------------------------------------------

  void studentId;
  return [1, 2, 3, 4, 5];
}

async function fetchStudentDayProgress(studentId, day) {
  // -------------------------------------------------------------------------
  // 後端接點：讀取指定學生、指定天的五個遊戲進度（之後接 API 時改這裡即可）
  //
  // 建議：GET /api/teachers/students/:studentId/progress?day=1
  //
  // 回傳範例（進度只會是 0 / 50 / 100）：
  // {
  //   DCCS: 0,
  //   EFT: 50,
  //   DAT: 100,
  //   TGame: 0,
  //   InstructionGame: 50
  // }
  //
  // const response = await fetch(
  //   `/api/teachers/students/${studentId}/progress?day=${day}`
  // );
  // if (!response.ok) return {};
  // return await response.json();
  // -------------------------------------------------------------------------

  const mockProgress = {
    s001: {
      1: { DCCS: 100, EFT: 50, DAT: 0, TGame: 0, InstructionGame: 50 },
      2: { DCCS: 100, EFT: 100, DAT: 50, TGame: 0, InstructionGame: 50 },
      3: { DCCS: 100, EFT: 100, DAT: 100, TGame: 50, InstructionGame: 100 },
      4: { DCCS: 50, EFT: 50, DAT: 50, TGame: 50, InstructionGame: 50 },
      5: { DCCS: 0, EFT: 0, DAT: 0, TGame: 0, InstructionGame: 0 },
    },
    s002: {
      1: { DCCS: 100, EFT: 100, DAT: 100, TGame: 100, InstructionGame: 100 },
      2: { DCCS: 100, EFT: 100, DAT: 50, TGame: 100, InstructionGame: 100 },
      3: { DCCS: 50, EFT: 100, DAT: 50, TGame: 50, InstructionGame: 100 },
      4: { DCCS: 50, EFT: 50, DAT: 0, TGame: 50, InstructionGame: 50 },
      5: { DCCS: 0, EFT: 50, DAT: 0, TGame: 0, InstructionGame: 0 },
    },
    s003: {
      1: { DCCS: 50, EFT: 0, DAT: 0, TGame: 0, InstructionGame: 0 },
      2: { DCCS: 50, EFT: 50, DAT: 0, TGame: 0, InstructionGame: 50 },
      3: { DCCS: 100, EFT: 50, DAT: 50, TGame: 0, InstructionGame: 50 },
      4: { DCCS: 100, EFT: 100, DAT: 50, TGame: 50, InstructionGame: 50 },
      5: { DCCS: 100, EFT: 100, DAT: 100, TGame: 50, InstructionGame: 100 },
    },
    s004: {
      1: { DCCS: 0, EFT: 0, DAT: 50, TGame: 0, InstructionGame: 0 },
      2: { DCCS: 50, EFT: 0, DAT: 50, TGame: 50, InstructionGame: 0 },
      3: { DCCS: 50, EFT: 50, DAT: 100, TGame: 50, InstructionGame: 50 },
      4: { DCCS: 100, EFT: 50, DAT: 100, TGame: 100, InstructionGame: 50 },
      5: { DCCS: 100, EFT: 100, DAT: 100, TGame: 100, InstructionGame: 100 },
    },
  };

  return mockProgress[studentId]?.[day] || emptyProgress();
}

function emptyProgress() {
  return GAMES.reduce((result, game) => {
    result[game.id] = 0;
    return result;
  }, {});
}

function normalizeProgress(value) {
  const number = Number(value) || 0;
  return PROGRESS_STEPS.reduce((closest, step) =>
    Math.abs(step - number) < Math.abs(closest - number) ? step : closest
  );
}
