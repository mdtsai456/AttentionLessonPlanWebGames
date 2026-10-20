// =============================================================================
// Back / 老師後台：查看學生進度
// 選擇學生與施測日後，展開當日五款遊戲的成績與明細。
// 名單與場次來自後端。DCCS 完成前 3 關為 50%，完成後段或其他遊戲為 100%。
// =============================================================================

/** 五款遊戲的固定清單。id 對應後端欄位，name 用於畫面顯示。 */
const GAMES = [
  { id: "DCCS", name: "賽道攔截" },
  { id: "DAT", name: "瓢蟲追擊令" },
  { id: "EFT", name: "漂浮泡泡" },
  { id: "TGame", name: "勇闖迷宮" },
  { id: "InstructionGame", name: "指令出擊" },
];

/** 進度只接受這三個值。其他數值轉換為最接近的值。 */
const PROGRESS_STEPS = [0, 50, 100];

const studentSelect = document.getElementById("student-select");
const dayRow = document.getElementById("day-row");
const gameList = document.getElementById("game-list");
const emptyHint = document.getElementById("empty-hint");
const reportView = document.getElementById("report-view");
const dayDetail = document.getElementById("day-detail");
const dayPrompt = document.getElementById("day-prompt");
const reportRetry = document.getElementById("report-retry");
const dayTitle = document.getElementById("day-title");
const recordsBody = document.getElementById("records-tbody");
const logoutBtn = document.getElementById("logout-btn");

const DAY_PROMPT = "請選擇第幾天，查看當天成績。";
const DAY_PROMPT_LOADING = "成績載入中…";
const DAY_PROMPT_ERROR = "成績讀取失敗，請檢查網路後重試。";

/** 每次換學生加一；回應回來時編號不同就是舊學生的，直接丟掉。 */
let reportRequestId = 0;

const state = {
  students: [], // [{ id, name, username }]
  days: [], // 固定第 1～24 天
  sessions: [], // 目前學生的場次資料。選擇施測日時，用於計算進度。
  reportStatus: "idle", // "idle" | "loading" | "ready" | "error"。目前學生的場次讀取狀態。
  selectedStudentId: "",
  selectedDay: null, // 未選擇施測日時為 null。
  progressByGame: {}, // { [gameId]: 0 | 50 | 100 }
  detailByGame: {}, // { [gameId]: { reached, accuracy, levelAccuracy, ...metrics } }
};

init();

/** 進入頁面後，先確認老師 token，再讀取學生名單。 */
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
    await WebGameApi.logoutAll();
  } finally {
    sessionStorage.clear();
    location.href = "../Home/index.html";
  }
});

dayRow.addEventListener("click", (event) => {
  const button = event.target.closest("[data-day]");
  if (!button || button.disabled) return; // 未選擇學生時，停用施測日按鈕。
  selectDay(Number(button.dataset.day));
});

reportRetry.addEventListener("click", () => {
  if (state.selectedStudentId) selectStudent(state.selectedStudentId);
});

/**
 * 切換學生時，先清除上一位的場次、已選施測日與進度，再重新取得該學生的場次。
 * 載入中與讀取失敗時，停用施測日按鈕。較晚返回的舊學生回應直接丟棄。
 * @param {string} studentId 下拉選單的 value。空字串表示返回「請選擇學生」。
 */
async function selectStudent(studentId) {
  const requestId = ++reportRequestId;
  state.selectedStudentId = studentId;
  state.selectedDay = null;
  state.progressByGame = {};
  state.detailByGame = {};
  state.sessions = [];
  state.reportStatus = studentId ? "loading" : "idle";
  state.days = TRAINING_DAYS;
  renderDays();
  renderProgress();
  if (!studentId) return;

  let sessions = null;
  try {
    sessions = await fetchStudentReport(studentId);
  } catch (_err) {
    sessions = null;
  }
  if (requestId !== reportRequestId) return; // 期間已換成別的學生
  state.sessions = sessions || [];
  state.reportStatus = sessions ? "ready" : "error";
  renderDays();
  renderProgress();
}

