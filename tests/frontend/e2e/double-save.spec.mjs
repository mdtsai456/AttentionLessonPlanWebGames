import { test, expect } from '@playwright/test';
import { DOUBLE, loginAs, recordWrites } from './helpers.mjs';
for (const name of ['DAT', 'EFT', 'TGame', 'DCCS']) {
  test(`${name} 雙人各送正確學生及搭檔 token`, async ({ page }) => {
    const writes = await recordWrites(page);
    await loginAs(page, DOUBLE);
    const path = name === 'DAT' ? 'DAT_double/DAT_double.html?mode=game' : name === 'EFT' ? 'EFT_double/EFT_double.html' : name === 'TGame' ? 'TGame2/index.html' : 'DCCS/double.html?sessionSeconds=5';
    await page.goto(path);
    await expect.poll(() => page.evaluate(() => !!window.WebGameApi && !!window.WebGameRuntime)).toBe(true);
    const tokens = await page.evaluate(() => [sessionStorage.getItem('student1_token'), sessionStorage.getItem('student2_token')]);
    if (name === 'DAT') {
      await page.evaluate(async () => {
        const { players } = await import('/DAT_double/js/main.js?v=5');
        await Promise.all(players.map((player) => player.saveRun(3)));
      });
    } else if (name === 'EFT') {
      await page.evaluate(async () => {
        const { players } = await import('/EFT_double/EFT_double.js');
        await Promise.all(players.map((player) => player.saveRun(3)));
      });
    } else if (name === 'TGame') {
      await page.waitForFunction(() => typeof saveBoth === 'function');
      await page.evaluate(() => saveBoth(3));
    } else {
      await expect(page.locator('#player1-game canvas')).toBeVisible();
      // 先確認第 1 關提示；除錯場次在 5 秒後經真正結算路徑送兩筆。
      await page.click("#shared-continue");
    }
    await expect.poll(() => writes.filter((request) => /\/api\/sessions$/.test(request.url)).length, { timeout: 12000 }).toBe(2);
    const sessions = writes.filter((request) => /\/api\/sessions$/.test(request.url));
    for (const request of sessions) {
      const slot = request.body.data.caseId === 'S99' ? 0 : 1;
      expect(request.body.data).toMatchObject(slot === 0 ? { grade: 'G9', caseId: 'S99', school: 'TEST', mode: 'double' } : { grade: 'G8', caseId: 'S88', school: 'TEST', mode: 'double' });
      expect(request.headers.authorization).toBe('Bearer ' + tokens[slot]);
      expect(request.headers['x-partner-authorization']).toBe('Bearer ' + tokens[1 - slot]);
    }
  });
}
