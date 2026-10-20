// 老師後台：切換學生時的成績回應順序、載入中選天、讀取失敗、UTC 時間顯示，以及分兩次玩完的合併顯示。
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
  await expect(page.locator("#report-retry")).toBeHidden();

  const reportB = page.waitForEvent("requestfailed", (request) => request.url().includes("/G9_B02/report"));
  await page.selectOption("#student-select", "G9_B02");
  await reportB;

  await expect(page.locator("#view-student-key")).toHaveText("受試個案：G9_B02");
  await expect(page.locator("#day-prompt")).toBeVisible();
  await expect(page.locator("#day-prompt")).toContainText("讀取失敗");
  await expect(page.locator("#report-retry")).toBeVisible();
  const retry = page.waitForEvent("requestfailed", (request) => request.url().includes("/G9_B02/report"));
  await page.locator("#report-retry").click();
  await retry;
  await expect(page.locator("#report-retry")).toBeVisible();
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
  await expect(page.locator("#report-retry")).toBeVisible();
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

test.describe("裝置時區不是台灣（例如美東）", () => {
  test.use({ timezoneId: "America/New_York" });

  test("一律顯示台灣時間（UTC+8），不跟著裝置時區", async ({ page }) => {
    const records = {
      G9_A01: [
        { gameType: "DCCS", mode: "single", currentDay: 1, startTime: "2026-07-01 03:40:00", stats: { stage: 6 } },
      ],
    };
    await openTeacher(page, { records });
    await page.selectOption("#student-select", "G9_A01");
    await expect(page.locator("#view-last-played")).toHaveText("2026-07-01 11:40:00");
    await dayButton(page, 1).click();
    await expect(page.locator("#records-tbody tr").first().locator("td").last()).toHaveText("2026-07-01 11:40:00");
  });
});

// ---- 同一天分兩次玩完：stage 3（第 1～3 關）＋只含第 4～6 關的 stage 6，卡片合併兩列 ----

const play = (gameType, startTime, stats, mode = "single") =>
  ({ gameType, mode, currentDay: 1, startTime, stats });
const levelTexts = (page, name) => card(page, name).locator(".level-list strong");
const metric = (page, name, label) =>
  card(page, name).locator(".metric-list > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");

async function openDay(page, rows) {
  await openTeacher(page, { records: { G9_A01: rows } });
  await page.selectOption("#student-select", "G9_A01");
  await dayButton(page, 1).click();
}