/** 選擇施測日後，立即更新選取狀態與進度。選擇學生時，已取得場次資料。 */
function selectDay(day) {
  if (!state.selectedStudentId || state.reportStatus !== "ready") return;
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

/** 將學生名單加入下拉選單。第一個 option 顯示提示文字。 */
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
 * 繪製第 1～24 天的按鈕。
 * 未選擇學生、場次載入中或讀取失敗時，停用所有按鈕。
 */
function renderDays() {
  const hasStudent = Boolean(state.selectedStudentId) && state.reportStatus === "ready";
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
 * 學生與施測日皆已選擇時，繪製進度清單。
 * 否則顯示「請先選擇學生與天數」或「請選擇第幾天」。
 */
function renderProgress() {
  const hasStudent = Boolean(state.selectedStudentId);
  const hasDay = state.selectedDay != null;
  emptyHint.hidden = hasStudent;
  reportView.hidden = !hasStudent;
  dayPrompt.hidden = !hasStudent || hasDay;
  dayPrompt.textContent =
    state.reportStatus === "loading" ? DAY_PROMPT_LOADING
      : state.reportStatus === "error" ? DAY_PROMPT_ERROR
        : DAY_PROMPT;
  reportRetry.hidden = !hasStudent || hasDay || state.reportStatus !== "error";
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
  document.getElementById("view-last-played").textContent = formatUtcTimestamp(student.lastPlayedAt) || "尚無評測紀錄";
}

function renderRecords() {
  // 後端時間都是 UTC 且固定寬度，直接比字串就是實際先後；顯示時才轉台灣時間。
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
    const mode = sessionMode(session);
    return `
      <tr>
        <td><strong>${gameLabel(session.gameType)}</strong></td>
        <td><span class="mode-tag ${mode}">${mode === "double" ? "雙人" : "單人"}</span></td>
        <td><strong>${formatAccuracy(stats.accuracy)}</strong></td>
        <td>${stats.correctCount ?? "—"} / ${stats.wrongCount ?? "—"}</td>
        <td>${formatDuration(stats.duration)}</td>
        <td>${isSecondHalf(session) ? "6（第 4～6 關）" : stats.stage ?? "—"}</td>
        <td>${formatUtcTimestamp(session.startTime) || "—"}</td>
      </tr>
    `;
  }).join("");
}

function sessionMode(session) {
  return String(session.mode || "single").toLowerCase();
}

