const roleStep = document.getElementById("role-step");
const modeStep = document.getElementById("mode-step");
const loginForm = document.getElementById("login-form");
const credentialSlots = document.getElementById("credential-slots");
const errorMsg = document.getElementById("error-msg");

const state = {
  role: null, // "student" | "teacher"
  mode: null, // "single" | "dual" | null（老師不需要模式）
};

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
  event.preventDefault();
  submitLogin();
});

function selectRole(role) {
  state.role = role;
  state.mode = null;
  setSelected("[data-role]", `[data-role="${role}"]`);
  errorMsg.textContent = "";

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

function selectMode(mode) {
  state.mode = mode;
  setSelected("[data-mode]", `[data-mode="${mode}"]`);
  errorMsg.textContent = "";

  if (mode === "single") {
    renderCredentialSlots(1, ["學生"]);
  } else {
    renderCredentialSlots(2, ["學生 1", "學生 2"]);
  }

  loginForm.classList.remove("is-hidden");
}

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

function collectAccounts() {
  const slots = [...credentialSlots.querySelectorAll(".slot")];
  return slots.map((slot, index) => ({
    username: slot.querySelector(`[name="username-${index}"]`).value.trim(),
    password: slot.querySelector(`[name="password-${index}"]`).value,
  }));
}

function validate(accounts) {
  if (!state.role) return "請先選擇身份";
  if (state.role === "student" && !state.mode) return "請選擇單人或雙人";

  const expected = state.role === "student" && state.mode === "dual" ? 2 : 1;
  if (accounts.length !== expected) return "帳密欄位不完整";

  const hasEmpty = accounts.some((item) => !item.username || !item.password);
  if (hasEmpty) return "請輸入完整帳號與密碼";

  return "";
}

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
}

function setSelected(allSelector, activeSelector) {
  document.querySelectorAll(allSelector).forEach((button) => {
    button.classList.toggle("is-selected", button.matches(activeSelector));
  });
}

function clearSelected(selector) {
  document.querySelectorAll(selector).forEach((button) => {
    button.classList.remove("is-selected");
  });
}
