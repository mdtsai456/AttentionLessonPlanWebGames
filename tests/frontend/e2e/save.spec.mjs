// 010：單人遊戲讀不到登入學生就不送成績；有登入時照送，payload 是登入學生。
import { test, expect } from "@playwright/test";
import { STUDENT, loginAs, recordWrites } from "./helpers.mjs";

const RESULT = { score: 3, wrong: 1, accuracy: 75, duration: 1000, stage: 3, levelAccuracy: "", avgReactionMs: 500, questionCount: 4 };

// 直接呼叫各遊戲的存檔函式（中場與全破存檔都走這裡）。
const GAMES = [
  { name: "DAT_single", page: "DAT_single/DAT_single.html", save: "window.saveGameDataToBackend" },
  { name: "EFT_single", page: "EFT_single/EFT_single.html", save: "window.EFTSingle?.saveGameDataToBackend" },
  { name: "TGame1", page: "TGame1/index.html", save: "window.submitResult" },
  { name: "IM1", page: "IM1/index.html", save: "window.submitResult" },
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
  writes.length = 0; // 只看手動存檔這一次
  await page.evaluate(`${game.save}(${JSON.stringify(RESULT)})`);
  await page.waitForTimeout(300);
  return { writes, warnings };
}

for (const game of GAMES) {
  test(`${game.name}：缺 grade/caseId/school 不送成績，也不用預設學生`, async ({ page }) => {
    const { writes, warnings } = await openGameAndSave(page, game, {
      user_role: "student",
      token: "student-token",
      student1_token: "student-token",
    });
    expect(writes).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  for (const missing of ["grade", "caseId", "school"]) {
    test(`${game.name}：只缺 ${missing} 也不送`, async ({ page }) => {
      const session = { ...STUDENT };
      delete session[missing];
      delete session[{ grade: "student1_grade", caseId: "student1_case", school: "student1_school" }[missing]];
      const { writes } = await openGameAndSave(page, game, session);
      expect(writes).toEqual([]);
    });
  }

  test(`${game.name}：學生登入時照常送出，payload 是登入學生`, async ({ page }) => {
    const { writes } = await openGameAndSave(page, game, STUDENT);
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("POST");
    expect(writes[0].url).toMatch(/\/api\/sessions$/);
    expect(writes[0].body.data).toMatchObject({ grade: "G9", caseId: "S99", school: "TEST", currentDay: 3, mode: "single" });
  });

  test(`${game.name}：只有 student1_* 欄位時用 student1_* 的值`, async ({ page }) => {
    const { writes } = await openGameAndSave(page, game, {
      user_role: "student",
      student1_token: "student-token",
      student1_grade: "G8",
      student1_case: "S77",
      student1_school: "T2",
      student1_day: "2",
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].body.data).toMatchObject({ grade: "G8", caseId: "S77", school: "T2", currentDay: 2 });
  });
}
