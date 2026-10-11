// 老師後台：切換學生時的成績回應順序、載入中選天、讀取失敗，以及 UTC 時間顯示。
import { test, expect } from "@playwright/test";
import { TEACHER, loginAs } from "./helpers.mjs";

const TEACHER_PAGE = "Teacher_platform/index.html";

const STUDENTS = [
  { studentKey: "G9_A01", caseId: "A01", school: "TEST", sessionCount: 1, lastPlayedAt: "2026-07-01 03:40:00" },
  { studentKey: "G9_B02", caseId: "B02", school: "TEST", sessionCount: 1, lastPlayedAt: "2026-07-02 03:40:00" },
];

// A 第 1 天只玩賽道攔截（DCCS），B 第 1 天只玩漂浮泡泡（EFT），兩人一眼就分得出來。
const RECORDS = {
  G9_A01: [
    { gameType: "DCCS", mode: "single", currentDay: 1, startTime: "2026-07-01 03:40:00", stats: { stage: 6, accuracy: 0.9 } },
  ],
  G9_B02: [
    { gameType: "EFT", mode: "single", currentDay: 1, startTime: "2026-07-02 03:40:00", stats: { stage: 6, accuracy: 0.8 } },
  ],
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * 攔截名單與成績。handlers[studentKey] 可回傳 "abort" 讓請求斷線，
 * 或在 await 期間卡住以模擬慢回應；沒指定就立刻回 RECORDS。
 */
async function openTeacher(page, { handlers = {}, students = STUDENTS, records = RECORDS } = {}) {
  await page.route("**/api/me/students", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ students }) })
  );
  await page.route("**/api/students/*/report*", async (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3]);
    const result = handlers[key] ? await handlers[key]() : null;
    if (result === "abort") return route.abort("failed");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ records: records[key] || [] }),
    });
  });
  await loginAs(page, TEACHER);
  await page.goto(TEACHER_PAGE);
  await expect(page.locator("#student-select option")).toHaveCount(students.length + 1);
}

const dayButton = (page, day) => page.locator(`#day-row [data-day="${day}"]`);
const card = (page, name) => page.locator(".game-card", { hasText: name });

test("先選 A 再選 B，A 的成績較晚回來也不會蓋掉 B", async ({ page }) => {
  const gateA = deferred();
  const requestedA = deferred();
  await openTeacher(page, {
    handlers: { G9_A01: async () => { requestedA.resolve(); await gateA.promise; } },
  });

  await page.selectOption("#student-select", "G9_A01");
  await requestedA.promise;
  const reportB = page.waitForResponse("**/api/students/G9_B02/report*");
  await page.selectOption("#student-select", "G9_B02");
  await reportB;

  // B 已經回來，這時才放行 A 的舊回應。
  const reportA = page.waitForResponse("**/api/students/G9_A01/report*");
  gateA.resolve();
  await reportA;
  await page.waitForTimeout(200);

  await dayButton(page, 1).click();
  await expect(page.locator("#view-student-key")).toHaveText("受試個案：G9_B02");
  await expect(page.locator("#records-tbody")).toContainText("漂浮泡泡");
  await expect(page.locator("#records-tbody")).not.toContainText("賽道攔截");
  await expect(card(page, "漂浮泡泡").locator(".card-percent")).toHaveText("100%");
  await expect(card(page, "賽道攔截").locator(".card-percent")).toHaveText("0%");
});

