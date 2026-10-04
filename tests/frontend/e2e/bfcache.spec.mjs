// 登出後按上一頁：Chrome 會從 bfcache 原樣還原頁面、不重跑 script。
import { test, expect } from "@playwright/test";
import { HOME_URL, STUDENT, loginAs } from "./helpers.mjs";

// Playwright 預設帶 --disable-back-forward-cache，舊版 headless 也不支援 bfcache。
test.use({
  channel: "chromium",
  launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] },
});

/** 記錄每次 pageshow，用來確認頁面真的是從 bfcache 還原。 */
async function trackPageshow(page) {
  const shows = [];
  await page.addInitScript(() => {
    addEventListener("pageshow", (event) => {
      console.log(`pageshow ${location.pathname} ${event.persisted}`);
    });
  });
  page.on("console", (message) => {
    const match = /^pageshow (\S+) (true|false)$/.exec(message.text());
    if (match) shows.push({ path: match[1], persisted: match[2] === "true" });
  });
  return shows;
}

test("學生在 Select 登出後按上一頁，不會停在還原的 Select", async ({ page }) => {
  const shows = await trackPageshow(page);
  await loginAs(page, STUDENT);
  await page.goto("Select/index.html");
  await page.waitForTimeout(800);

  await page.click("#logout-btn");
  await expect(page).toHaveURL(HOME_URL);
  await page.waitForTimeout(500);

  await page.goBack({ waitUntil: "commit" });
  await page.waitForTimeout(1000);

  // 前提：Select 確實是從 bfcache 還原，否則這個測試沒有意義。
  expect(shows).toContainEqual({ path: "/Select/index.html", persisted: true });
  await expect(page).toHaveURL(HOME_URL);
});

test("學生仍登入時從教學頁按上一頁，留在還原的 Select", async ({ page }) => {
  const shows = await trackPageshow(page);
  await loginAs(page, STUDENT);
  await page.goto("Select/index.html");
  await page.locator("#game-list [data-select-game]").first().click();
  await page.click("#enter-btn");
  await expect(page).toHaveURL(/\/tutorial\//);
  await page.waitForTimeout(500);

  await page.goBack({ waitUntil: "commit" });
  await page.waitForTimeout(1000);

  expect(shows).toContainEqual({ path: "/Select/index.html", persisted: true });
  await expect(page).toHaveURL(/\/Select\/index\.html$/);
});
