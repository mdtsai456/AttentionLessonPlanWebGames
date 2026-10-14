// 命中判定遮罩要符合目前顯示的動物圖，不可永遠用兔子形狀（#23）
// 測試自行用 canvas 讀 bird.png 透明度，找出「兔子遮罩有、鳥是透明」與「鳥不透明、兔子遮罩沒有」的點，
// 且兩點都在中央圓形判定區之外，只取決於遮罩。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startStaticServer, launchBrowser, openGame } from './helpers.js';

const ASSET_HOST = 'https://attention-lesson-plan-assets.zeabur.app';

// 在頁面中：換上指定圖片並等待解碼完成
async function showImage(page, selector, src) {
  await page.evaluate(async ({ selector, src }) => {
    const img = document.querySelector(selector);
    img.src = src;
    await img.decode();
  }, { selector, src });
}

// 在頁面中：用測試自己的 canvas 讀同源 bird.png，找出兩個檢查點（128×128 格座標）
async function findPoints(page, birdPath) {
  return page.evaluate(async (birdPath) => {
    const bird = new Image();
    bird.src = birdPath;
    await bird.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bird, 0, 0, 128, 128);
    const alpha = ctx.getImageData(0, 0, 128, 128).data;
    const a = (x, y) => (x < 0 || y < 0 || x >= 128 || y >= 128 ? 0 : alpha[(y * 128 + x) * 4 + 3]);
    const around = (x, y, ok) => [-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => ok(a(x + dx, y + dy))));
    const rabbit = (x, y) => RABBIT_HIT_MASK[y]?.[x] === '1'; // eslint-disable-line no-undef
    const rabbitAround = (x, y, value) => [-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => rabbit(x + dx, y + dy) === value));
    // 中央圓半徑為動物框的 0.36，加上 3 格緩衝
    const outside = (x, y) => Math.hypot(x + 0.5 - 64, y + 0.5 - 64) > 128 * 0.36 + 3;
    let rabbitOnly = null;
    let birdOnly = null;
    for (let y = 1; y < 127; y++) {
      for (let x = 1; x < 127; x++) {
        if (!outside(x, y)) continue;
        if (!rabbitOnly && rabbitAround(x, y, true) && around(x, y, (v) => v === 0)) rabbitOnly = { x, y };
        if (!birdOnly && rabbitAround(x, y, false) && around(x, y, (v) => v >= 224)) birdOnly = { x, y };
      }
    }
    return { rabbitOnly, birdOnly };
  }, birdPath);
}

