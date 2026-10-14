// shared/leave-confirm.js：按「離開」先在頁面內確認，確定後才存檔並離開（第 41 項）。
// 取消時什麼都不送、遊戲照常繼續；確定後導頁不再跳出瀏覽器的離開詢問。
import { test, expect } from "@playwright/test";
import { DOUBLE, STUDENT, loginAs } from "./helpers.mjs";

const PAGES = [
  ["TGame_single/index.html", STUDENT],
  ["EFT_single/EFT_single.html", STUDENT],
  ["IM_single/index.html", STUDENT],
  ["TGame_double/index.html", DOUBLE],
  ["EFT_double/EFT_double.html", DOUBLE],
  ["DAT_single/DAT_single.html?mode=game", STUDENT],
  ["DAT_double/DAT_double.html?mode=game", DOUBLE],
  ["DCCS_single/index.html", STUDENT],
  ["DCCS_double/index.html", DOUBLE],
];
// DAT、DCCS 另有自己的 beforeunload（遊戲中關分頁會問），導頁測試只用沒有自己攔截的頁面。
const NO_OWN_GUARD = new Set(PAGES.slice(0, 5).map(([path]) => path));

const dialog = (page) => page.getByRole("dialog", { name: "確定要離開嗎？" });

async function openGame(page, pagePath, session) {
  const nativeDialogs = [];
  page.on("dialog", (native) => {
    nativeDialogs.push(native.type());
    void native.dismiss();
  });
  await loginAs(page, session);
  await page.goto(pagePath);
  await page.waitForFunction(() => typeof window.confirmLeave === "function" && !!window.WebGameRuntime);
  await page.mouse.click(2, 2);
  return nativeDialogs;
}

for (const [pagePath, session] of PAGES) {
  test(`${pagePath}：確認框開著時遊戲暫停，取消後回到遊戲`, async ({ page }) => {
    await openGame(page, pagePath, session);
    await page.evaluate(() => { window.__leaveAnswer = window.confirmLeave(); });
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "繼續遊戲" })).toBeFocused();
    expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(true);

    await dialog(page).getByRole("button", { name: "繼續遊戲" }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__leaveAnswer)).toBe(false);
    expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(false);
    expect(new URL(page.url()).pathname).toBe(`/${pagePath.split("?")[0]}`);
  });
}

