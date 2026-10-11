import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const siteRoot = process.env.SITE_ROOT
  ? path.resolve(process.env.SITE_ROOT)
  : path.resolve(import.meta.dirname, '../..');
const scriptPath = path.join(siteRoot, 'shared/dat-assets.js');
const defaults = ['assets/animals/rabbit.png', 'assets/animals/cat.png'];
const apiUrl = 'https://assets.example/api/students/S001/assets';

function harness(fetchImpl = async () => ({ ok: true, json: async () => ({}) }), extra = {}) {
  let nextTimer = 0;
  const timers = new Map();
  const images = [];
  class ControlledImage {
    constructor() { images.push(this); }
    emit(type) { this[`on${type}`]?.(); }
  }
  const context = vm.createContext({
    window: {}, URL, AbortController, fetch: fetchImpl, Image: ControlledImage,
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    ...extra,
  });
  // Missing production code must fail on its missing API, not a file-read error.
  const source = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
  vm.runInContext(source, context, { filename: scriptPath });
  assert.ok(context.window.DatAssets, 'shared script must expose window.DatAssets');
  return {
    ...context.window.DatAssets, images, timers,
    expire() { for (const fn of [...timers.values()]) fn(); },
  };
}

function response(files) {
  return { ok: true, json: async () => ({ DAT: { assets: { files } } }) };
}

test('素材清單只接受網址字串，並從 API origin 解析相對路徑', async () => {
  const assets = harness(async () => response([
    ' /animal/rabbit.png ', 'animal/cat.png', 'https://cdn.example/dog.png',
    'http://cdn.example/bird.png', null, {}, 42, '', '  ',
    'javascript:alert(1)', 'data:image/png;base64,abc', 'ftp://example/image.png', 'https://',
  ]));
  assert.deepEqual(Array.from(await assets.fetchAssetList(apiUrl, defaults)), [
    'https://assets.example/animal/rabbit.png', 'https://assets.example/animal/cat.png',
    'https://cdn.example/dog.png', 'http://cdn.example/bird.png',
  ]);
  assert.equal(assets.timers.size, 0);
});

test('無素材回預設清單拷貝，單張素材補預設清單', async () => {
  for (const files of [undefined, null, [], {}, [null, '']]) {
    const assets = harness(async () => response(files));
    const result = await assets.fetchAssetList(apiUrl, defaults);
    assert.deepEqual(Array.from(result), defaults);
    assert.notEqual(result, defaults);
  }
  const assets = harness(async () => response(['/animal/custom.png']));
  assert.deepEqual(Array.from(await assets.fetchAssetList(apiUrl, defaults)), [
    'https://assets.example/animal/custom.png', ...defaults,
  ]);
  const sameDefault = harness(async () => response(['https://cdn.example/rabbit.png']));
  assert.deepEqual(Array.from(await sameDefault.fetchAssetList(apiUrl, [
    'https://cdn.example/rabbit.png', 'assets/animals/cat.png',
  ])), ['https://cdn.example/rabbit.png', 'assets/animals/cat.png']);
});

test('HTTP 錯誤、壞 JSON 與斷線皆回預設清單並清理期限', async () => {
  const failures = [
    async () => ({ ok: false, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }),
    async () => { throw new TypeError('offline'); },
  ];
  for (const fetchImpl of failures) {
    const assets = harness(fetchImpl);
    assert.deepEqual(Array.from(await assets.fetchAssetList(apiUrl, defaults)), defaults);
    assert.equal(assets.timers.size, 0);
  }
});