function gameLabel(gameType) {
  const id = WebGameApi.mapGameId(gameType);
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
  if (gameId === "DAT") {
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

/** 施測都在台灣，時間一律以台灣時間（UTC+8）顯示，不跟著裝置時區。 */
const TAIPEI_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/**
 * 後端時間字串是 UTC（"YYYY-MM-DD HH:MM:SS"，不帶時區），
 * 換成台灣時間後用同樣格式顯示。空值回空字串；看不懂的字串原樣顯示。
 */
function formatUtcTimestamp(value) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(`${value.trim().replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  const part = Object.fromEntries(TAIPEI_TIME.formatToParts(date).map(({ type, value: text }) => [type, text]));
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second}`;
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

  const res = await WebGameApi.authGet(
    `/students/${encodeURIComponent(studentKey)}/report?school=${encodeURIComponent(school)}`,
    token
  );
  if (!res.ok) throw new Error(`讀取成績失敗（HTTP ${res.status}）`);
  const body = await res.json();
  return Array.isArray(body.records) ? body.records : [];
}

/** 讀取登入老師的學生名單。 */
async function fetchTeacherStudents() {
  const token = teacherToken();
  if (!token) return [];

  try {
    const res = await WebGameApi.authGet("/me/students", token);
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

/**
 * 每個遊戲一張卡片。同一天分兩次玩完（stage 3 加只含第 4～6 關的 stage 6）時合併兩列；
 * 否則取關卡最高的那一列。
 */
function detailFromSessions(sessions, day) {
  const rowsByGame = {};
  sessions.forEach((session) => {
    if (Number(session.currentDay) !== Number(day)) return;
    const gameId = WebGameApi.mapGameId(session.gameType);
    if (!GAMES.some((game) => game.id === gameId)) return;
    (rowsByGame[gameId] = rowsByGame[gameId] || []).push(session);
  });
  const detail = {};
  Object.entries(rowsByGame).forEach(([gameId, rows]) => {
    const pair = halvesPair(gameId, rows);
    detail[gameId] = pair ? mergeHalves(gameId, pair.first, pair.second) : furthestRow(gameId, rows);
  });
  return detail;
}

/** 取關卡最高的那一列；同關卡時，完整的一列優先於後半，有各關正確率的優先於沒有的。 */
function furthestRow(gameId, rows) {
  let best = null;
  let bestIsHalf = false;
  rows.forEach((session) => {
    const next = rowDetail(gameId, session);
    const nextIsHalf = isSecondHalf(session);
    const further = !best || (next.reached || 0) > (best.reached || 0);
    const sameReach = best && (next.reached || 0) === (best.reached || 0);
    const fuller = sameReach && bestIsHalf && !nextIsHalf;
    const withLevels = sameReach && bestIsHalf === nextIsHalf && next.levelAccuracy && !best.levelAccuracy;
    if (further || fuller || withLevels) {
      best = next;
      bestIsHalf = nextIsHalf;
    }
  });
  return best;
}

function rowDetail(gameId, session) {
  const stats = session.stats || {};
  const accuracy = Number(stats.accuracy);
  return {
    reached: levelsReached(gameId, Number(stats.stage)),
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    levelAccuracy: parseLevelAccuracy(stats),
    duration: finiteOrNull(stats.duration),
    avgReactionMs: finiteOrNull(stats.avgReactionMs),
    questionCount: finiteOrNull(stats.questionCount),
    aimRatio: finiteOrNull(stats.aimRatio),
    focusMs: finiteOrNull(stats.focusMs),
    correctCount: finiteOrNull(stats.correctCount),
    wrongCount: finiteOrNull(stats.wrongCount),
  };
}

/**
 * 後半那一列：從第 4 關開始的一局，打完送 stage 6，各關正確率只有第 4～6 關這 3 個值。
 * 打完整局的 stage 6 一定有 6 個值，不會認錯。
 */
function isSecondHalf(session) {
  const stats = session.stats || {};
  const levels = parseLevelAccuracy(stats);
  return Number(stats.stage) === 6 && Boolean(levels) && levels.length === 3;
}

/**
 * 找當天要合併的前後半。後半配同模式、開始時間比它早的最後一筆 stage 3；
 * 有多組時取後半較晚的那組。當天有完整 6 關的一列時不合併，回 null。
 */
function halvesPair(gameId, rows) {
  if (rows.some((row) => levelsReached(gameId, Number(row.stats && row.stats.stage)) === 6 && !isSecondHalf(row))) {
    return null;
  }
  // 後端時間是固定寬度的 UTC 字串，直接比字串就是先後。
  const byTime = rows.slice().sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  let pair = null;
  byTime.forEach((second) => {
    if (!isSecondHalf(second)) return;
    const firsts = byTime.filter((row) =>
      sessionMode(row) === sessionMode(second)
      && Number(row.stats && row.stats.stage) === 3
      && String(row.startTime) < String(second.startTime));
    if (firsts.length) pair = { first: firsts[firsts.length - 1], second };
  });
  return pair;
}

/** 合併前後半兩列：次數、時長相加，正確率與平均值按題數或時長重算，各關正確率前 3 接後 3。 */
function mergeHalves(gameId, firstRow, secondRow) {
  const first = rowDetail(gameId, firstRow);
  const second = rowDetail(gameId, secondRow);
  const sum = (key) => (first[key] == null && second[key] == null ? null : (first[key] || 0) + (second[key] || 0));
  // 指令出擊沒有 questionCount，題數改用答對加答錯。
  const questions = (part) => (part.questionCount != null ? part.questionCount : (part.correctCount || 0) + (part.wrongCount || 0));
  const weighted = (key, weight) => {
    const parts = [first, second].filter((part) => part[key] != null && weight(part) > 0);
    const total = parts.reduce((acc, part) => acc + weight(part), 0);
    return total > 0 ? parts.reduce((acc, part) => acc + part[key] * weight(part), 0) / total : null;
  };
  const totalQuestions = questions(first) + questions(second);
  const correct = sum("correctCount");
  // 前半沒有各關正確率時留 undefined（顯示「尚無各關紀錄」）；null 會被 Number() 當成 0%。
  const firstLevels = Array.from({ length: 3 }, (_, index) => (first.levelAccuracy || [])[index]);
  return {
    reached: 6,
    accuracy: totalQuestions > 0 && correct != null ? correct / totalQuestions : null,
    levelAccuracy: firstLevels.concat(second.levelAccuracy),
    duration: sum("duration"),
    avgReactionMs: weighted("avgReactionMs", questions),
    questionCount: sum("questionCount"),
    aimRatio: weighted("aimRatio", (part) => part.duration || 0),
    focusMs: sum("focusMs"),
    correctCount: correct,
    wrongCount: sum("wrongCount"),
  };
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
  const percent = WebGameApi.progressFromRecord(gameId, { stats: { stage } });
  return percent >= 100 ? 6 : 3;
}

function progressFromSessions(sessions, day) {
  const progress = emptyProgress();
  sessions.forEach((session) => {
    if (Number(session.currentDay) !== Number(day)) return;
    const gameId = WebGameApi.mapGameId(session.gameType);
    if (!Object.prototype.hasOwnProperty.call(progress, gameId)) return;
    progress[gameId] = Math.max(
      progress[gameId],
      WebGameApi.progressFromRecord(gameId, session)
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
 * 將數值轉換為最接近的 0、50 或 100。
 * 後端回傳其他數值時，畫面仍可顯示三格進度條。
 */
function normalizeProgress(value) {
  const number = Number(value) || 0;
  return PROGRESS_STEPS.reduce((closest, step) =>
    Math.abs(step - number) < Math.abs(closest - number) ? step : closest
  );
}