test("換學生、成績還在載入時，天數不能選，也不會拿上一位學生的成績畫卡片", async ({ page }) => {
  const gateB = deferred();
  const requestedB = deferred();
  await openTeacher(page, {
    handlers: { G9_B02: async () => { requestedB.resolve(); await gateB.promise; } },
  });

  await page.selectOption("#student-select", "G9_A01");
  await dayButton(page, 1).click();
  await expect(card(page, "賽道攔截").locator(".card-percent")).toHaveText("100%");

  await page.selectOption("#student-select", "G9_B02");
  await requestedB.promise;
  // 載入中：天數按鈕停用、上一位學生的當天明細收起來。
  await expect(dayButton(page, 1)).toBeDisabled();
  await expect(page.locator("#day-detail")).toBeHidden();
  // 就算有點擊事件漏進來（例如舊按鈕），也不能用 A 的場次選天。
  await dayButton(page, 1).dispatchEvent("click");

  const reportB = page.waitForResponse("**/api/students/G9_B02/report*");
  gateB.resolve();
  await reportB;
  await expect(dayButton(page, 1)).toBeEnabled();
  await expect(page.locator("#day-detail")).toBeHidden();

  await dayButton(page, 1).click();
  await expect(card(page, "賽道攔截").locator(".card-percent")).toHaveText("0%");
  await expect(card(page, "漂浮泡泡").locator(".card-percent")).toHaveText("100%");
  await expect(page.locator("#records-tbody")).toContainText("漂浮泡泡");
  await expect(page.locator("#records-tbody")).not.toContainText("賽道攔截");
});

test("成績讀取失敗時顯示錯誤，不會把上一位學生的場次算到新學生", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await openTeacher(page, { handlers: { G9_B02: async () => "abort" } });

  await page.selectOption("#student-select", "G9_A01");
  await dayButton(page, 1).click();
  await expect(page.locator("#records-tbody")).toContainText("賽道攔截");

  const reportB = page.waitForEvent("requestfailed", (request) => request.url().includes("/G9_B02/report"));
  await page.selectOption("#student-select", "G9_B02");
  await reportB;

  await expect(page.locator("#view-student-key")).toHaveText("受試個案：G9_B02");
  await expect(page.locator("#day-prompt")).toBeVisible();
  await expect(page.locator("#day-prompt")).toContainText("讀取失敗");
  await expect(dayButton(page, 1)).toBeDisabled();
  await dayButton(page, 1).dispatchEvent("click");
  await expect(page.locator("#day-detail")).toBeHidden();
  await expect(page.locator("#records-tbody")).not.toContainText("賽道攔截");
  expect(errors).toEqual([]);
});

test("成績回應非 2xx 也顯示讀取失敗，而不是「這天尚無施測紀錄」", async ({ page }) => {
  await openTeacher(page);
  // 後註冊的 route 優先，蓋過 openTeacher 的成績攔截。
  await page.route("**/api/students/G9_B02/report*", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
  );
  await page.selectOption("#student-select", "G9_B02");
  await expect(page.locator("#day-prompt")).toContainText("讀取失敗");
  await expect(dayButton(page, 1)).toBeDisabled();
});

test.describe("台北時區", () => {
  test.use({ timezoneId: "Asia/Taipei" });

  test("後端的 UTC 時間換成本地時間顯示，排序仍照實際先後", async ({ page }) => {
    const records = {
      G9_A01: [
        // UTC 隔天 00:10 = 台北 08:10，比 UTC 前一天 23:30（台北 07:30）晚。
        { gameType: "EFT", mode: "single", currentDay: 1, startTime: "2026-07-02 00:10:00", stats: { stage: 6 } },
        { gameType: "DCCS", mode: "single", currentDay: 1, startTime: "2026-07-01 03:40:00", stats: { stage: 6 } },
        { gameType: "DAT", mode: "single", currentDay: 1, startTime: "2026-07-01 23:30:00", stats: { stage: 6 } },
      ],
    };
    await openTeacher(page, { records });
    await page.selectOption("#student-select", "G9_A01");
    await expect(page.locator("#view-last-played")).toHaveText("2026-07-01 11:40:00");

    await dayButton(page, 1).click();
    const rows = page.locator("#records-tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator("td").last()).toHaveText("2026-07-01 11:40:00");
    await expect(rows.nth(1).locator("td").last()).toHaveText("2026-07-02 07:30:00");
    await expect(rows.nth(2).locator("td").last()).toHaveText("2026-07-02 08:10:00");
  });
});
