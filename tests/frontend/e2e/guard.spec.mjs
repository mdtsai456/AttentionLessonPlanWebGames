// 010：學生單人頁面的登入驗證。
import { test, expect } from "@playwright/test";
import { GUARDED_PAGES, DCCS_PAGE } from "../site.mjs";
import { HOME_URL, STUDENT, TEACHER, loginAs, recordWrites } from "./helpers.mjs";

const STUDENT_WITHOUT_ROLE = { ...STUDENT };
delete STUDENT_WITHOUT_ROLE.user_role;
delete STUDENT_WITHOUT_ROLE.login_role;

const REJECTED_SESSIONS = [
  ["未登入", {}],
  ["老師登入", TEACHER],
  ["學生資料但沒有 token", { ...STUDENT, token: "", student1_token: "" }],
  ["學生資料與 token 但缺少角色", STUDENT_WITHOUT_ROLE],
  ["老師登入且殘留學生資料", { ...STUDENT, ...TEACHER }],
];

for (const [label, session] of REJECTED_SESSIONS) {
  for (const pagePath of GUARDED_PAGES) {
    test(`${label}：開 ${pagePath} 會導回 Home，且不送任何寫入`, async ({ page }) => {
      const writes = await recordWrites(page);
      await loginAs(page, session);
      const historyBefore = await page.evaluate(() => history.length);

      await page.goto(pagePath);
      await expect(page).toHaveURL(HOME_URL);
      // 使用 location.replace，避免將未通過驗證的頁面加入瀏覽紀錄。
      expect(await page.evaluate(() => history.length)).toBe(historyBefore + 1);

      await page.waitForTimeout(500);
      expect(writes).toEqual([]);
    });
  }
}

for (const pagePath of GUARDED_PAGES) {
  test(`學生登入：${pagePath} 正常顯示、不跳轉、沒有 JS 例外`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await loginAs(page, STUDENT);

    await page.goto(pagePath);
    await page.waitForTimeout(1500);

    expect(new URL(page.url()).pathname).toBe(`/${pagePath}`);
    expect(await page.evaluate(() => document.documentElement.style.visibility)).not.toBe("hidden");
    expect(errors).toEqual([]);
  });
}

test("學生雙人登入：Select 不會被擋", async ({ page }) => {
  await loginAs(page, {
    ...STUDENT,
    game_mode: "double",
    student2_token: "student2-token",
    student2_key: "G8_S88",
    student2_case: "S88",
    student2_grade: "G8",
    student2_school: "TEST",
    student2_day: "1",
  });
  await page.goto("Select/index.html");
  await page.waitForTimeout(1000);
  expect(new URL(page.url()).pathname).toBe("/Select/index.html");
});

for (const tokenKey of ["token", "student1_token"]) {
  test(`DCCS：學生只有 ${tokenKey} 也能進入`, async ({ page }) => {
    const session = { ...STUDENT };
    delete session[tokenKey === "token" ? "student1_token" : "token"];
    await loginAs(page, session);
    await page.goto(DCCS_PAGE);
    await expect(page.locator("#game-root canvas")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/${DCCS_PAGE}`);
  });
}

test("DCCS：學生有 role 與 token 但缺少學生欄位，仍導回 Home 且不送成績", async ({ page }) => {
  const writes = await recordWrites(page);
  await loginAs(page, { user_role: "student", token: "student-token" });
  await page.goto(DCCS_PAGE);
  await expect(page).toHaveURL(HOME_URL);
  expect(writes).toEqual([]);
});

test("DCCS：學生雙人登入仍轉到雙人遊戲頁", async ({ page }) => {
  await recordWrites(page);
  await loginAs(page, {
    ...STUDENT,
    game_mode: "double",
    student2_token: "student2-token",
    student2_key: "G8_S88",
    student2_case: "S88",
    student2_grade: "G8",
    student2_school: "TEST",
    student2_day: "1",
  });
  await page.goto(DCCS_PAGE);
  await expect(page).toHaveURL(/\/DCCS\/double\.html$/);
});
