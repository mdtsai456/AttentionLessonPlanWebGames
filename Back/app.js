// =============================================================================
// Back / 老師後台：查看學生進度
// 流程：選學生 → 選第幾天 → 當天五個遊戲的成績與明細直接展開。
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
const reportView = document.getElementById("report-view");
const dayDetail = document.getElementById("day-detail");
const dayPrompt = document.getElementById("day-prompt");
const dayTitle = document.getElementById("day-title");
const recordsBody = document.getElementById("records-tbody");
const logoutBtn = document.getElementById("logout-btn");

const state = {
  students: [], // [{ id, name, username }]
  days: [], // 固定第 1～24 天
  sessions: [], // 目前學生的場次，選天時直接從這裡算進度
  selectedStudentId: "",
  selectedDay: null, // 尚未選天時為 null
  progressByGame: {}, // { [gameId]: 0 | 50 | 100 }
  detailByGame: {}, // { [gameId]: { reached, accuracy, levelAccuracy, ...metrics } }
};

init();

/** 進頁後先確認老師 token，再拉學生名單。 */
async function init() {
  const token = sessionStorage.getItem("token");
  if (!token || sessionStorage.getItem("user_role") !== "teacher") {
    location.href = "../Home/index.html";
    return;
  }

  document.getElementById("view-teacher-name").textContent =
    `${sessionStorage.getItem("teacher_name") || "--"} 老師`;
  document.getElementById("view-teacher-school").textContent =
    sessionStorage.getItem("teacher_school") || "--";

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
  state.detailByGame = {};
  state.sessions = studentId ? await fetchStudentReport(studentId) : [];
  state.days = TRAINING_DAYS;
  renderDays();
  renderProgress();
}

/** 選天立刻更新按下狀態與進度；場次已在選學生時抓好。 */
function selectDay(day) {
  if (!state.selectedStudentId) return;
  state.selectedDay = day;
  state.progressByGame = progressFromSessions(state.sessions, day);
  state.detailByGame = detailFromSessions(state.sessions, day);
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
        `<option value="${student.id}">個案 ${student.name}（已測 ${student.sessionCount || 0} 場）</option>`
    )
    .join("");

  studentSelect.innerHTML = `
    <option value="">請選擇學生</option>
    ${options}
  `;
}

/** 每位玩家最多 24 個施測日，天數固定為第 1～24 天。 */
const TRAINING_DAYS = Array.from({ length: 24 }, (_, index) => index + 1);

/**
 * 畫第 1～24 天按鈕。
 * 還沒選學生時全部 disabled。
 */
