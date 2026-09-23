// =============================================================================
// Home / 登入頁
// 流程：選身份（學生／老師）→ 學生再選模式（單人／雙人）→ 填帳密 → 打後端登入
// 老師登入後進 Back；學生登入後進 Select。年級／場域以後端回傳為準。
// =============================================================================

const panel = document.querySelector(".panel");
const roleStep = document.getElementById("role-step");
const modeStep = document.getElementById("mode-step");
const loginForm = document.getElementById("login-form");
const credentialSlots = document.getElementById("credential-slots");
const errorMsg = document.getElementById("error-msg");

const state = {
  role: null, // "student" | "teacher"
  mode: null, // "single" | "dual" | null（老師不需要模式）
};

// 點「學生／老師」時，用 closest 讓點到按鈕內文字也能算點到按鈕
roleStep.addEventListener("click", (event) => {
  const button = event.target.closest("[data-role]");
  if (!button) return;
  selectRole(button.dataset.role);
});

modeStep.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (!button) return;
  selectMode(button.dataset.mode);
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault(); // 攔截原生送出，改由 submitLogin 處理
  submitLogin();
});

/**
 * 選擇身份。
 * 老師：直接顯示一組帳密欄位。
 * 學生：先隱藏表單，再顯示單人／雙人步驟。
 */
function selectRole(role) {
  state.role = role;
  state.mode = null; // 換身份時清掉先前選的模式
  setSelected("[data-role]", `[data-role="${role}"]`);
  errorMsg.textContent = "";
  panel.classList.remove("is-dual", "is-single");

  if (role === "teacher") {
    modeStep.classList.add("is-hidden");
    clearSelected("[data-mode]");
    renderCredentialSlots(1, ["老師"], false);
    loginForm.classList.remove("is-hidden");
    return;
  }

  loginForm.classList.add("is-hidden");
  credentialSlots.innerHTML = "";
  modeStep.classList.remove("is-hidden");
}

/**
 * 選擇單人／雙人。
 * 雙人會加上 is-dual，讓版面改成兩欄帳密。
 */
function selectMode(mode) {
  state.mode = mode;
  setSelected("[data-mode]", `[data-mode="${mode}"]`);
  errorMsg.textContent = "";
  panel.classList.toggle("is-dual", mode === "dual");
  panel.classList.toggle("is-single", mode === "single");

  if (mode === "single") {
    renderCredentialSlots(1, ["學生"], true);
  } else {
    renderCredentialSlots(2, ["學生 1", "學生 2"], true);
  }

  loginForm.classList.remove("is-hidden");
}

/**
 * 依人數畫出欄位。學生會多年級／場域／第幾天；老師只有帳密。
 */
function renderCredentialSlots(count, titles, includeSession) {
  credentialSlots.innerHTML = titles
    .slice(0, count)
    .map((title, index) => {
      const sessionFields = includeSession
        ? `
          <label class="field">
            <span class="field-label">年級</span>
            <input type="text" name="grade-${index}" placeholder="登入後自動帶入" autocomplete="off" />
          </label>
          <label class="field">
            <span class="field-label">場域</span>
            <input type="text" name="school-${index}" placeholder="登入後自動帶入" autocomplete="off" />
          </label>
          <label class="field">
            <span class="field-label">第幾天</span>
            <input type="number" name="day-${index}" min="1" step="1" placeholder="例如 1" required />
          </label>
        `
        : "";

      return `
        <div class="slot">
          <p class="slot-title">${title}</p>
          <label class="field">
            <input
              type="text"
              name="username-${index}"
              placeholder="帳號"
              autocomplete="username"
              required
            />
          </label>
          <label class="field">
            <input
              type="password"
              name="password-${index}"
              placeholder="密碼"
              autocomplete="current-password"
              required
            />
          </label>
          ${sessionFields}
        </div>
      `;
    })
    .join("");
}

function fieldValue(slot, name) {
  const input = slot.querySelector(`[name="${name}"]`);
  return input ? input.value.trim() : "";
}

/** 從畫面上的欄位收集帳密與場次；帳號會去掉前後空白。 */
function collectAccounts() {
  const slots = [...credentialSlots.querySelectorAll(".slot")];
  return slots.map((slot, index) => ({
    username: fieldValue(slot, `username-${index}`),
    password: fieldValue(slot, `password-${index}`),
    grade: fieldValue(slot, `grade-${index}`),
    school: fieldValue(slot, `school-${index}`),
    currentDay: fieldValue(slot, `day-${index}`),
  }));
}

/**
 * 前端基本檢查。有錯誤回傳訊息字串；通過則回傳空字串。
 * 雙人必須剛好兩組帳密，其餘情況一組即可。
 */
