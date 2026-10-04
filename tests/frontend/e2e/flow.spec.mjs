// 守門不能擋到正常流程：學生從 Select 進教學、進遊戲、再回 Select。
import { test, expect } from "@playwright/test";
import { STUDENT, loginAs } from "./helpers.mjs";

const GAMES = [
  { label: "賽道攔截", tutorial: "/tutorial/DCCS_tutorial.html", game: "/DCCS/index.html" },
  { label: "瓢蟲追擊令", tutorial: "/tutorial/DAT_tutorial.html", game: "/DAT_single/DAT_single.html" },
  { label: "漂浮泡泡", tutorial: "/tutorial/EFT_tutorial.html", game: "/EFT_single/EFT_single.html" },
  { label: "勇闖迷宮", tutorial: "/tutorial/TGame_tutorial.html", game: "/TGame1/index.html" },
  { label: "指令出擊", tutorial: "/tutorial/InstructionGame_tutorial.html", game: "/IM1/index.html" },
];

for (const game of GAMES) {
  test(`學生走 Select → ${game.label} 教學 → 遊戲`, async ({ page }) => {
    await loginAs(page, STUDENT);
    await page.goto("Select/index.html");
    await page.locator("#game-list [data-select-game]", { hasText: game.label }).click();
    await page.click("#enter-btn");
    await expect(page).toHaveURL(new RegExp(`${game.tutorial}$`));

    // 綠色按鈕是「開始遊戲」或「不練習，直接挑戰」
    await page.click("a.btn-green");
    await page.waitForURL((url) => url.pathname === game.game);
    await page.waitForTimeout(1000);
    expect(new URL(page.url()).pathname).toBe(game.game);

    const canReturn = await page.evaluate(() => typeof window.returnToLobby === "function");
    if (canReturn) {
      await page.evaluate(() => window.returnToLobby());
      await expect(page).toHaveURL(/\/Select\/index\.html$/);
    }
  });
}
