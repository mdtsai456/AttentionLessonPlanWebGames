// 登出後按上一頁：Chrome 會從 bfcache 原樣還原頁面、不重跑 script。
import { test, expect } from "@playwright/test";
import { DCCS_PAGE } from "../site.mjs";
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

for (const loggedOut of [true, false]) {
  test(`DCCS 從 bfcache 還原：${loggedOut ? "已登出者回 Home" : "仍登入者正常顯示"}`, async ({ page }) => {
    const shows = await trackPageshow(page);
    await loginAs(page, STUDENT);
    await page.goto(DCCS_PAGE);
    await expect(page.locator("#game-root canvas")).toBeVisible();

    // 不攔截請求，保留真正的 bfcache；離開遊戲後在 Home 模擬清除登入資料。
    await page.goto("Home/index.html");
    if (loggedOut) await page.evaluate(() => sessionStorage.clear());

    await page.goBack({ waitUntil: "commit" });
    await expect.poll(() => shows).toContainEqual({ path: `/${DCCS_PAGE}`, persisted: true });

    if (loggedOut) {
      await expect(page).toHaveURL(HOME_URL);
    } else {
      await expect(page).toHaveURL(/\/DCCS\/index\.html$/);
      await expect(page.locator("#game-root canvas")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.style.visibility)).not.toBe("hidden");
    }
  });
}

for (const path of ['Select/index.html', DCCS_PAGE, 'DAT_double/DAT_double.html', 'Back/index.html']) {
  test(`${path} bfcache 後端撤銷 token 時回 Home`, async ({ page, request }) => {
    const { DOUBLE, TEACHER } = await import('./helpers.mjs');
    const shows = await trackPageshow(page);
    await loginAs(page, path.startsWith('Back/') ? TEACHER : path.includes('double') ? DOUBLE : STUDENT);
    await page.goto(path);
    await expect.poll(() => page.evaluate(() => !!window.WebGameAuth?.active && !!window.WebGameRuntime)).toBe(true);
    const token = await page.evaluate((double) => sessionStorage.getItem(double ? 'student2_token' : 'token'), path.includes('double'));
    await page.goto('Home/index.html');
    await request.get(`/__test/revoke?token=${encodeURIComponent(token)}`);
    await page.goBack({ waitUntil: 'commit' });
    await expect.poll(() => shows).toContainEqual({ path: '/' + path, persisted: true });
    await expect(page).toHaveURL(HOME_URL);
    expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBeNull();
  });
}

test('bfcache 等待後端驗證時凍結輸入、計時與成績，成功後保留狀態', async ({ page }) => {
  const shows = await trackPageshow(page);
  await loginAs(page, { ...STUDENT, token: 'delayed', student1_token: 'delayed' });
  await page.goto('DAT_single/DAT_single.html');
  await expect.poll(() => page.evaluate(() => !!window.WebGameRuntime && !!window.WebGameApi)).toBe(true);
  await page.evaluate(() => {
    window.authProbe = { count: 0, input: 0, time: 0, clicks: 0 };
    setInterval(() => { authProbe.count++; authProbe.time = WebGameRuntime.now(); }, 20);
    addEventListener('keydown', () => authProbe.input++);
    addEventListener('click', () => authProbe.clicks++);
  });
  await page.waitForTimeout(100);
  const snapshot = await page.evaluate(() => ({ ...authProbe }));
  await page.goto('Home/index.html');
  await page.waitForTimeout(300);
  await page.goBack({ waitUntil: 'commit' });
  await expect.poll(() => shows).toContainEqual({ path: '/DAT_single/DAT_single.html', persisted: true });
  expect(await page.evaluate(() => document.documentElement.style.visibility)).toBe('hidden');
  const frozen = await page.evaluate(() => ({ ...authProbe }));
  await page.keyboard.press('ArrowRight');
  const blocked = await page.evaluate(async () => {
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    try { await WebGameApi.submitSession({ data: { grade: 'G9', caseId: 'S99', school: 'TEST', mode: 'single' } }); return false; }
    catch { return true; }
  });
  expect(blocked).toBe(true);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => ({ ...authProbe }))).toEqual(frozen);
  await expect.poll(() => page.evaluate(() => !!window.WebGameAuth.active)).toBe(true);
  await page.waitForTimeout(100);
  const resumed = await page.evaluate(() => ({ ...authProbe }));
  expect(resumed.count).toBeGreaterThan(snapshot.count);
  expect(resumed.time - snapshot.time).toBeLessThan(600);
  expect(resumed.input).toBe(0);
  expect(resumed.clicks).toBe(0);
});
