// 010：單人遊戲未取得登入學生資料時，不送出成績。有登入資料時，payload 使用該學生資料。
import { test, expect } from "@playwright/test";
import { STUDENT, loginAs, recordWrites } from "./helpers.mjs";

const RESULT = { score: 3, wrong: 1, accuracy: 75, duration: 1000, stage: 3, levelAccuracy: "", avgReactionMs: 500, questionCount: 4, aimRatio: 0.5, focusMs: 500 };

// 直接呼叫各遊戲的存檔函式。中場與全部完成時，皆使用此函式存檔。
const GAMES = [
  { name: "DAT_single", page: "DAT_single/DAT_single.html", save: "window.saveGameDataToBackend" },
  { name: "EFT_single", page: "EFT_single/EFT_single.html", save: "window.EFTSingle?.saveGameDataToBackend" },
  { name: "TGame_single", page: "TGame_single/index.html", save: "window.submitResult" },
  { name: "IM_single", page: "IM_single/index.html", save: "window.submitResult" },
];

async function openGameAndSave(page, game, session) {
  const writes = await recordWrites(page);
  const warnings = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await loginAs(page, session);
  await page.goto(game.page);
  await page.waitForFunction(`typeof ${game.save} === "function"`);
  writes.length = 0; // 只檢查本次手動存檔。
  await page.evaluate(`${game.save}(${JSON.stringify(RESULT)})`);
  await page.waitForTimeout(300);
  return { writes, warnings };
}

for (const game of GAMES) {
  for (const missing of ['grade', 'caseId', 'school']) {
    test(`${game.name}：登入後清除 ${missing}，不使用預設學生存檔`, async ({ page }) => {
      const writes = await recordWrites(page);
      await loginAs(page, STUDENT);
      await page.goto(game.page);
      await page.waitForFunction(`typeof ${game.save} === "function"`);
      await page.evaluate((missing) => {
        sessionStorage.removeItem(missing);
        sessionStorage.removeItem({ grade: 'student1_grade', caseId: 'student1_case', school: 'student1_school' }[missing]);
      }, missing);
      writes.length = 0;
      await page.evaluate(`${game.save}(${JSON.stringify(RESULT)})`);
      expect(writes).toEqual([]);
    });
  }

  test(`${game.name}：學生登入時照常送出，payload 是登入學生`, async ({ page }) => {
    const { writes } = await openGameAndSave(page, game, STUDENT);
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("POST");
    expect(writes[0].headers.authorization).toMatch(/^Bearer student-token\./);
    expect(writes[0].url).toMatch(/\/api\/sessions$/);
    expect(writes[0].body.data).toMatchObject({ grade: "G9", caseId: "S99", school: "TEST", currentDay: 3, mode: "single" });
  });

  test(`${game.name}：只有 student1_* 欄位時用 student1_* 的值`, async ({ page }) => {
    const { writes } = await openGameAndSave(page, game, {
      user_role: "student",
      game_mode: "single",
      student1_token: "alternate-token",
      student1_grade: "G8",
      student1_case: "S77",
      student1_school: "T2",
      student1_day: "2",
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].body.data).toMatchObject({ grade: "G8", caseId: "S77", school: "T2", currentDay: 2 });
  });
}