function renderDays() {
  const hasStudent = Boolean(state.selectedStudentId);
  const days = TRAINING_DAYS;

  dayRow.innerHTML = days
    .map((day) => {
      const selected = state.selectedDay === day ? " is-selected" : "";
      const disabled = hasStudent ? "" : " disabled";
      return `
        <button
          type="button"
          class="day-btn${selected}"
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
  const hasStudent = Boolean(state.selectedStudentId);
  const hasDay = state.selectedDay != null;
  emptyHint.hidden = hasStudent;
  reportView.hidden = !hasStudent;
  dayPrompt.hidden = !hasStudent || hasDay;
  dayDetail.hidden = !hasDay;
  if (hasStudent) fillStudentMeta();
  if (!hasDay) {
    gameList.innerHTML = "";
    recordsBody.innerHTML = "";
    return;
  }

  dayTitle.textContent = `第 ${state.selectedDay} 天的遊戲`;
  gameList.innerHTML = GAMES.map((game) => {
    const percent = normalizeProgress(state.progressByGame[game.id]);
    const detail = state.detailByGame[game.id] || { reached: null, accuracy: null };
    return `
      <article class="game-card">
        <div class="card-head">
          <span>${game.name}</span>
          <span class="card-percent">${percent}%</span>
        </div>
        <div class="progress-track" data-progress="${percent}" aria-label="${game.name}進度 ${percent}%">
          <div class="progress-fill"></div>
        </div>
        ${renderLevelDetail(detail, game.id)}
      </article>
    `;
  }).join("");
  renderRecords();
}

function fillStudentMeta() {
  const student = state.students.find((item) => item.id === state.selectedStudentId);
  if (!student) return;
  document.getElementById("view-student-key").textContent = `受試個案：${student.name}`;
  document.getElementById("view-school-name").textContent =
    `所屬場域：${student.school || teacherSchool()}`;
  document.getElementById("view-total-sessions").textContent = String(student.sessionCount || 0);
  document.getElementById("view-last-played").textContent = student.lastPlayedAt || "尚無評測紀錄";
}

function renderRecords() {
  const rows = state.sessions
    .filter((session) => Number(session.currentDay) === Number(state.selectedDay))
    .slice()
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

  if (!rows.length) {
    recordsBody.innerHTML = '<tr><td class="empty-row" colspan="7">這天尚無施測紀錄</td></tr>';
    return;
  }

  recordsBody.innerHTML = rows.map((session) => {
    const stats = session.stats || {};
    const mode = String(session.mode || "single").toLowerCase();
    return `
      <tr>
        <td><strong>${gameLabel(session.gameType)}</strong></td>
        <td><span class="mode-tag ${mode}">${mode === "double" ? "雙人" : "單人"}</span></td>
        <td><strong>${formatAccuracy(stats.accuracy)}</strong></td>
        <td>${stats.correctCount ?? "—"} / ${stats.wrongCount ?? "—"}</td>
        <td>${formatDuration(stats.duration)}</td>
        <td>${stats.stage ?? "—"}</td>
        <td>${session.startTime || "—"}</td>
      </tr>
    `;
  }).join("");
}

function gameLabel(gameType) {
  const id = WedGameApi.mapGameId(gameType);
  const game = GAMES.find((item) => item.id === id);
  return game ? game.name : gameType;
}

function renderLevelDetail(detail, gameId) {
  const accuracy = formatAccuracy(detail.accuracy);
  const levels = Array.isArray(detail.levelAccuracy) ? detail.levelAccuracy : null;
  const reached = detail.reached;
  const rows = Array.from({ length: 6 }, (_, index) => {
    const level = index + 1;
    const value = levels && index < levels.length ? Number(levels[index]) : NaN;
    let text = "尚未遊玩";
    if (Number.isFinite(value)) text = formatAccuracy(value);
    else if (reached != null && level <= reached) text = "尚無各關紀錄";
    return `<li><span>第 ${level} 關</span><strong>${text}</strong></li>`;
  }).join("");
  const note = reached == null
    ? "這天沒有這一款的成績。"
    : levels && levels.length
      ? ""
      : "這筆是較早的成績，只有整場正確率。";
  return `
    <dl class="metric-list">${renderMetrics(detail, gameId)}</dl>
    <p class="level-accuracy">各關正確率</p>
    <ol class="level-list">${rows}</ol>
    ${note ? `<p class="level-note">${note}</p>` : ""}
  `;
}

function renderMetrics(detail, gameId) {
  const total = finiteOrNull(detail.questionCount);
  const wrong = finiteOrNull(detail.wrongCount);
  const correct = finiteOrNull(detail.correctCount);
  const denom = total != null && total > 0
    ? total
    : (correct != null && wrong != null ? correct + wrong : NaN);
  const error = wrong != null && Number.isFinite(denom) && denom > 0 ? wrong / denom : NaN;
  const rows = [
    ["遊玩時間", formatDuration(detail.duration)],
    ["平均反應時間", formatDuration(detail.avgReactionMs)],
    ["正確率", formatAccuracy(detail.accuracy)],
    ["錯誤率", formatAccuracy(error)],
  ];
  if (gameId !== "InstructionGame") {
    rows.push(["總題數", total == null ? "—" : String(total)]);
  }
  if (gameId === "EFT") {
    rows.push(["準心對準時長比", formatAccuracy(detail.aimRatio)]);
    rows.push(["專心時間", formatDuration(detail.focusMs)]);
  }
  return rows
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function formatDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${(number / 1000).toFixed(1)} 秒`;
}

function formatAccuracy(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const percent = number <= 1 ? Math.round(number * 100) : Math.round(number);
  return `${percent}%`;
}

function teacherToken() {
  return sessionStorage.getItem("token");
}

function teacherSchool() {
  return sessionStorage.getItem("teacher_school") || "";
}

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchStudentReport(studentKey) {
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
      sessionCount: student.sessionCount || 0,
      lastPlayedAt: student.lastPlayedAt || "",
    }));
  } catch (_err) {
    return [];
  }
}

function detailFromSessions(sessions, day) {
  const detail = {};
  sessions.forEach((session) => {
    if (Number(session.currentDay) !== Number(day)) return;
    const gameId = WedGameApi.mapGameId(session.gameType);
    if (!GAMES.some((game) => game.id === gameId)) return;
    const stage = session.stats ? Number(session.stats.stage) : NaN;
    const accuracy = session.stats ? Number(session.stats.accuracy) : NaN;
    const reached = levelsReached(gameId, stage);
    const levelAccuracy = parseLevelAccuracy(session.stats);
    const stats = session.stats || {};
    const next = {
      reached,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      levelAccuracy,
      duration: finiteOrNull(stats.duration),
      avgReactionMs: finiteOrNull(stats.avgReactionMs),
      questionCount: finiteOrNull(stats.questionCount),
      aimRatio: finiteOrNull(stats.aimRatio),
      focusMs: finiteOrNull(stats.focusMs),
      correctCount: finiteOrNull(stats.correctCount),
      wrongCount: finiteOrNull(stats.wrongCount),
    };
    const current = detail[gameId];
    const further = !current || (reached || 0) > (current.reached || 0);
    const sameReach = current && (reached || 0) === (current.reached || 0);
    if (further || (sameReach && levelAccuracy && !current.levelAccuracy)) {
      detail[gameId] = next;
    }
  });
  return detail;
}

function parseLevelAccuracy(stats) {
  const value = stats && stats.levelAccuracy;
  if (Array.isArray(value)) {
    const numbers = value.map(Number).filter((number) => Number.isFinite(number));
    return numbers.length ? numbers : null;
  }
  if (typeof value === "string" && value.trim()) {
    const numbers = value.split(",").map(Number).filter((number) => Number.isFinite(number));
    return numbers.length ? numbers : null;
  }
  return null;
}

function levelsReached(gameId, stage) {
  if (!Number.isFinite(stage) || stage <= 0) return null;
  if (stage <= 6) return stage;
  const percent = WedGameApi.progressFromRecord(gameId, { stats: { stage } });
  return percent >= 100 ? 6 : 3;
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
