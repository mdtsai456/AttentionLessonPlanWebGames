// 字型集中到 shared/fonts 後，每一頁都要載得到，不能有 404。
import { test, expect } from '@playwright/test';
import { STUDENT, DOUBLE, loginAs } from './helpers.mjs';
import { GUARDED_PAGES, DOUBLE_PAGES } from '../site.mjs';

async function expectFontLoaded(page) {
  const failed = [];
  page.on('response', (res) => {
    if (/MaokenAssortedSans/.test(res.url()) && !res.ok()) failed.push(res.url());
  });
  return async () => {
    const faces = await page.evaluate(async () => {
      await document.fonts.load('16px MaokenAssortedSans');
      return [...document.fonts].filter((face) => face.family.includes('MaokenAssortedSans')).map((face) => face.status);
    });
    expect(failed).toEqual([]);
    expect(faces).toContain('loaded');
  };
}

test('Home 載入共用字型', async ({ page }) => {
  const check = await expectFontLoaded(page);
  await page.goto('Home/index.html');
  await check();
});

for (const [session, pages] of [[STUDENT, GUARDED_PAGES], [DOUBLE, DOUBLE_PAGES]]) {
  for (const target of pages) {
    test(`${target} 載入共用字型`, async ({ page }) => {
      await loginAs(page, session);
      const check = await expectFontLoaded(page);
      await page.goto(target);
      await page.waitForFunction(() => document.documentElement.style.visibility !== 'hidden');
      await check();
    });
  }
}
