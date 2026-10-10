import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startStaticServer, launchBrowser, openGame } from './helpers.js';

describe('雙人升級圖片失敗仍保留已顯示的貓', () => {
  let server;
  let browser;
  let catPng;
  before(async () => {
    server = await startStaticServer();
    browser = await launchBrowser();
    catPng = await readFile(new URL('../../DAT_double/assets/animals/cat.png', import.meta.url));
  });
  after(async () => { await browser?.close(); await server?.close(); });

  for (const failure of ['404', 'timeout']) {
    test(`${failure}：兔子→貓→下一張失敗，之後誤按紅光仍保留貓`, async () => {
      const session = await openGame(browser, server.origin, {
        game: 'double', randomValue: 0.75,
        assetFiles: ['/uploads/rabbit.png', '/uploads/cat.png', '/uploads/dog.png'],
        routeOverride: async ({ route, url }) => {
          if (url.endsWith('/uploads/cat.png')) {
            await route.fulfill({ status: 200, contentType: 'image/png', body: catPng });
            return true;
          }
          if (!url.endsWith('/uploads/dog.png')) return false;
          if (failure === '404') await route.fulfill({ status: 404, body: '' });
          return true;
        },
      });
      try {
        for (let i = 0; i < 5; i++) await session.driver.playQuestion('correct', 'correct');
        assert.ok((await session.driver.snapshot()).every((state) => state.image.endsWith('/cat.png')));
        for (let i = 0; i < 5; i++) await session.driver.playQuestion('correct', 'correct');
        // driver 等待預載或期限到達後的替代流程。CSS transition 使用實際時間，須另行等待還原完成。
        for (let i = 0; i < 80; i++) {
          const ready = await session.page.locator('[data-ui="animal-image"]').evaluateAll((list) => list.every((img) => {
            const style = getComputedStyle(img);
            return style.opacity === '1' && style.transform === 'matrix(1, 0, 0, 1, 0, 0)';
          }));
          if (ready) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const images = await session.page.locator('[data-ui="animal-image"]').evaluateAll((list) => list.map((img) => ({
          src: img.src, valid: img.complete && img.naturalWidth > 0, visible: getComputedStyle(img).visibility,
          opacity: getComputedStyle(img).opacity, transform: getComputedStyle(img).transform,
        })));
        for (const image of images) {
          assert.ok(image.src.endsWith('/cat.png'), `已升級為貓，下一張失敗不應回到兔子：${image.src}`);
          assert.equal(image.valid, true);
          assert.equal(image.visible, 'visible');
          assert.equal(image.opacity, '1', '載入失敗後動物恢復完全可見');
          assert.equal(image.transform, 'matrix(1, 0, 0, 1, 0, 0)', '載入失敗後動物恢復原尺寸');
        }
        const results = await session.driver.playQuestion('miss', 'miss');
        for (const result of results) {
          assert.equal(result.mark, 'wrong', '誤按仍顯示正常紅色判定');
          assert.match(result.message, /^誤按/);
          assert.equal(result.image, 'cat.png', '誤按紅光不能降低已顯示的動物');
        }
        assert.deepEqual(session.pageErrors, []);
        assert.deepEqual(session.sessionPosts, [], '此重現流程不會送出正式成績');
      } finally { await session.context.close(); }
    });
  }
});