test("前半 stage 3 加後半 stage 6（3 個值）：卡片合併成第 1～6 關，合計數字正確", async ({ page }) => {
  await openDay(page, [
    play("EFT", "2026-07-01 03:00:00", {
      stage: 3, levelAccuracy: [0.9, 0.8, 0.7], correctCount: 9, wrongCount: 1, questionCount: 10,
      accuracy: 0.9, duration: 180000, avgReactionMs: 400,
    }),
    play("EFT", "2026-07-01 05:00:00", {
      stage: 6, levelAccuracy: [0.6, 0.5, 0.4], correctCount: 15, wrongCount: 15, questionCount: 30,
      accuracy: 0.5, duration: 170000, avgReactionMs: 800,
    }),
    // 瓢蟲追擊令：準心對準時長比依兩列時長加權，專心時間相加。
    play("DAT", "2026-07-01 03:10:00", {
      stage: 3, levelAccuracy: [1, 1, 1], correctCount: 10, wrongCount: 0, questionCount: 10,
      accuracy: 1, duration: 100000, avgReactionMs: 500, aimRatio: 0.5, focusMs: 50000,
    }),
    play("DAT", "2026-07-01 05:10:00", {
      stage: 6, levelAccuracy: [0.5, 0.5, 0.5], correctCount: 5, wrongCount: 5, questionCount: 10,
      accuracy: 0.5, duration: 300000, avgReactionMs: 500, aimRatio: 0.9, focusMs: 270000,
    }),
    // 指令出擊沒有 questionCount：題數改用答對加答錯。
    play("IM", "2026-07-01 03:20:00", {
      stage: 3, levelAccuracy: [1, 0.9, 0.8], correctCount: 9, wrongCount: 1,
      accuracy: 0.9, duration: 60000, avgReactionMs: 400,
    }),
    play("IM", "2026-07-01 05:20:00", {
      stage: 6, levelAccuracy: [0.7, 0.6, 0.5], correctCount: 15, wrongCount: 15,
      accuracy: 0.5, duration: 90000, avgReactionMs: 800,
    }),
  ]);

  await expect(card(page, "漂浮泡泡").locator(".card-percent")).toHaveText("100%");
  await expect(levelTexts(page, "漂浮泡泡")).toHaveText(["90%", "80%", "70%", "60%", "50%", "40%"]);
  await expect(metric(page, "漂浮泡泡", "遊玩時間")).toHaveText("350.0 秒");
  await expect(metric(page, "漂浮泡泡", "正確率")).toHaveText("60%"); // 24 ÷ 40
  await expect(metric(page, "漂浮泡泡", "錯誤率")).toHaveText("40%");
  await expect(metric(page, "漂浮泡泡", "總題數")).toHaveText("40");
  await expect(metric(page, "漂浮泡泡", "平均反應時間")).toHaveText("0.7 秒"); // (400×10 + 800×30) ÷ 40
  await expect(card(page, "漂浮泡泡").locator(".level-note")).toHaveCount(0);

  await expect(levelTexts(page, "瓢蟲追擊令")).toHaveText(["100%", "100%", "100%", "50%", "50%", "50%"]);
  await expect(metric(page, "瓢蟲追擊令", "正確率")).toHaveText("75%");
  await expect(metric(page, "瓢蟲追擊令", "準心對準時長比")).toHaveText("80%"); // (0.5×100 + 0.9×300) ÷ 400
  await expect(metric(page, "瓢蟲追擊令", "專心時間")).toHaveText("320.0 秒");

  await expect(levelTexts(page, "指令出擊")).toHaveText(["100%", "90%", "80%", "70%", "60%", "50%"]);
  await expect(metric(page, "指令出擊", "正確率")).toHaveText("60%");
  await expect(metric(page, "指令出擊", "平均反應時間")).toHaveText("0.7 秒");
  await expect(metric(page, "指令出擊", "遊玩時間")).toHaveText("150.0 秒");

  // 明細表照舊一列一場，後半那一列標出只含第 4～6 關。
  const rows = page.locator("#records-tbody tr");
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(0).locator("td").nth(5)).toHaveText("3");
  await expect(rows.nth(3).locator("td").nth(5)).toHaveText("6（第 4～6 關）");
});

test("一列完整 6 關的 stage 6：照舊顯示，不標成後半", async ({ page }) => {
  await openDay(page, [
    play("EFT", "2026-07-01 03:00:00", {
      stage: 6, levelAccuracy: [0.9, 0.8, 0.7, 0.6, 0.5, 0.4], correctCount: 30, wrongCount: 10, questionCount: 40,
      accuracy: 0.75, duration: 360000, avgReactionMs: 600,
    }),
  ]);
  await expect(card(page, "漂浮泡泡").locator(".card-percent")).toHaveText("100%");
  await expect(levelTexts(page, "漂浮泡泡")).toHaveText(["90%", "80%", "70%", "60%", "50%", "40%"]);
  await expect(metric(page, "漂浮泡泡", "正確率")).toHaveText("75%");
  await expect(metric(page, "漂浮泡泡", "遊玩時間")).toHaveText("360.0 秒");
  await expect(page.locator("#records-tbody tr").first().locator("td").nth(5)).toHaveText("6");
});

test("當天有完整 6 關的一列時，卡片顯示完整那一列，不合併前後半", async ({ page }) => {
  await openDay(page, [
    play("EFT", "2026-07-01 03:00:00", {
      stage: 3, levelAccuracy: [0.1, 0.1, 0.1], correctCount: 1, wrongCount: 9, questionCount: 10, accuracy: 0.1, duration: 1000,
    }),
    play("EFT", "2026-07-01 04:00:00", {
      stage: 6, levelAccuracy: [0.2, 0.2, 0.2], correctCount: 2, wrongCount: 8, questionCount: 10, accuracy: 0.2, duration: 2000,
    }),
    play("EFT", "2026-07-01 02:00:00", {
      stage: 6, levelAccuracy: [0.9, 0.8, 0.7, 0.6, 0.5, 0.4], correctCount: 30, wrongCount: 10, questionCount: 40,
      accuracy: 0.75, duration: 360000,
    }),
  ]);
  await expect(levelTexts(page, "漂浮泡泡")).toHaveText(["90%", "80%", "70%", "60%", "50%", "40%"]);
  await expect(metric(page, "漂浮泡泡", "正確率")).toHaveText("75%");
  await expect(metric(page, "漂浮泡泡", "遊玩時間")).toHaveText("360.0 秒");
});

