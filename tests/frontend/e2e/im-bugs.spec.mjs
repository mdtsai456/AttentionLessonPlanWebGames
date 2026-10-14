// 指令出擊（IM_single）回歸測試：點門、側門自動走路、存檔次數、前往題計時、背包滿提示、長按空白鍵、中場存檔統計。
import { test, expect } from "@playwright/test";
import { STUDENT, loginAs, recordWrites } from "./helpers.mjs";

const GAME = "IM_single/index.html";

/** 開遊戲並等第 1 關題目卡出現；回傳記錄寫入請求的陣列。 */
async function openGame(page) {
  const writes = await recordWrites(page);
  await loginAs(page, STUDENT);
  await page.goto(GAME);
  await page.waitForFunction(() => typeof state !== "undefined" && state.task && state.rooms.length);
  await expect(page.locator("#problem-panel")).toBeVisible();
  return writes;
}

/** 按題目卡的「開始」進入本關。 */
async function beginStage(page) {
  await page.locator("#start-stage-btn").click();
  await page.waitForFunction(() => state.stageLive && !state.busy);
}

/**
 * 把起點房間 (0,0) 改成固定版面：只留指定的門、清空所有放置點，
 * 讓測試不受隨機地圖影響。
 */
async function fixStartRoom(page, { doors, items = {}, playerX = 50 }) {
  await page.evaluate(({ doors, items, playerX }) => {
    const room = state.rooms[0][0];
    room.hasLeft = false;
    room.hasRight = false;
    room.hasUp = false;
    room.hasDown = doors.includes("down");
    room.hasRight = doors.includes("right");
    if (room.hasDown) state.rooms[1][0].hasUp = true;
    if (room.hasRight) state.rooms[0][1].hasLeft = true;
    room.zones.forEach((zone) => {
      zone.item = items[zone.id] || null;
    });
    state.playerX = playerX;
    renderRoom();
  }, { doors, items, playerX });
}

/** 點元素正中央（用真的滑鼠座標，不讓 Playwright 自動避開被遮住的元素）。 */
async function clickCentre(page, selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

function sessionPosts(writes) {
  return writes.filter((item) => item.method === "POST" && /\/api\/sessions$/.test(item.url));
}

function stat(write, name) {
  return write.body.data.stats.find((item) => item.apiname === name)?.value;
}

test("#4 直接點門會走過去並進入下一個房間", async ({ page }) => {
  await openGame(page);
  await beginStage(page);
  await fixStartRoom(page, { doors: ["down"], playerX: 30 });

  await clickCentre(page, '#doors .door[data-dir="down"]');

  await page.waitForFunction(() => state.row === 1 && state.col === 0, null, { timeout: 5000 });
});

test("#12 點左右側門，自動走路會走到並進門（不會在邊界原地踏步）", async ({ page }) => {
  await openGame(page);
  await beginStage(page);
  await fixStartRoom(page, { doors: ["right"], playerX: 50 });

  await clickCentre(page, '#doors .door[data-dir="right"]');

  await page.waitForFunction(() => state.row === 0 && state.col === 1, null, { timeout: 6000 });
  expect(await page.evaluate(() => state.walkTarget)).toBeNull();
});

test("#27 按住空白鍵（自動重複）不會反覆撿起又放回", async ({ page }) => {
  await openGame(page);
  await beginStage(page);
  // 椅子不是第 1 關（拿蘋果）的目標，撿起來不會過關。
  await fixStartRoom(page, { doors: [], items: { ZoneA: "chair" }, playerX: 36 });

  await page.keyboard.down(" ");
  await page.keyboard.down(" "); // 第二次 down 會帶 event.repeat = true
  await page.keyboard.up(" ");

  expect(await page.evaluate(() => state.bag.map((item) => item.id))).toEqual(["chair"]);

  // 放開後再按一次，仍然可以正常放下。
  await page.keyboard.press(" ");
  expect(await page.evaluate(() => state.bag.length)).toBe(0);

  // 長按方向鍵（也是 repeat）仍要能移動。
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(() => state.playerX > 40);
  await page.keyboard.up("ArrowRight");
});

test("#26 「背包滿了」提示過一下就消失", async ({ page }) => {
  await openGame(page);
  await beginStage(page);
  await fixStartRoom(page, { doors: [], items: { ZoneA: "chair" }, playerX: 36 });
  await page.evaluate(() => {
    state.bag = ["hat", "boot", "key", "fish"].map((id) => ({ id, from: "Kitchen" }));
    renderBackpack();
  });

  await page.keyboard.press(" ");
  const feedback = page.locator("#feedback");
  await expect(feedback).toHaveText("背包滿了");
  await expect(feedback).toHaveClass(/is-show/);

  await expect(feedback).not.toHaveClass(/is-show/, { timeout: 3000 });
  expect(await page.evaluate(() => state.stageLive)).toBe(true);
});

test("#18 前往題最後一秒抵達目標房，等待期間倒數歸零仍算過關", async ({ page }) => {
  await openGame(page);
  // 換成一題前往浴室，重開一局。
  await page.evaluate(() => {
    state.questions = [
      { id: "G1", displayText: "請前往浴室", problemType: "GoTo", targetItems: [], targetRoom: "Bathroom", timeLimit: 60 },
    ];
    startGame();
  });
  await beginStage(page);
  await page.evaluate(() => {
    state.rooms[1][0].type = "Bathroom";
    // 一進到浴室就只剩 1 秒：下一次倒數一定落在 GoTo 的 1 秒等待裡。
    const original = renderRoom;
    renderRoom = function () {
      original();
      if (state.row === 1) state.remaining = 1;
    };
  });
  await fixStartRoom(page, { doors: ["down"], playerX: 50 });

  await page.keyboard.press(" ");

  await page.waitForFunction(() => state.stageResults.length === 1, null, { timeout: 5000 });
  const record = await page.evaluate(() => state.stageResults[0]);
  expect(record.passed).toBe(true);
  // 用時算到抵達為止，不含之後的 1 秒展示。
  expect(record.timeUsage).toBeLessThan(1.2);
  expect(await page.evaluate(() => state.score)).toBe(1);
});

// 按「離開」先在頁面內確認（第 41 項）：取消什麼都不送，確定才存檔並回大廳。
const leaveDialog = (page) => page.getByRole("dialog", { name: "確定要離開嗎？" });

/** 記下瀏覽器原生的對話框；確定離開時不可再跳出「離開網站？」。 */
function watchNativeDialogs(page) {
  const seen = [];
  page.on("dialog", (dialog) => {
    seen.push(dialog.type());
    dialog.dismiss().catch(() => {});
  });
  return seen;
}

/** 頁面一發出就記下（不等回應），用來確認存檔還在路上時沒有多送。 */
function watchSessionPosts(page) {
  const posts = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/sessions$/.test(request.url())) posts.push(request.postDataJSON());
  });
  return posts;
}