describe('命中遮罩跟著目前的動物圖', () => {
  let server;
  let noCorsServer;
  let browser;
  let birdPng;
  before(async () => {
    server = await startStaticServer();
    noCorsServer = await startStaticServer();
    browser = await launchBrowser();
    birdPng = await readFile(new URL('../../DAT_single/assets/animals/bird.png', import.meta.url));
  });
  after(async () => { await browser?.close(); await server?.close(); await noCorsServer?.close(); });

  const routeOverride = async ({ route, url }) => {
    if (url.startsWith(`${noCorsServer.origin}/`)) {
      // 跨來源且沒有 CORS 標頭：圖片可顯示，但 canvas 讀不到透明度。
      // route.fulfill 會自動補 CORS 標頭，所以改由另一個埠號的本機伺服器實際回應。
      await route.continue();
      return true;
    }
    if (url === `${ASSET_HOST}/uploads/bird-cors.png`) {
      // 正式素材伺服器的上傳圖片有 Access-Control-Allow-Origin: *（R6）
      await route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: birdPng });
      return true;
    }
    return false;
  };

  // 走遊戲實際換圖的 DatAssets.setImage，回傳畫面上的網址
  async function setImage(page, selector, src) {
    return page.evaluate(async ({ selector, src }) => {
      const img = document.querySelector(selector);
      await window.DatAssets.setImage(img, src, 'assets/animals/rabbit.png');
      await img.decode();
      return img.src;
    }, { selector, src });
  }

  for (const game of ['single', 'double']) {
    test(`${game}：鳥圖的透明處不算命中、不透明處算命中；本機兔子維持原遮罩；跨來源有 CORS 的上傳圖用遮罩；讀不到透明度時只用中央圓`, async () => {
      const session = await openGame(browser, server.origin, { game, realAim: true, routeOverride });
      const imageSelector = game === 'single' ? '#animal-image' : '.player-1 [data-ui="animal-image"]';
      try {
        const points = await findPoints(session.page, `/DAT_${game}/assets/animals/bird.png`);
        assert.ok(points.rabbitOnly, '找得到兔子遮罩有、鳥透明的檢查點');
        assert.ok(points.birdOnly, '找得到鳥不透明、兔子遮罩沒有的檢查點');

        // 把準心放到 128×128 格座標 (x, y) 的中心，回傳是否命中
        const hitAt = (point) => session.page.evaluate(({ game, point }) => {
          const root = game === 'single' ? document : document.querySelector('.player-1');
          const q = (id) => root.querySelector(`[data-ui="${id}"], #${id}`);
          const field = q('field').getBoundingClientRect();
          const rect = q('animal-image').getBoundingClientRect();
          const size = Math.min(rect.width, rect.height);
          const clientX = rect.left + (rect.width - size) / 2 + (point.x + 0.5) / 128 * size;
          const clientY = rect.top + (rect.height - size) / 2 + (point.y + 0.5) / 128 * size;
          const target = { x: (clientX - field.left) / field.width * 100, y: (clientY - field.top) / field.height * 100 };
          if (game === 'single') {
            /* eslint-disable no-undef */
            aim.x = target.x;
            aim.y = target.y;
            return isOnAnimal();
            /* eslint-enable no-undef */
          }
          return window.DatAssets.isOnAnimal(q('field'), q('animal'), q('animal-image'), target);
        }, { game, point });
        const center = { x: 64, y: 64 };

        // 本機兔子：行為不變，兔腳（遮罩內）算命中
        assert.equal(await hitAt(points.rabbitOnly), true, '兔子圖：兔子遮罩內算命中');
        assert.equal(await hitAt(center), true);

        await showImage(session.page, imageSelector, 'assets/animals/bird.png');
        assert.equal(await hitAt(points.rabbitOnly), false, `鳥圖：鳥的透明處 ${JSON.stringify(points.rabbitOnly)} 不可因兔子遮罩算命中`);
        assert.equal(await hitAt(points.birdOnly), true, `鳥圖：鳥的不透明處 ${JSON.stringify(points.birdOnly)} 要算命中`);
        assert.equal(await hitAt(center), true);

        // 跨來源上傳圖有 ACAO:*：以 CORS 載入，遮罩讀得到透明度（R6）
        assert.equal(await setImage(session.page, imageSelector, `${ASSET_HOST}/uploads/bird-cors.png`), `${ASSET_HOST}/uploads/bird-cors.png`);
        assert.equal(await hitAt(points.rabbitOnly), false, '跨來源鳥圖：透明處不算命中');
        assert.equal(await hitAt(points.birdOnly), true, '跨來源鳥圖：中央圓外的不透明處要算命中');
        assert.equal(await hitAt(center), true);

        // 沒有 CORS 標頭的跨來源圖：仍要顯示（不可退回備援圖），命中只用中央圓
        const noCorsBird = `${noCorsServer.origin}/DAT_${game}/assets/animals/bird.png`;
        assert.equal(await setImage(session.page, imageSelector, noCorsBird), noCorsBird, '沒有 CORS 的圖片仍顯示原圖');
        assert.equal(await hitAt(points.rabbitOnly), false, '讀不到透明度的上傳圖不可退回兔子遮罩');
        assert.equal(await hitAt(points.birdOnly), false, '讀不到透明度時只用中央圓');
        assert.equal(await hitAt(center), true, '中央圓仍算命中');
        assert.deepEqual(session.pageErrors, []);
      } finally { await session.context.close(); }
    });
  }
});
