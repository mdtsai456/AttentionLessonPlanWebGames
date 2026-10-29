// Home 登入：「登入中…」期間切換身份／模式，不可改變這次登入要存的模式。
import { test, expect } from "@playwright/test";

/** 攔截學生登入，回應要等 release() 才送出，用來卡在「登入中…」。 */
async function holdStudentLogin(page) {
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  const requests = [];
  await page.route("**/api/auth/student/login", async (route) => {
    requests.push(route.request().postDataJSON());
    await released;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "student-token." + crypto.randomUUID(),
        studentKey: "G9_S99", grade: "G9", caseId: "S99", school: "TEST",
        expiresAt: new Date(Date.now() + 3600000).toISOString(), expiresIn: 3600,
      }),
    });
  });
  return { release, requests };
}

async function openSingleStudentForm(page) {
  await page.addInitScript(() => { window.API_BASE_URL = location.origin + "/api"; });
  await page.goto("Home/index.html");
  await page.locator('[data-role="student"]').click();
  await page.locator('[data-mode="single"]').click();
  await page.locator('[name="username-0"]').fill("S0001");
  await page.locator('[name="password-0"]').fill("pw");
  await page.locator('[name="day-0"]').fill("3");
}

test("切換模式或身分後，帳號密碼欄位會清空，不殘留前一位使用者輸入的內容", async ({ page }) => {
  await openSingleStudentForm(page);
  await expect(page.locator('[name="username-0"]')).toHaveValue("S0001");

  await page.locator('[data-mode="dual"]').click();
  await expect(page.locator('[name="username-0"]')).toHaveValue("");
  await expect(page.locator('[name="username-1"]')).toHaveValue("");
  await expect(page.locator('[name="password-0"]')).toHaveValue("");

  await page.locator('[name="username-0"]').fill("S0002");
  await page.locator('[data-role="teacher"]').click();
  await expect(page.locator('[name="username-0"]')).toHaveValue("");
});

test("帳號密碼欄位帶有防止瀏覽器自動帶入前次帳號的 autocomplete 設定", async ({ page }) => {
  await openSingleStudentForm(page);
  await expect(page.locator('[name="username-0"]')).toHaveAttribute("autocomplete", "off");
  await expect(page.locator('[name="password-0"]')).toHaveAttribute("autocomplete", "new-password");
});

for (const [label, change] of [
  ["改選雙人", () => selectMode("dual")],
  ["改選老師", () => selectRole("teacher")],
]) {
  test(`單人登入中${label}，仍以單人登入並進入 Select`, async ({ page }) => {
    const login = await holdStudentLogin(page);
    await openSingleStudentForm(page);
    await page.locator('#login-form [type="submit"]').click();
    await expect(page.locator("#error-msg")).toHaveText("登入中…");
    expect(login.requests).toHaveLength(1);

    // 直接呼叫頁面函式，模擬登入回應前使用者又按了別的按鈕。
    await page.evaluate(change);
    login.release();

    await page.waitForURL(/\/Select\/index\.html/);
    const stored = await page.evaluate(() => ({
      role: sessionStorage.getItem("user_role"),
      mode: sessionStorage.getItem("game_mode"),
    }));
    expect(stored).toEqual({ role: "student", mode: "single" });
    // 守門驗證通過後頁面可見，沒有被踢回 Home。
    await expect(page.locator("html")).not.toHaveAttribute("style", /visibility: hidden/);
    await expect(page).toHaveURL(/\/Select\/index\.html/);
  });
}

test("登入中身份與模式按鈕停用，失敗後恢復", async ({ page }) => {
  await page.route("**/api/auth/student/login", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({ status: 401, contentType: "application/json", body: '{"detail":"帳號或密碼錯誤"}' });
  });
  await openSingleStudentForm(page);
  await page.locator('#login-form [type="submit"]').click();

  await expect(page.locator("#error-msg")).toHaveText("登入中…");
  for (const selector of ['[data-role="student"]', '[data-role="teacher"]', '[data-mode="single"]', '[data-mode="dual"]']) {
    await expect(page.locator(selector)).toBeDisabled();
  }

  await expect(page.locator("#error-msg")).toHaveText("帳號或密碼錯誤");
  for (const selector of ['[data-role="student"]', '[data-role="teacher"]', '[data-mode="single"]', '[data-mode="dual"]']) {
    await expect(page.locator(selector)).toBeEnabled();
  }
});

test("裝置時鐘快 2 小時：登入後仍留在 Select，到期時間以 expiresIn 計算", async ({ page }) => {
  const token = "student-token." + crypto.randomUUID();
  const serverExpiry = () => new Date(Date.now() + 3600000).toISOString();
  const student = { studentKey: "G9_S99", grade: "G9", caseId: "S99", school: "TEST" };
  await page.route("**/api/auth/student/login", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ token, ...student, expiresAt: serverExpiry(), expiresIn: 3600 }),
  }));
  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" },
    body: JSON.stringify({ role: "student", ...student, expiresAt: serverExpiry(), expiresIn: 3599 }),
  }));
  await page.clock.install({ time: Date.now() + 2 * 3600000 });
  await page.clock.resume();
  await openSingleStudentForm(page);
  await page.locator('#login-form [type="submit"]').click();

  await page.waitForURL(/\/Select\/index\.html/);
  await expect(page.locator("html")).not.toHaveAttribute("style", /visibility: hidden/);
  const remaining = await page.evaluate(() => Number(sessionStorage.getItem("login_expires_at")) - Date.now());
  expect(remaining).toBeGreaterThan(3500000);
  await expect(page).toHaveURL(/\/Select\/index\.html/);
});