test("#13 第 6 關結束的 0.7 秒內按離開：取消不送、等結算送一筆；再玩一次後確定離開也只送一筆", async ({ page }) => {
  const writes = await openGame(page);
  const nativeDialogs = watchNativeDialogs(page);
  const issued = watchSessionPosts(page);
  const stageOf = (body) => body.data.stats.find((item) => item.apiname === "IM_stage")?.value;

  // 第 1 局：等待空檔按離開→繼續遊戲。確認框開著時遊戲暫停，不會先結算；取消後結算送第 6 關一筆。
  await page.evaluate(() => startStage(6));
  await beginStage(page);
  await page.evaluate(() => passStage());
  await page.locator("#leave-btn").click();
  await expect(leaveDialog(page)).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator("#result")).toBeHidden();
  expect(issued).toHaveLength(0);
  await leaveDialog(page).getByRole("button", { name: "繼續遊戲", exact: true }).click();
  await expect(page.locator("#result")).toBeVisible();
  await expect.poll(() => sessionPosts(writes).length).toBe(1);
  await expect(page.locator("#leave-btn")).toBeEnabled();

  // 第 2 局（再玩一次要重算存過哪關）：等待空檔按離開→確定。
  // 存檔回應拖 1.5 秒；確定後遊戲維持暫停到導頁，存檔期間不會結算、也不會再送第 6 關。
  await page.locator("#replay-btn").click();
  await expect(page.locator("#problem-panel")).toBeVisible();
  await page.route("**/api/sessions", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fallback();
  });
  await page.evaluate(() => startStage(6));
  await beginStage(page);
  await page.evaluate(() => passStage());
  await page.locator("#leave-btn").click();
  await leaveDialog(page).getByRole("button", { name: "離開", exact: true }).click();
  await page.waitForTimeout(1000);
  await expect(page.locator("#result")).toBeHidden();
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(true);
  expect(issued).toHaveLength(2);
  await page.waitForURL("**/Select/index.html");
  expect(issued).toHaveLength(2);
  expect(issued.map(stageOf)).toEqual([6, 6]);
  expect(nativeDialogs).toEqual([]);
});