test('請求逾時會回預設素材並 abort，不依賴 fetch 遵從 abort', async () => {
  let signal;
  const assets = harness((_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  const result = assets.fetchAssetList(apiUrl, defaults, 20);
  await Promise.resolve();
  assets.expire();
  assert.deepEqual(Array.from(await result), defaults);
  assert.equal(signal.aborted, true);
  assert.equal(assets.timers.size, 0);
});

test('逾時期限涵蓋 response.json，晚到的 body 不會更換回退結果', async () => {
  let finishBody;
  const assets = harness(async () => ({
    ok: true, json: () => new Promise((resolve) => { finishBody = resolve; }),
  }));
  const result = assets.fetchAssetList(apiUrl, defaults, 20);
  await Promise.resolve();
  await Promise.resolve();
  assets.expire();
  assert.deepEqual(Array.from(await result), defaults);
  finishBody({ DAT: { assets: { files: ['/late.png'] } } });
  await Promise.resolve();
  assert.equal(assets.timers.size, 0);
});

test('圖片預載成功回原網址，失敗與逾時回備援並移除 timer 和 listener', async () => {
  for (const outcome of ['load', 'error', 'timeout']) {
    const assets = harness();
    const result = assets.loadImage('https://cdn.example/animal.png', 'fallback.png', 20);
    assert.equal(assets.images[0].src, 'https://cdn.example/animal.png');
    if (outcome === 'timeout') assets.expire();
    else assets.images[0].emit(outcome);
    assert.equal(await result, outcome === 'load' ? 'https://cdn.example/animal.png' : 'fallback.png');
    assert.equal(assets.timers.size, 0);
    assert.equal(assets.images[0].onload, null);
    assert.equal(assets.images[0].onerror, null);
    assets.images[0].emit('load');
  }
});

test('setImage 套用預載結果，同一元素的新指派取消舊預載', async () => {
  const assets = harness();
  const element = { src: 'initial.png' };
  const first = assets.setImage(element, 'old.png');
  const oldLoad = assets.images[0].onload;
  const second = assets.setImage(element, 'new.png');
  assert.equal(assets.timers.size, 1);
  assert.equal(assets.images[0].onload, null);
  assert.equal(assets.images[0].onerror, null);
  assets.images[1].emit('load');
  assert.equal(await second, 'new.png');
  oldLoad();
  await first;
  assert.equal(element.src, 'new.png');
  assert.equal(assets.timers.size, 0);
});

test('setImage 的世代按元素獨立，圖片失敗只替換該元素', async () => {
  const assets = harness();
  const firstElement = { src: 'first.png' };
  const secondElement = { src: 'second.png' };
  const first = assets.setImage(firstElement, 'first-new.png', 'first-fallback.png');
  const second = assets.setImage(secondElement, 'second-new.png');
  assets.images[1].emit('load');
  assets.images[0].emit('error');
  assert.equal(await first, 'first-fallback.png');
  assert.equal(await second, 'second-new.png');
  assert.equal(firstElement.src, 'first-fallback.png');
  assert.equal(secondElement.src, 'second-new.png');
});

// R6：跨來源上傳圖要以 CORS 載入，命中遮罩才讀得到透明度；伺服器不給 CORS 時仍要顯示圖片。
function pageHarness() {
  return harness(undefined, {
    location: { origin: 'http://game.example' },
    document: { baseURI: 'http://game.example/DAT_single/DAT_single.html' },
  });
}

// 記錄 crossOrigin 與 src 的設定順序：crossOrigin 要先設，否則已用非 CORS 方式開始載入
function recordingElement() {
  const log = [];
  return {
    log,
    get crossOrigin() { return this._crossOrigin ?? null; },
    set crossOrigin(value) { log.push(['crossOrigin', value]); this._crossOrigin = value; },
    get src() { return this._src; },
    set src(value) { log.push(['src', value]); this._src = value; },
  };
}

test('跨來源圖片先設 crossOrigin=anonymous 再設 src，畫面元素用同樣的 CORS 模式（R6）', async () => {
  const assets = pageHarness();
  const element = recordingElement();
  const result = assets.setImage(element, 'https://assets.example/uploads/cat.png', 'fallback.png');
  assert.equal(assets.images.length, 1);
  assert.equal(assets.images[0].crossOrigin, 'anonymous');
  assets.images[0].emit('load');
  assert.equal(await result, 'https://assets.example/uploads/cat.png');
  assert.deepEqual(element.log, [['crossOrigin', 'anonymous'], ['src', 'https://assets.example/uploads/cat.png']]);
  assert.equal(assets.timers.size, 0);
});

test('同源圖片不設 crossOrigin，畫面元素原本的 crossOrigin 會拿掉（R6）', async () => {
  const assets = pageHarness();
  const element = recordingElement();
  element._crossOrigin = 'anonymous';
  const result = assets.setImage(element, 'assets/animals/dog.png', 'fallback.png');
  assert.equal(assets.images[0].crossOrigin, undefined);
  assets.images[0].emit('load');
  assert.equal(await result, 'assets/animals/dog.png');
  assert.deepEqual(element.log, [['crossOrigin', null], ['src', 'assets/animals/dog.png']]);
});

test('CORS 載入失敗時改用一般載入仍顯示原圖，畫面元素不帶 crossOrigin（R6）', async () => {
  const assets = pageHarness();
  const element = recordingElement();
  const src = 'https://cdn.example/no-cors.png';
  const result = assets.setImage(element, src, 'fallback.png');
  assets.images[0].emit('error');
  assert.equal(assets.images.length, 2, '再試一次一般載入');
  assert.equal(assets.images[0].onload, null);
  assert.equal(assets.images[1].crossOrigin, undefined);
  assert.equal(assets.images[1].src, src);
  assets.images[1].emit('load');
  assert.equal(await result, src);
  assert.deepEqual(element.log, [['src', src]]);
  assert.equal(assets.timers.size, 0);
  // 之後同一張圖直接用一般載入，不再先失敗一次
  const again = assets.loadImage(src, 'fallback.png');
  assert.equal(assets.images[2].crossOrigin, undefined);
  assets.images[2].emit('load');
  assert.equal(await again, src);
});

test('CORS 與一般載入都失敗才回備援圖，逾時仍有效（R6）', async () => {
  const assets = pageHarness();
  const failed = assets.loadImage('https://cdn.example/missing.png', 'fallback.png');
  assets.images[0].emit('error');
  assets.images[1].emit('error');
  assert.equal(await failed, 'fallback.png');
  assert.equal(assets.timers.size, 0);
  assert.equal(assets.images[1].onerror, null);

  const slow = assets.loadImage('https://cdn.example/slow.png', 'fallback.png', 20);
  assets.expire();
  assert.equal(await slow, 'fallback.png');
  assert.equal(assets.images[2].onload, null);
});
