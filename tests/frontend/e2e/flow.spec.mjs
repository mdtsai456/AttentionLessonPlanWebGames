// 守門不能擋到正常流程：學生從 Select 進教學、進遊戲、再回 Select。
import { test, expect } from "@playwright/test";
import { STUDENT, loginAs } from "./helpers.mjs";

const GAMES = [
  { label: "賽道攔截", tutorial: "/Tutorial/DCCS_tutorial.html", game: "/DCCS_single/index.html" },
  { label: "瓢蟲追擊令", tutorial: "/Tutorial/DAT_tutorial.html", game: "/DAT_single/DAT_single.html" },
  { label: "漂浮泡泡", tutorial: "/Tutorial/EFT_tutorial.html", game: "/EFT_single/EFT_single.html" },
  { label: "勇闖迷宮", tutorial: "/Tutorial/TGame_tutorial.html", game: "/TGame_single/index.html" },
  { label: "指令出擊", tutorial: "/Tutorial/InstructionGame_tutorial.html", game: "/IM_single/index.html" },
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

for (const game of GAMES.filter((game) => game.label !== '指令出擊')) {
  test(`雙人 Select → ${game.label} 教學 → 遊戲`, async ({ page }) => {
    const { DOUBLE } = await import('./helpers.mjs');
    await loginAs(page, DOUBLE);
    await page.goto('Select/index.html');
    for (const slot of [1, 2]) {
      await page.locator(`[data-game-list="${slot}"] [data-select-game]`, { hasText: game.label }).click();
      await page.click(`[data-enter="${slot}"]`);
    }
    await expect(page).toHaveURL(/_double_tutorial.html$/);
    await page.click('a.btn-green');
    await expect(page).toHaveURL(game.label === '賽道攔截' ? /DCCS_double\/index.html$/ : game.label === '瓢蟲追擊令' ? /DAT_double\/DAT_double.html(?:\?.*)?$/ : game.label === '漂浮泡泡' ? /EFT_double\/EFT_double.html$/ : /TGame_double\/index.html$/);
    await expect.poll(() => page.evaluate(() => !!window.WebGameAuth?.active)).toBe(true);
  });
}