function validate(accounts) {
  if (!state.role) return "請先選擇身份";
  if (state.role === "student" && !state.mode) return "請選擇單人或雙人";

  const expected = state.role === "student" && state.mode === "dual" ? 2 : 1;
  if (accounts.length !== expected) return "帳密欄位不完整";

  const hasEmpty = accounts.some((item) => !item.username || !item.password);
  if (hasEmpty) return "請輸入完整帳號與密碼";

  if (state.role === "student") {
    const missing = accounts.findIndex((item) => !item.currentDay);
    if (missing !== -1) {
      return expected === 2
        ? `請輸入學生 ${missing + 1} 的第幾天`
        : "請輸入第幾天";
    }
  }

  return "";
}

function backendErrorMessage(err) {
  if (err && err.name === "TypeError") {
    return "後端連不上，請先啟動 http://127.0.0.1:5001";
  }
  return err && err.message ? err.message : "登入失敗，請稍後再試";
}

function storeTeacherSession(result) {
  sessionStorage.clear();
  sessionStorage.setItem("user_role", "teacher");
  sessionStorage.setItem("login_role", "teacher");
  sessionStorage.setItem("token", result.token);
  sessionStorage.setItem("teacher_id", String(result.teacherId));
  sessionStorage.setItem("teacher_name", result.teacherName);
  sessionStorage.setItem("teacher_school", result.school);
}

function storeStudentSlot(slot, result, day) {
  sessionStorage.setItem(`student${slot}_token`, result.token);
  sessionStorage.setItem(`student${slot}_key`, result.studentKey);
  sessionStorage.setItem(`student${slot}_case`, result.caseId);
  sessionStorage.setItem(`student${slot}_grade`, result.grade);
  sessionStorage.setItem(`student${slot}_school`, result.school);
  sessionStorage.setItem(`student${slot}_day`, String(day));
}

function storeStudentSession(mode, results, days) {
  sessionStorage.clear();
  sessionStorage.setItem("user_role", "student");
  sessionStorage.setItem("login_role", "student");
  sessionStorage.setItem("game_mode", mode === "dual" ? "double" : "single");
  sessionStorage.setItem("token", results[0].token);
  results.forEach((result, index) => {
    storeStudentSlot(index + 1, result, days[index]);
  });
  sessionStorage.setItem("grade", results[0].grade);
  sessionStorage.setItem("caseId", results[0].caseId);
  sessionStorage.setItem("school", results[0].school);
  sessionStorage.setItem("current_day", String(days[0]));
  sessionStorage.setItem("currentDay", String(days[0]));
}

async function submitLogin() {
  const accounts = collectAccounts();
  const message = validate(accounts);
  errorMsg.textContent = message;
  if (message) return;

  const enterBtn = loginForm.querySelector('[type="submit"]');
  if (enterBtn) enterBtn.disabled = true;
  errorMsg.textContent = "登入中…";

  try {
    if (state.role === "teacher") {
      const result = await WedGameApi.loginTeacher(
        accounts[0].username,
        accounts[0].password
      );
      if (!result) {
        errorMsg.textContent = "帳號或密碼錯誤";
        return;
      }
      storeTeacherSession(result);
      location.href = "../Back/index.html";
      return;
    }

    const result1 = await WedGameApi.loginStudent(
      accounts[0].username,
      accounts[0].password
    );
    if (!result1) {
      errorMsg.textContent =
        state.mode === "dual" ? "學生 1 帳號或密碼錯誤" : "帳號或密碼錯誤";
      return;
    }

    let result2 = null;
    if (state.mode === "dual") {
      result2 = await WedGameApi.loginStudent(
        accounts[1].username,
        accounts[1].password
      );
      if (!result2) {
        errorMsg.textContent = "學生 2 帳號或密碼錯誤";
        return;
      }
    }

    const results = result2 ? [result1, result2] : [result1];
    const days = accounts.map((item) => item.currentDay);
    storeStudentSession(state.mode, results, days);
    location.href = "../Select/index.html";
  } catch (err) {
    errorMsg.textContent = backendErrorMessage(err);
  } finally {
    if (enterBtn) enterBtn.disabled = false;
  }
}

/** 同一組按鈕只讓目前選到的那個加上 is-selected（按下的視覺）。 */
function setSelected(allSelector, activeSelector) {
  document.querySelectorAll(allSelector).forEach((button) => {
    button.classList.toggle("is-selected", button.matches(activeSelector));
  });
}

/** 清掉指定按鈕上的選取樣式（例如老師不需要模式，就要清掉單人／雙人）。 */
function clearSelected(selector) {
  document.querySelectorAll(selector).forEach((button) => {
    button.classList.remove("is-selected");
  });
}
