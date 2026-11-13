// core/assets.js 的 Node 單元測試：逾時、重試、進度、錯誤訊息。不需要瀏覽器。
// 用假的 Image／fetch 決定每次請求是成功、失敗還是卡住（永遠不回應）。
//
// 執行：cd DCCS_single/tests && npm run test:unit

import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';

const GAME_DIRS = ['DCCS_single', 'DCCS_double'];
const repoUrl = new URL('../../', import.meta.url);
const BASE = 'https://example.test/DCCS_single/';
// 測試用的短逾時，讓「卡住」的情況幾十毫秒就結束。
const FAST = { timeoutMs: 30 };

async function loadAssets(dir) {
  return import(new URL(`${dir}/js/core/assets.js`, repoUrl).href);
}

const MANIFEST = {
  backgrounds: { bg: 'assets/bg.png' },
  shapes: [{ id: 'circle', src: 'assets/circle.png' }],
  categories: [{ images: [{ id: 'cat', src: 'assets/cat.png' }, { id: 'dog', src: 'assets/dog.png' }] }],
};

/**
 * 安裝假的 Image。plan(url, attempt) 回傳 'load' | 'error' | 'hang'；attempt 是同一張圖第幾次請求。
 * 回傳每次請求的網址紀錄。
 */
function fakeImages(plan = () => 'load') {
  const requests = [];
  const attempts = new Map();
  globalThis.Image = class {
    set src(url) {
      if (!url) return; // 逾時時 assets.js 會清掉 src
      const key = url.replace(/[?&]retry=\d+/, '');
      const attempt = attempts.get(key) || 0;
      attempts.set(key, attempt + 1);
      requests.push(url);
      const outcome = plan(key, attempt);
      if (outcome === 'hang') return;
      setTimeout(() => (outcome === 'load' ? this.onload?.() : this.onerror?.()), 1);
    }
    decode() { return Promise.resolve(); }
  };
  return requests;
}

