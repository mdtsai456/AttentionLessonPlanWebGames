// =============================================================================
// Home / 登入頁
// 流程：選身份（學生／老師）→ 學生再選模式（單人／雙人）→ 填帳密 → 送出
// 老師登入後進 Back；學生登入後進 Select。後端 API 尚未接上。
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
  panel.classList.remove("is-dual");

  if (role === "teacher") {
    modeStep.classList.add("is-hidden");
    clearSelected("[data-mode]");
    renderCredentialSlots(1, ["老師"]);
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

  if (mode === "single") {
    renderCredentialSlots(1, ["學生"]);
  } else {
    renderCredentialSlots(2, ["學生 1", "學生 2"]);
  }

  loginForm.classList.remove("is-hidden");
}

/**
 * 依人數畫出帳號／密碼欄位。
 * @param {number} count 要顯示幾組帳密
 * @param {string[]} titles 每組上方標題，例如「學生 1」
 */
function renderCredentialSlots(count, titles) {
  credentialSlots.innerHTML = titles
    .slice(0, count)
    .map(
      (title, index) => `
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
        </div>
      `
    )
    .join("");
}

/** 從畫面上的欄位收集帳密；帳號會去掉前後空白。 */
function collectAccounts() {
  const slots = [...credentialSlots.querySelectorAll(".slot")];
  return slots.map((slot, index) => ({
    username: slot.querySelector(`[name="username-${index}"]`).value.trim(),
    password: slot.querySelector(`[name="password-${index}"]`).value,
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

  return "";
}

/** 驗證通過後組 payload；目前先導向下一頁，之後改呼叫後端登入 API。 */
async function submitLogin() {
  const accounts = collectAccounts();
  const message = validate(accounts);
  errorMsg.textContent = message;
  if (message) return;

  const payload = {
    role: state.role,
    mode: state.role === "teacher" ? null : state.mode,
    accounts,
  };

  // -------------------------------------------------------------------------
  // 後端接點（之後接 API 時改這裡即可）
  //
  // 建議：
  // 1. 老師登入：POST /api/auth/teacher
  // 2. 學生單人：POST /api/auth/student  （accounts 長度 = 1）
  // 3. 學生雙人：POST /api/auth/student  （accounts 長度 = 2）
  //
  // payload 範例：
  // {
  //   role: "student" | "teacher",
  //   mode: "single" | "dual" | null,
  //   accounts: [{ username, password }, ...]
  // }
  //
  // const response = await fetch("/api/auth/login", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(payload),
  // });
  // if (!response.ok) {
  //   errorMsg.textContent = "登入失敗，請確認帳密";
  //   return;
  // }
  // const data = await response.json();
  // // 依 role / mode 導向下一頁，例如：
  // // location.href = data.redirectUrl;
  // -------------------------------------------------------------------------

  console.log("[login payload 待接後端]", payload);
  errorMsg.textContent = "";

  // 純前端暫用導向；之後改成後端回傳的 redirectUrl
  if (state.role === "teacher") {
    location.href = "../Back/index.html";
    return;
  }
  location.href = "../Select/index.html";
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