test("後半配不到前半（前半在後、或是別的模式）：後半那一列照舊當一般候選", async ({ page }) => {
  await openDay(page, [
    play("EFT", "2026-07-01 03:00:00", {
      stage: 3, levelAccuracy: [0.1, 0.1, 0.1], correctCount: 1, wrongCount: 9, questionCount: 10, accuracy: 0.1, duration: 1000,
    }, "double"),
    play("EFT", "2026-07-01 04:00:00", {
      stage: 6, levelAccuracy: [0.6, 0.5, 0.4], correctCount: 15, wrongCount: 15, questionCount: 30, accuracy: 0.5, duration: 170000,
    }),
    play("EFT", "2026-07-01 05:00:00", {
      stage: 3, levelAccuracy: [0.2, 0.2, 0.2], correctCount: 2, wrongCount: 8, questionCount: 10, accuracy: 0.2, duration: 2000,
    }),
  ]);
  await expect(levelTexts(page, "漂浮泡泡")).toHaveText(["60%", "50%", "40%", "尚無各關紀錄", "尚無各關紀錄", "尚無各關紀錄"]);
  await expect(metric(page, "漂浮泡泡", "正確率")).toHaveText("50%");
  await expect(metric(page, "漂浮泡泡", "總題數")).toHaveText("30");
  await expect(page.locator("#records-tbody tr").nth(1).locator("td").nth(5)).toHaveText("6（第 4～6 關）");
});

test("前半沒有各關正確率：第 1～3 關顯示「尚無各關紀錄」，不是 0%", async ({ page }) => {
  await openDay(page, [
    play("EFT", "2026-07-01 03:00:00", {
      stage: 3, correctCount: 9, wrongCount: 1, questionCount: 10, accuracy: 0.9, duration: 180000,
    }),
    play("EFT", "2026-07-01 05:00:00", {
      stage: 6, levelAccuracy: [0.6, 0.5, 0.4], correctCount: 15, wrongCount: 15, questionCount: 30, accuracy: 0.5, duration: 170000,
    }),
  ]);
  await expect(levelTexts(page, "漂浮泡泡")).toHaveText(["尚無各關紀錄", "尚無各關紀錄", "尚無各關紀錄", "60%", "50%", "40%"]);
  await expect(metric(page, "漂浮泡泡", "正確率")).toHaveText("60%");
});

test("前半玩了兩次、單人雙人各有一組：配最近的前半，取後半較晚的那一組", async ({ page }) => {
  await openDay(page, [
    // 單人：兩次前半，後半配較晚的那次（0.3）。
    play("EFT", "2026-07-01 01:00:00", {
      stage: 3, levelAccuracy: [0.1, 0.1, 0.1], correctCount: 1, wrongCount: 9, questionCount: 10, accuracy: 0.1, duration: 1000,
    }),
    play("EFT", "2026-07-01 02:00:00", {
      stage: 3, levelAccuracy: [0.3, 0.3, 0.3], correctCount: 3, wrongCount: 7, questionCount: 10, accuracy: 0.3, duration: 1000,
    }),
    play("EFT", "2026-07-01 06:00:00", {
      stage: 6, levelAccuracy: [0.4, 0.4, 0.4], correctCount: 4, wrongCount: 6, questionCount: 10, accuracy: 0.4, duration: 1000,
    }),
    // 雙人那一組的後半比較早，不採用。
    play("EFT", "2026-07-01 03:00:00", {
      stage: 3, levelAccuracy: [0.7, 0.7, 0.7], correctCount: 7, wrongCount: 3, questionCount: 10, accuracy: 0.7, duration: 1000,
    }, "double"),
    play("EFT", "2026-07-01 04:00:00", {
      stage: 6, levelAccuracy: [0.8, 0.8, 0.8], correctCount: 8, wrongCount: 2, questionCount: 10, accuracy: 0.8, duration: 1000,
    }, "double"),
  ]);
  await expect(levelTexts(page, "漂浮泡泡")).toHaveText(["30%", "30%", "30%", "40%", "40%", "40%"]);
  await expect(metric(page, "漂浮泡泡", "正確率")).toHaveText("35%");
  await expect(metric(page, "漂浮泡泡", "總題數")).toHaveText("20");
});