test("#10 第 5 關按離開並確定，stage 3 存檔只算前 3 關的成績", async ({ page }) => {
  const writes = await openGame(page);
  const nativeDialogs = watchNativeDialogs(page);

  // 第 1 關過、第 2 關逾時、第 3、4 關過。
  const outcomes = { 1: "pass", 2: "timeout", 3: "pass", 4: "pass" };
  for (let stage = 1; stage <= 4; stage++) {
    await expect(page.locator("#problem-title")).toHaveText(`第 ${stage} 關`);
    await beginStage(page);
    await page.evaluate((kind) => (kind === "pass" ? passStage() : timeOut()), outcomes[stage]);
    if (stage === 3) {
      await page.locator("#continue-btn").click();
    } else {
      await page.locator(".shared-stage-clear-btn").click();
    }
  }
  await expect(page.locator("#problem-title")).toHaveText("第 5 關");
  await beginStage(page);

  // 導頁後讀不到遊戲狀態，先算好預期值。
  const expectedAvg = await page.evaluate(
    () => (state.stageResults.slice(0, 3).reduce((sum, item) => sum + item.timeUsage, 0) / 3) * 1000
  );
  const expectedDuration = await page.evaluate(() => state.stageResults[2].elapsedMs);

  await page.locator("#leave-btn").click();
  await leaveDialog(page).getByRole("button", { name: "離開", exact: true }).click();
  await page.waitForURL("**/Select/index.html");
  expect(nativeDialogs).toEqual([]);
  expect(sessionPosts(writes)).toHaveLength(1);
  const save = sessionPosts(writes)[0];
  expect(stat(save, "IM_stage")).toBe(3);
  expect(stat(save, "IM_levelAccuracy")).toBe("1,0,1");
  expect(stat(save, "IM_correct")).toBe(2);
  expect(stat(save, "IM_wrong")).toBe(1);
  expect(stat(save, "IM_accuracy")).toBe(0.67);
  expect(stat(save, "IM_avgReactionMs")).toBeCloseTo(expectedAvg, 3);
  // 時長也停在第 3 關結束當下，不含第 4、5 關。
  expect(stat(save, "IM_duration")).toBe(expectedDuration);
});

/** 開遊戲（可裝假時鐘），第 1–3 關都直接過關，停在中場畫面。 */
// holdSaves：成績送出一律卡住，直到呼叫 writes.release()（中場先送的第 3 關也會卡著）。
async function playToMidway(page, { clock = false, holdSaves = false } = {}) {
  const writes = await recordWrites(page);
  if (holdSaves) {
    const released = new Promise((resolve) => { writes.release = resolve; });
    await page.route("**/api/sessions", async (route) => {
      await released;
      await route.fallback();
    });
  }
  await loginAs(page, STUDENT);
  if (clock) await page.clock.install();
  await page.goto(GAME);
  await page.waitForFunction(() => typeof state !== "undefined" && state.task && state.rooms.length);
  for (let stage = 1; stage <= 3; stage++) {
    await expect(page.locator("#problem-title")).toHaveText(`第 ${stage} 關`);
    await beginStage(page);
    await page.evaluate(() => passStage());
    if (clock) await page.clock.runFor(800);
    if (stage < 3) await page.locator(".shared-stage-clear-btn").click();
  }
  await expect(page.locator("#midway-panel")).toBeVisible();
  return writes;
}

const durationMatchesTimes = (save) =>
  Math.abs(save.body.data.endTime - save.body.data.startTime - stat(save, "IM_duration"));

test("R9 中場停留 2 分鐘才按離開：第 3 關的時長和 endTime 都不含中場等待", async ({ page }) => {
  const writes = await playToMidway(page, { clock: true });
  const expectedDuration = await page.evaluate(() => state.stageResults[2].elapsedMs);
  await page.clock.fastForward(120_000);
  // 中場畫面蓋住「離開」，直接呼叫 leaveGame（和按鈕同一條路）。
  await page.evaluate(() => { void leaveGame(); });
  await leaveDialog(page).getByRole("button", { name: "離開", exact: true }).click();
  await page.waitForURL("**/Select/index.html");
  expect(sessionPosts(writes)).toHaveLength(1);
  const save = sessionPosts(writes)[0];
  expect(stat(save, "IM_stage")).toBe(3);
  expect(stat(save, "IM_duration")).toBe(expectedDuration);
  expect(durationMatchesTimes(save)).toBeLessThan(1000);
});

test("R9 中場停留 2 分鐘才按「返回遊戲大廳」：時長不含中場等待", async ({ page }) => {
  const writes = await playToMidway(page, { clock: true });
  const expectedDuration = await page.evaluate(() => state.stageResults[2].elapsedMs);
  await page.clock.fastForward(120_000);
  await page.locator("#midway-back-btn").click();
  await page.waitForURL("**/Select/index.html");
  expect(sessionPosts(writes)).toHaveLength(1);
  const save = sessionPosts(writes)[0];
  expect(stat(save, "IM_duration")).toBe(expectedDuration);
  expect(durationMatchesTimes(save)).toBeLessThan(1000);
});

