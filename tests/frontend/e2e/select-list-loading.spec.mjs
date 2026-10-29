// Select 頁離開/進入時，清單不該整塊空白：先用骨架畫出清單，進度資料回來再補上。
import { test, expect } from "@playwright/test";
import { STUDENT, DOUBLE, loginAs } from "./helpers.mjs";

test("單人：進度資料回得慢，清單骨架仍立即出現", async ({ page }) => {
  await loginAs(page, STUDENT);
  await page.route("**/api/students/*/report*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"records":[]}' });
  });

  await page.goto("Select/index.html");

  await expect(page.locator("#game-list [data-select-game]")).toHaveCount(5, { timeout: 500 });
});

test("雙人：一位玩家進度回得慢，不會拖累另一位玩家的清單一起空白", async ({ page }) => {
  await loginAs(page, DOUBLE);
  await page.route("**/api/students/G9_S99/report*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"records":[]}' })
  );
  await page.route("**/api/students/G8_S88/report*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"records":[]}' });
  });

  await page.goto("Select/index.html");

  await expect(page.locator('[data-game-list="1"] [data-select-game]')).toHaveCount(4, { timeout: 500 });
  await expect(page.locator('[data-game-list="2"] [data-select-game]')).toHaveCount(4, { timeout: 500 });
});