function fakeFetch(plan) {
  const calls = [];
  globalThis.fetch = (url, { signal } = {}) => {
    calls.push(url);
    const outcome = plan(calls.length - 1);
    if (outcome === 'hang') {
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    if (outcome === 'error') return Promise.reject(new TypeError('Failed to fetch'));
    if (typeof outcome === 'number') return Promise.resolve({ ok: false, status: outcome });
    return Promise.resolve({ ok: true, json: async () => outcome });
  };
  return calls;
}

afterEach(() => {
  delete globalThis.Image;
  delete globalThis.fetch;
});

for (const dir of GAME_DIRS) {
  // 規則常數

  test(`${dir}：預設單張圖等 15 秒、manifest 等 10 秒，失敗重試 1 次`, async () => {
    const assets = await loadAssets(dir);
    assert.equal(assets.IMAGE_TIMEOUT_MS, 15000);
    assert.equal(assets.MANIFEST_TIMEOUT_MS, 10000);
    assert.equal(assets.RETRIES, 1);
  });

  // 成功

  test(`${dir}：全部載入成功，回傳所有圖片`, async () => {
    const { preloadImages } = await loadAssets(dir);
    fakeImages();

    const images = await preloadImages(MANIFEST, BASE, FAST);

    assert.deepEqual([...images.keys()].sort(), ['bg', 'cat', 'circle', 'dog']);
  });

  test(`${dir}：圖片網址相對於 assetBase`, async () => {
    const { preloadImages } = await loadAssets(dir);
    const requests = fakeImages();

    await preloadImages(MANIFEST, BASE, FAST);

    assert.ok(requests.includes('https://example.test/DCCS_single/assets/cat.png'));
  });

  test(`${dir}：空的 manifest 直接完成，進度回報 0／0`, async () => {
    const { preloadImages } = await loadAssets(dir);
    fakeImages();
    const progress = [];

    const images = await preloadImages({}, BASE, { ...FAST, onProgress: (...args) => progress.push(args) });

    assert.equal(images.size, 0);
    assert.deepEqual(progress, [[0, 0]]);
  });

  // 進度

  test(`${dir}：進度從 0 開始，每載完一張加 1，最後等於總數`, async () => {
    const { preloadImages } = await loadAssets(dir);
    fakeImages();
    const progress = [];

    await preloadImages(MANIFEST, BASE, { ...FAST, onProgress: (...args) => progress.push(args) });

    assert.deepEqual(progress, [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]);
  });

  test(`${dir}：重試中的圖片不算載入完成`, async () => {
    const { preloadImages } = await loadAssets(dir);
    fakeImages((url, attempt) => (url.endsWith('cat.png') && attempt === 0 ? 'error' : 'load'));
    const progress = [];

    await preloadImages(MANIFEST, BASE, { ...FAST, onProgress: (loaded) => progress.push(loaded) });

    assert.deepEqual(progress, [0, 1, 2, 3, 4]);
  });

  test(`${dir}：一張圖確定失敗後，其他圖晚點載完也不再回報進度（不能蓋掉錯誤畫面）`, async () => {
    const { preloadImages } = await loadAssets(dir);
    // cat 立刻失敗；其他圖等 cat 失敗後才載完。
    const pending = [];
    globalThis.Image = class {
      set src(url) {
        if (!url) return;
        if (url.includes('cat.png')) setTimeout(() => this.onerror?.(), 1);
        else pending.push(() => this.onload?.());
      }
      decode() { return Promise.resolve(); }
    };
    const progress = [];

    await assert.rejects(preloadImages(MANIFEST, BASE, { ...FAST, onProgress: (loaded) => progress.push(loaded) }));
    pending.forEach((load) => load());
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.deepEqual(progress, [0]);
  });

  // 重試

  test(`${dir}：第一次載入失敗會自動重試，重試成功就繼續`, async () => {
    const { preloadImages } = await loadAssets(dir);
    const requests = fakeImages((url, attempt) => (url.endsWith('dog.png') && attempt === 0 ? 'error' : 'load'));

    const images = await preloadImages(MANIFEST, BASE, FAST);

    assert.equal(images.size, 4);
    assert.equal(requests.filter((url) => url.includes('dog.png')).length, 2);
  });

  test(`${dir}：第一次卡住（逾時）會自動重試`, async () => {
    const { preloadImages } = await loadAssets(dir);
    fakeImages((url, attempt) => (url.endsWith('bg.png') && attempt === 0 ? 'hang' : 'load'));

    const images = await preloadImages(MANIFEST, BASE, FAST);

    assert.equal(images.size, 4);
  });

  test(`${dir}：重試的網址加上 retry 參數，不沿用卡住的請求`, async () => {
    const { preloadImages } = await loadAssets(dir);
    const requests = fakeImages((url, attempt) => (url.endsWith('cat.png') && attempt === 0 ? 'hang' : 'load'));

    await preloadImages(MANIFEST, BASE, FAST);

    const cat = requests.filter((url) => url.includes('cat.png'));
    assert.deepEqual(cat, [
      'https://example.test/DCCS_single/assets/cat.png',
      'https://example.test/DCCS_single/assets/cat.png?retry=1',
    ]);
  });

  test(`${dir}：retries: 0 時不重試`, async () => {
    const { preloadImages } = await loadAssets(dir);
    const requests = fakeImages((url) => (url.endsWith('cat.png') ? 'error' : 'load'));

    await assert.rejects(preloadImages(MANIFEST, BASE, { ...FAST, retries: 0 }));
    assert.equal(requests.filter((url) => url.includes('cat.png')).length, 1);
  });

  // 失敗

  test(`${dir}：重試後仍失敗，reject 給學生看的中文訊息，detail 記錄檔名`, async () => {
    const { preloadImages, AssetLoadError } = await loadAssets(dir);
    fakeImages((url) => (url.endsWith('circle.png') ? 'error' : 'load'));

    await assert.rejects(preloadImages(MANIFEST, BASE, FAST), (error) => {
      assert.ok(error instanceof AssetLoadError);
      assert.match(error.message, /圖片載入失敗/);
      assert.match(error.message, /重新載入/);
      assert.match(error.detail, /circle\.png\?retry=1/);
      assert.equal(error.timedOut, false);
      return true;
    });
  });

  test(`${dir}：一直卡住的圖片在逾時後 reject，不會永遠停在載入中`, async () => {
    const { preloadImages } = await loadAssets(dir);
    fakeImages((url) => (url.endsWith('dog.png') ? 'hang' : 'load'));
    const started = Date.now();

    await assert.rejects(preloadImages(MANIFEST, BASE, FAST), (error) => {
      assert.equal(error.timedOut, true);
      assert.match(error.detail, /timed out/);
      return true;
    });
    // 兩次各等 30ms，加上誤差。
    assert.ok(Date.now() - started < 1000);
  });

  test(`${dir}：逾時後才到的 onload 不會讓已 reject 的請求又 resolve`, async () => {
    const { preloadImages } = await loadAssets(dir);
    const late = [];
    globalThis.Image = class {
      set src(url) {
        if (!url) return;
        late.push(this);
      }
      decode() { return Promise.resolve(); }
    };

    const pending = preloadImages({ backgrounds: { bg: 'bg.png' } }, BASE, { timeoutMs: 10, retries: 0 });
    await assert.rejects(pending);
    // 逾時時 handler 已清掉；就算瀏覽器之後才觸發 onload 也不會出錯。
    assert.equal(late[0].onload, null);
  });

  test(`${dir}：decode() 永遠不 settle（分頁不可見）時，逾時後仍當成載入成功`, async () => {
    const { preloadImages } = await loadAssets(dir);
    globalThis.Image = class {
      set src(url) { if (url) setTimeout(() => this.onload?.(), 1); }
      decode() { return new Promise(() => {}); }
    };

    const images = await preloadImages(MANIFEST, BASE, FAST);

    assert.equal(images.size, 4);
  });

  test(`${dir}：decode() 失敗時仍當成載入成功`, async () => {
    const { preloadImages } = await loadAssets(dir);
    globalThis.Image = class {
      set src(url) { if (url) setTimeout(() => this.onload?.(), 1); }
      decode() { return Promise.reject(new Error('EncodingError')); }
    };

    const images = await preloadImages(MANIFEST, BASE, FAST);

    assert.equal(images.size, 4);
  });

  // manifest

  test(`${dir}：loadManifest 成功回傳 JSON`, async () => {
    const { loadManifest } = await loadAssets(dir);
    fakeFetch(() => ({ shapes: [] }));

    assert.deepEqual(await loadManifest('manifest.json', FAST), { shapes: [] });
  });

  test(`${dir}：loadManifest 第一次失敗會重試`, async () => {
    const { loadManifest } = await loadAssets(dir);
    const calls = fakeFetch((index) => (index === 0 ? 'error' : { ok: 1 }));

    assert.deepEqual(await loadManifest('manifest.json', FAST), { ok: 1 });
    assert.equal(calls.length, 2);
  });

  test(`${dir}：loadManifest 卡住時逾時並重試，仍卡住就 reject`, async () => {
    const { loadManifest, AssetLoadError } = await loadAssets(dir);
    const calls = fakeFetch(() => 'hang');

    await assert.rejects(loadManifest('manifest.json', FAST), (error) => {
      assert.ok(error instanceof AssetLoadError);
      assert.equal(error.timedOut, true);
      return true;
    });
    assert.equal(calls.length, 2);
  });

  test(`${dir}：loadManifest 遇到 HTTP 錯誤，detail 帶狀態碼`, async () => {
    const { loadManifest } = await loadAssets(dir);
    fakeFetch(() => 404);

    await assert.rejects(loadManifest('manifest.json', FAST), (error) => {
      assert.match(error.detail, /404/);
      assert.match(error.message, /圖片載入失敗/);
      return true;
    });
  });
}
