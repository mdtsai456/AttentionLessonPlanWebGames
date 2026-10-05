import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStaticServer, launchBrowser, openGame } from './helpers.js';

const assetHost = 'https://attention-lesson-plan-assets.zeabur.app';
const files = ['/uploads/initial.png', '/uploads/evolved.png'];

async function expectAnimal(session, game, expectedPath = '/assets/animals/rabbit.png') {
  await session.driver.waitFor((expectedPath) => [...document.querySelectorAll('#animal-image, [data-ui="animal-image"]')]
    .every((img) => img.complete && img.naturalWidth > 0 && img.src.endsWith(expectedPath)),
  '有效動物圖片載入', { maxMs: 15000, arg: expectedPath });
  const images = await session.page.locator('#animal-image, [data-ui="animal-image"]').evaluateAll((list) => list.map((img) => ({
    width: img.naturalWidth, visibility: getComputedStyle(img).visibility,
    opacity: getComputedStyle(img).opacity,
  })));
  assert.equal(images.length, game === 'double' ? 2 : 1);
  for (const image of images) {
    assert.ok(image.width > 0);
    assert.equal(image.visibility, 'visible');
    assert.equal(image.opacity, '1');
  }
  assert.deepEqual(session.errors.filter((error) => error.startsWith('pageerror:')), []);
}

describe('DAT 素材錯誤回退', () => {
  let server;
  let browser;
  before(async () => { server = await startStaticServer(); browser = await launchBrowser(); });
  after(async () => { await browser?.close(); await server?.close(); });

  test('single：重玩取消舊變身後，舊 Promise 不會恢復新動畫的樣式', async () => {
    const session = await openGame(browser, server.origin, {
      game: 'single', assetFiles: [...files, '/uploads/second-hung.png'],
      routeOverride: async ({ url }) => url === `${assetHost}${files[1]}` || url.endsWith('/uploads/second-hung.png'),
    });
    try {
      const opacity = await session.page.evaluate(async () => {
        updateAnimalImage(1);
        startGame();
        updateAnimalImage(2);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        return document.querySelector('#animal-image').style.opacity;
      });
      assert.equal(opacity, '0.2', '新的變身仍在預載，舊 Promise 不應提前恢復 opacity');
    } finally { await session.context.close(); }
  });

  for (const game of ['single', 'double']) {
    for (const failure of ['api-hung', 'api-error', 'api-invalidjson', 'initial404', 'image-hung']) {
      test(`${game}：${failure} 後顯示有效備援圖片並可作答`, async () => {
        const session = await openGame(browser, server.origin, {
          game, assetFiles: files,
          routeOverride: async ({ route, url }) => {
            if (url.startsWith(`${assetHost}/api/students/`)) {
              if (failure === 'api-hung') return true;
              if (failure === 'api-error' || failure === 'api-invalidjson') {
                await route.fulfill({ status: failure === 'api-error' ? 503 : 200,
                  contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
                  body: failure === 'api-error' ? '{}' : '{bad JSON' });
                return true;
              }
            }
            if (url === `${assetHost}${files[0]}`) {
              if (failure === 'image-hung') return true;
              if (failure === 'initial404') {
                await route.fulfill({ status: 404, body: '' });
                return true;
              }
            }
            return false;
          },
        });
        try {
          await expectAnimal(session, game);
          const results = await session.driver.playQuestion(...Array(game === 'double' ? 2 : 1).fill('correct'));
          for (const result of results) assert.match(result.message, /＋1 分/);
        } finally { await session.context.close(); }
      });
    }

    test(`${game}：變身圖片 404 後回退有效備援圖片`, async () => {
      const session = await openGame(browser, server.origin, {
        game, assetFiles: files,
        routeOverride: async ({ route, url }) => {
          if (url !== `${assetHost}${files[1]}`) return false;
          await route.fulfill({ status: 404, body: '' });
          return true;
        },
      });
      try {
        for (let i = 0; i < 5; i++) {
          await session.driver.playQuestion(...Array(game === 'double' ? 2 : 1).fill('correct'));
        }
        await expectAnimal(session, game, game === 'double' ? files[0] : undefined);
      } finally { await session.context.close(); }
    });
  }
});