test("R9 第 6 關結束：時長算到第 6 關結束，不含結束後的等待", async ({ page }) => {
  const writes = await playToMidway(page, { clock: true });
  await page.locator("#continue-btn").click();
  for (let stage = 4; stage <= 5; stage++) {
    await expect(page.locator("#problem-title")).toHaveText(`第 ${stage} 關`);
    await beginStage(page);
    await page.evaluate(() => passStage());
    await page.clock.runFor(800);
    await page.locator(".shared-stage-clear-btn").click();
  }
  await expect(page.locator("#problem-title")).toHaveText("第 6 關");
  await beginStage(page);
  await page.clock.runFor(5_000);
  // 前往題抵達時會多停 1 秒展示（holdMs），也不能算進時長。
  await page.evaluate(() => passStage(1000));
  const expectedDuration = await page.evaluate(() => state.stageResults[5].elapsedMs);
  await page.clock.runFor(5_000);
  await expect(page.locator("#result")).toBeVisible();
  // 中場先送第 3 關，打完再用同一個 submissionId 送第 6 關（後端更新同一列）。
  await expect.poll(() => sessionPosts(writes).length).toBe(2);
  const [midway, save] = sessionPosts(writes);
  expect(stat(midway, "IM_stage")).toBe(3);
  expect(save.body.data.submissionId).toBe(midway.body.data.submissionId);
  expect(stat(save, "IM_stage")).toBe(6);
  expect(stat(save, "IM_duration")).toBe(expectedDuration);
  expect(durationMatchesTimes(save)).toBeLessThan(1000);
});

test("R3 第 6 關剩 1 秒時確定離開、中場的第 3 關還沒送完：等它送完才導頁，期間不會打完第 6 關多送一筆", async ({ page }) => {
  const issued = watchSessionPosts(page);
  const writes = await playToMidway(page, { holdSaves: true });
  const stageOf = (body) => body.data.stats.find((item) => item.apiname === "IM_stage")?.value;
  await page.locator("#continue-btn").click();
  for (let stage = 4; stage <= 6; stage++) {
    await expect(page.locator("#problem-title")).toHaveText(`第 ${stage} 關`);
    await beginStage(page);
    if (stage < 6) {
      await page.evaluate(() => passStage());
      await page.locator(".shared-stage-clear-btn").click();
    }
  }
  await page.evaluate(() => { state.remaining = 1; });
  await page.locator("#leave-btn").click();
  await leaveDialog(page).getByRole("button", { name: "離開", exact: true }).click();
  // 存檔還在路上時遊戲維持暫停：倒數不走、不結算。
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(true);
  await expect(page.locator("#result")).toBeHidden();
  expect(issued.map(stageOf)).toEqual([3]);
  writes.release();
  await page.waitForURL("**/Select/index.html");
  expect(issued.map(stageOf)).toEqual([3]);
  expect(sessionPosts(writes)).toHaveLength(1);
});

test("R3 確定離開後存檔還在路上：空白鍵、方向鍵、點門／放置點都不動遊戲狀態", async ({ page }) => {
  // 中場先送的第 3 關一直卡著，離開時要等它送完。
  const writes = await playToMidway(page, { holdSaves: true });
  await page.locator("#continue-btn").click();
  await expect(page.locator("#problem-title")).toHaveText("第 4 關");
  await beginStage(page);
  // 起點房間放好本題的目標物品，玩家站在旁邊：按空白鍵本來會撿起、點門本來會走過去。
  await page.evaluate(() => {
    const target = state.task.targetItems[0] || "apple";
    const room = state.rooms[0][0];
    room.hasDown = true;
    state.rooms[1][0].hasUp = true;
    room.zones.forEach((zone, i) => { zone.item = i === 0 ? target : null; });
    state.playerX = Number(room.zones[0].x ?? 36);
    renderRoom();
  });
  const release = writes.release;
  const before = await page.evaluate(() => JSON.stringify({
    bag: state.bag, x: state.playerX, row: state.row, col: state.col,
    results: state.stageResults.length, walk: state.walkTarget,
  }));
  await page.locator("#leave-btn").click();
  await leaveDialog(page).getByRole("button", { name: "離開", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.WebGameRuntime.paused)).toBe(true);
  await page.keyboard.press(" ");
  await page.keyboard.press("Enter");
  await page.keyboard.down("ArrowRight");
  await page.locator('#doors .door[data-dir="down"]').dispatchEvent("click");
  await page.locator("#zones .zone").first().dispatchEvent("click");
  await page.keyboard.up("ArrowRight");
  const after = await page.evaluate(() => JSON.stringify({
    bag: state.bag, x: state.playerX, row: state.row, col: state.col,
    results: state.stageResults.length, walk: state.walkTarget,
  }));
  expect(after).toBe(before);
  release();
  await page.waitForURL("**/Select/index.html");
  expect(sessionPosts(writes)).toHaveLength(1);
  expect(stat(sessionPosts(writes)[0], "IM_stage")).toBe(3);
});
