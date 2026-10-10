// =============================================================================
// Home / 登入頁
// 登入流程：選擇身分。學生再選單人或雙人模式。輸入帳號與密碼後，呼叫後端登入。
// 老師登入後進入 Back，學生登入後進入 Select。年級與場域使用後端回傳值。
// =============================================================================

const panel = document.querySelector(".panel");
const roleStep = document.getElementById("role-step");
const modeStep = document.getElementById("mode-step");
const loginForm = document.getElementById("login-form");
const enterBtn = loginForm.querySelector('[type="submit"]');
const credentialSlots = document.getElementById("credential-slots");
const errorMsg = document.getElementById("error-msg");

const state = {
  role: null, // "student" | "teacher"
  mode: null, // "single" | "dual" | null。老師不需要選擇模式。
};

// 點擊學生或老師按鈕時，使用 closest 識別按鈕內文字的點擊。
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
  event.preventDefault(); // 攔截原生表單送出，改由 submitLogin 處理。
  submitLogin();
});

// 登入成功後維持按鈕停用。按上一頁並從 bfcache 還原時，重新啟用按鈕。
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  enterBtn.disabled = false;
  errorMsg.textContent = "";
});

/**
 * 選擇身分。
 * 老師直接顯示一組帳號與密碼欄位。
 * 學生先隱藏表單，再顯示單人與雙人模式選擇。
 */
function selectRole(role) {
  state.role = role;
  state.mode = null; // 切換身分時，清除先前選擇的模式。
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
 * 選擇單人或雙人模式。
 * 雙人模式加入 is-dual，將帳號與密碼欄位排成兩欄。
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

/** 依玩家人數建立欄位。學生另填施測日，年級與場域由登入回應提供。老師只填帳號與密碼。 */
function renderCredentialSlots(count, titles, includeSession) {
  credentialSlots.innerHTML = titles
    .slice(0, count)
    .map((title, index) => {
      const sessionFields = includeSession
        ? `
          <label class="field">
            <span class="field-label">第幾天</span>
            <input type="number" name="day-${index}" min="1" max="24" step="1" placeholder="1～24" required />
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

/** 從畫面欄位取得帳號、密碼與施測日。移除帳號前後的空白。 */
function collectAccounts() {
  const slots = [...credentialSlots.querySelectorAll(".slot")];
  return slots.map((slot, index) => ({
    username: fieldValue(slot, `username-${index}`),
    password: fieldValue(slot, `password-${index}`),
    currentDay: fieldValue(slot, `day-${index}`),
  }));
}

/**
 * 執行前端基本檢查。失敗時回傳錯誤訊息，通過時回傳空字串。
 * 雙人模式須有兩組帳號與密碼，其他情況使用一組。
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
    const outOfRange = accounts.findIndex((item) => {
      const day = Number(item.currentDay);
      return !Number.isInteger(day) || day < 1 || day > 24;
    });
    if (outOfRange !== -1) {
      return expected === 2
        ? `學生 ${outOfRange + 1} 的第幾天請輸入 1 到 24`
        : "第幾天請輸入 1 到 24";
    }
  }

  return "";
}

function backendErrorMessage(err) {
  if (err && err.name === "TypeError") {
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "後端連不上，請先啟動 http://127.0.0.1:5001";
    }
    return "後端連不上，請稍後再試";
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
  window.WebGameSession?.stampLoginExpiry(result.expiresAt);
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
  window.WebGameSession?.stampLoginExpiry(results.map((item) => item.expiresAt));
}

async function submitLogin() {
  const accounts = collectAccounts();
  const message = validate(accounts);
  errorMsg.textContent = message;
  if (message) return;

  enterBtn.disabled = true;
  errorMsg.textContent = "登入中…";

  // 已取得的登入結果。登入流程未完成時，在 finally 登出，避免伺服器保留 token。
  const results = [];
  let loggedIn = false;
  const teacher = state.role === "teacher";
  const dual = state.mode === "dual";
  // 雙人模式中目前登入的學生序號，用於錯誤訊息前綴。0 表示未進行登入。
  let loginSlot = 0;

  try {
    if (teacher) {
      const result = await WebGameApi.loginTeacher(
        accounts[0].username,
        accounts[0].password
      );
      if (!result) {
        errorMsg.textContent = "帳號或密碼錯誤";
        return;
      }
      results.push(result);
    } else {
      for (const [index, account] of accounts.entries()) {
        loginSlot = index + 1;
        const result = await WebGameApi.loginStudent(
          account.username,
          account.password
        );
        if (!result) {
          errorMsg.textContent = dual
            ? `學生 ${loginSlot} 帳號或密碼錯誤`
            : "帳號或密碼錯誤";
          return;
        }
        results.push(result);
      }
      loginSlot = 0;
    }

    // 清除 sessionStorage 前，先登出舊 token，包含按上一頁返回後的再次登入。
    WebGameApi.storedTokens().forEach((token) => WebGameApi.logout(token));
    try {
      if (teacher) {
        storeTeacherSession(results[0]);
      } else {
        const days = accounts.map((item) => item.currentDay);
        storeStudentSession(state.mode, results, days);
      }
    } catch (_err) {
      // 寫入登入狀態失敗時，清除已登出 token 的狀態，並避免將錯誤顯示為後端錯誤。
      sessionStorage.clear();
      throw new Error("無法儲存登入狀態，請重新整理頁面後再試");
    }
    loggedIn = true;
    location.href = teacher ? "../Teacher_platform/index.html" : "../Select/index.html";
  } catch (err) {
    const prefix = dual && loginSlot ? `學生 ${loginSlot}：` : "";
    errorMsg.textContent = `${prefix}${backendErrorMessage(err)}`;
  } finally {
    // 登入成功並導向頁面時，維持按鈕停用，避免重複送出並取得額外 token。
    if (!loggedIn) {
      results.forEach((result) => WebGameApi.logout(result.token));
      enterBtn.disabled = false;
    }
  }
}

/** 同一組按鈕中，僅為目前選取的按鈕加入 is-selected 樣式。 */
function setSelected(allSelector, activeSelector) {
  document.querySelectorAll(allSelector).forEach((button) => {
    button.classList.toggle("is-selected", button.matches(activeSelector));
  });
}

/** 清除指定按鈕的選取樣式。例如，老師不需選擇模式，須清除單人與雙人按鈕的選取狀態。 */
function clearSelected(selector) {
  document.querySelectorAll(selector).forEach((button) => {
    button.classList.remove("is-selected");
  });
}

// 驗證失敗時返回登入頁，在角色選擇畫面顯示提示，無須先開啟登入表單。
const authReason = new URLSearchParams(location.search).get('auth');
if (authReason === 'retry' || authReason === 'expired') {
  const notice = document.createElement('p');
  notice.setAttribute('role', 'alert');
  notice.className = 'error';
  notice.textContent = authReason === 'retry'
    ? '無法連線驗證登入，請確認網路後重新嘗試登入。'
    : '登入已失效或身分不符，請重新登入。';
  panel.appendChild(notice);
}
