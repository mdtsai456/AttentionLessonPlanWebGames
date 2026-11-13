// 同帳號雙分頁玩同一款遊戲的鎖定：見 backend/docs/adr/0006-game-lock.md。
import { test, expect } from "@playwright/test";
import { STUDENT, DOUBLE, loginAs } from "./helpers.mjs";

/** 攔截 /api/game-lock/*，記錄每次呼叫並回傳指定的狀態碼。 */
async function stubGameLock(page, { acquireStatus = 200, heartbeatStatus = 204 } = {}) {
  const calls = [];
  await page.route("**/api/game-lock/acquire", (route) => {
    calls.push({ path: "acquire", body: route.request().postDataJSON(), headers: route.request().headers() });
    if (acquireStatus === 409) {
      return route.fulfill({ status: 409, contentType: "application/json", body: '{"detail":"此遊戲已在另一個分頁進行中"}' });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"lockId":"lock-abc"}' });
  });
  await page.route("**/api/game-lock/heartbeat", (route) => {
    calls.push({ path: "heartbeat", body: route.request().postDataJSON() });
    if (heartbeatStatus === 409) {
      return route.fulfill({ status: 409, contentType: "application/json", body: '{"detail":"已在另一個分頁繼續這款遊戲"}' });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/game-lock/release", (route) => {
    calls.push({ path: "release", body: route.request().postDataJSON() });
    return route.fulfill({ status: 204, body: "" });
  });
  return calls;
}

test("進入遊戲會呼叫 acquire，帶正確的 gameId", async ({ page }) => {
  const calls = await stubGameLock(page);
  await loginAs(page, STUDENT);

  await page.goto("IM_single/index.html");
  await page.waitForFunction(() => typeof state !== "undefined" && state.task);

  expect(calls.filter((c) => c.path === "acquire")).toHaveLength(1);
  expect(calls[0].body).toEqual({ gameId: "IM" });
  expect(calls[0].headers.authorization).toMatch(/^Bearer student-token\./);
});

test("acquire 回 409 時顯示提示並暫停遊戲，不能繼續作答", async ({ page }) => {
  await stubGameLock(page, { acquireStatus: 409 });
  await loginAs(page, STUDENT);

  await page.goto("IM_single/index.html");

  await expect(page.locator("#webgame-lock-blocked")).toBeVisible();
  await expect(page.locator("#webgame-lock-blocked p")).toHaveText("此遊戲已在另一個分頁進行中，請先關閉該分頁再繼續。");
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(true);
});

test("心跳逾時被換掉後，下一次心跳回 409 會顯示提示並暫停", async ({ page }) => {
  await page.clock.install();
  await stubGameLock(page, { heartbeatStatus: 409 });
  await loginAs(page, STUDENT);

  await page.goto("IM_single/index.html");
  await page.waitForFunction(() => typeof state !== "undefined" && state.task);
  await page.clock.runFor(10001);

  await expect(page.locator("#webgame-lock-blocked")).toBeVisible();
  await expect(page.locator("#webgame-lock-blocked p")).toHaveText("已在另一個分頁繼續這款遊戲。");
});

test("確定離開時會送 release，帶正確的 gameId 與 lockId", async ({ page }) => {
  const calls = await stubGameLock(page);
  await loginAs(page, STUDENT);
  await page.goto("IM_single/index.html");
  await page.waitForFunction(() => typeof state !== "undefined" && state.task);
  await expect.poll(() => calls.some((c) => c.path === "acquire")).toBe(true);

  await page.evaluate(() => window.leaveTo("../Select/index.html"));

  await expect.poll(() => calls.find((c) => c.path === "release")).toEqual({
    path: "release",
    body: { gameId: "IM", lockId: "lock-abc" },
  });
});

test("雙人模式：兩位玩家各自用自己的 token 取鎖", async ({ page }) => {
  const calls = await stubGameLock(page);
  await loginAs(page, DOUBLE);

  await page.goto("TGame_double/index.html");
  await page.waitForFunction(() => typeof session !== "undefined" && session.startedAt !== 0);

  const acquireCalls = calls.filter((c) => c.path === "acquire");
  expect(acquireCalls).toHaveLength(2);
  const tokens = acquireCalls.map((c) => c.headers.authorization).sort();
  expect(tokens[0]).toMatch(/^Bearer student-token\./);
  expect(tokens[1]).toMatch(/^Bearer student2-token\./);
  acquireCalls.forEach((c) => expect(c.body).toEqual({ gameId: "TGame" }));
});