test("確定離開後維持暫停，存檔期間遊戲不會打完下一關；原生計時器照常運作", async ({ page }) => {
  await openGame(page, "EFT_single/EFT_single.html", STUDENT);
  await page.evaluate(() => { window.__leaveAnswer = window.confirmLeave(); });
  await dialog(page).getByRole("button", { name: "離開" }).click();
  expect(await page.evaluate(() => window.__leaveAnswer)).toBe(true);
  await expect(dialog(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(true);
  // 存檔的逾時要用原生計時器，暫停時仍會觸發。
  const fired = await page.evaluate(() => new Promise((resolve) => {
    window.WebGameRuntime.nativeSetTimeout(() => resolve(true), 50);
    window.WebGameRuntime.nativeSetTimeout(() => resolve(false), 1000);
  }));
  expect(fired).toBe(true);
});

test("確定離開後流程中途放棄（例如存檔失敗留在頁面），cancelLeave 讓遊戲繼續", async ({ page }) => {
  await openGame(page, "EFT_single/EFT_single.html", STUDENT);
  await page.evaluate(() => { window.__leaveAnswer = window.confirmLeave(); });
  await dialog(page).getByRole("button", { name: "離開" }).click();
  await page.evaluate(() => window.cancelLeave());
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(false);
});

test("確定離開後按上一頁回來（bfcache），遊戲不會一直停住", async ({ page }) => {
  await openGame(page, "EFT_single/EFT_single.html", STUDENT);
  await page.evaluate(() => { window.__leaveAnswer = window.confirmLeave(); });
  await dialog(page).getByRole("button", { name: "離開" }).click();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await page.evaluate(() => { window.WebGameRuntime.pause(); window.WebGameRuntime.resume(); });
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(false);
});

test("確認框開著時按鍵不傳給遊戲；Esc 等於取消；Tab 只在兩個按鈕間循環", async ({ page }) => {
  await openGame(page, "IM_single/index.html", STUDENT);
  await page.evaluate(() => {
    window.__gameKeys = [];
    document.addEventListener("keydown", (event) => window.__gameKeys.push(event.key));
    window.__leaveAnswer = window.confirmLeave();
  });
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Tab");
  await expect(dialog(page).getByRole("button", { name: "離開" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog(page).getByRole("button", { name: "繼續遊戲" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog(page).getByRole("button", { name: "離開" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__leaveAnswer)).toBe(false);
  expect(await page.evaluate(() => window.__gameKeys)).toEqual([]);
});

test("遊戲原本就暫停（例如視窗太小）時，取消後維持暫停", async ({ page }) => {
  await openGame(page, "TGame_single/index.html", STUDENT);
  await page.evaluate(() => {
    window.WebGameRuntime.pause();
    window.__leaveAnswer = window.confirmLeave();
  });
  await dialog(page).getByRole("button", { name: "繼續遊戲" }).click();
  expect(await page.evaluate(() => window.__leaveAnswer)).toBe(false);
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(true);
});

test("重複呼叫只開一個確認框，兩次都拿到同一個答案", async ({ page }) => {
  await openGame(page, "EFT_single/EFT_single.html", STUDENT);
  await page.evaluate(() => { window.__answers = Promise.all([window.confirmLeave(), window.confirmLeave()]); });
  await expect(dialog(page)).toHaveCount(1);
  await dialog(page).getByRole("button", { name: "繼續遊戲" }).click();
  expect(await page.evaluate(() => window.__answers)).toEqual([false, false]);
});

for (const [pagePath, session] of PAGES.filter(([path]) => NO_OWN_GUARD.has(path))) {
  test(`${pagePath}：leaveTo 直接回大廳，不跳出瀏覽器的離開詢問`, async ({ page }) => {
    const nativeDialogs = await openGame(page, pagePath, session);
    await Promise.all([
      page.waitForURL("**/Select/index.html", { timeout: 5000 }),
      page.evaluate(() => window.leaveTo("../Select/index.html")),
    ]);
    expect(nativeDialogs).toEqual([]);
  });
}

test("取消後焦點不留在「離開」按鈕上，之後按 Enter／空白鍵不會又打開確認框", async ({ page }) => {
  await openGame(page, "EFT_single/EFT_single.html", STUDENT);
  // 用測試自己的按鈕，只驗證共用確認框，不受各遊戲離開流程影響。
  await page.evaluate(() => {
    window.__opened = 0;
    const leave = document.createElement("button");
    leave.id = "test-leave";
    leave.textContent = "離開";
    leave.addEventListener("click", () => { window.__opened += 1; window.__leaveAnswer = window.confirmLeave(); });
    document.body.appendChild(leave);
    leave.focus();
    leave.click();
  });
  await dialog(page).getByRole("button", { name: "繼續遊戲" }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("test-leave");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect(dialog(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__opened)).toBe(1);
});

test("確認框開著時，別處（例如登入驗證完成）恢復時鐘也不會讓遊戲繼續跑", async ({ page }) => {
  await openGame(page, "EFT_single/EFT_single.html", STUDENT);
  await page.evaluate(() => { window.__leaveAnswer = window.confirmLeave(); });
  await expect(dialog(page)).toBeVisible();
  // require-student 在載入完成或從上一頁快取回來驗證完時會呼叫這一對。
  await page.evaluate(() => { window.WebGameRuntime.pause(); window.WebGameRuntime.resume(); });
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(true);
  await dialog(page).getByRole("button", { name: "繼續遊戲" }).click();
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(false);
});
