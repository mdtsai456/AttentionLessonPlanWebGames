// 載入 manifest 並預載圖片（SPEC 4.4）。素材網址皆相對於 assetBase。
//
// 每個請求都有逾時，失敗會自動重試一次：連線停住時 onload／onerror 都不會觸發，
// 沒有逾時的話畫面會永遠停在「載入中」。重試後仍失敗才 reject，由畫面顯示重試按鈕。

// 正常情況 21 張圖約 4 秒載完；單張等 15 秒仍沒回應，視為連線卡住。
export const IMAGE_TIMEOUT_MS = 15000;
export const MANIFEST_TIMEOUT_MS = 10000;
// 失敗後再試的次數。
export const RETRIES = 1;

/** 載入失敗的錯誤。message 給學生看，detail 記錄是哪個檔案，方便除錯。 */
export class AssetLoadError extends Error {
  constructor(detail, { timedOut = false } = {}) {
    super('圖片載入失敗，請確認網路連線後按「重新載入」。');
    this.name = 'AssetLoadError';
    this.detail = detail;
    this.timedOut = timedOut;
  }
}

/** 執行 attempt；失敗時再試 retries 次。attempt 收到第幾次（0 起算）。 */
async function withRetry(attempt, retries) {
  let lastError;
  for (let tryIndex = 0; tryIndex <= retries; tryIndex += 1) {
    try {
      return await attempt(tryIndex);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function loadManifest(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? MANIFEST_TIMEOUT_MS;
  const retries = options.retries ?? RETRIES;
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new AssetLoadError(`loadManifest: failed to fetch ${url} (${res.status})`);
      }
      return await res.json();
    } catch (error) {
      if (error instanceof AssetLoadError) throw error;
      throw new AssetLoadError(`loadManifest: failed to fetch ${url} (${error.message})`, {
        timedOut: controller.signal.aborted,
      });
    } finally {
      clearTimeout(timer);
    }
  }, retries);
}

/**
 * 載入一張圖。逾時或失敗都 reject；逾時時清掉 src，讓瀏覽器放棄這個請求。
 * onload 之後還要等 decode()，但 decode() 在分頁不可見時可能永遠不 settle（SPEC 4.4）：
 * 計時器繼續跑，到時 decode() 還沒好就直接當成載入成功，不能卡在這一步。
 */
function loadOneImage(id, url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let loaded = false;
    let settled = false;
    const timer = setTimeout(() => {
      if (loaded) {
        done();
        return;
      }
      settled = true;
      clearHandlers();
      img.src = '';
      reject(new AssetLoadError(`preloadImages: timed out loading "${url}" (id: ${id})`, { timedOut: true }));
    }, timeoutMs);

    function clearHandlers() {
      img.onload = null;
      img.onerror = null;
    }

    function done() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve([id, img]);
    }

    img.onload = () => {
      if (settled) return;
      loaded = true;
      clearHandlers();
      if (img.decode) {
        // onload 成功時，decode() 失敗也視為圖片可用，以支援 decode() 失敗的瀏覽器。
        img.decode().then(done, done);
      } else {
        done();
      }
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearHandlers();
      reject(new AssetLoadError(`preloadImages: failed to load "${url}" (id: ${id})`));
    };
    img.src = url;
  });
}

/** 重試時加上 retry 參數，避免瀏覽器沿用剛才卡住的同一個請求。 */
function retryUrl(url, tryIndex) {
  if (tryIndex === 0) return url;
  const next = new URL(url);
  next.searchParams.set('retry', String(tryIndex));
  return next.href;
}

/** 列出 manifest 中所有要預載的圖片：背景、shapes 與各 categories 的 images。 */
function listImages(manifest) {
  const list = [];
  if (manifest.backgrounds) {
    for (const [id, src] of Object.entries(manifest.backgrounds)) list.push({ id, src });
  }
  if (Array.isArray(manifest.shapes)) {
    for (const shape of manifest.shapes) list.push({ id: shape.id, src: shape.src });
  }
  if (Array.isArray(manifest.categories)) {
    for (const category of manifest.categories) {
      for (const image of category.images) list.push({ id: image.id, src: image.src });
    }
  }
  return list;
}

/**
 * 載入 manifest 中的所有圖片，全部 decode() 完成後才 resolve。
 * 每張圖逾時或失敗會重試；重試後仍失敗就 reject AssetLoadError。
 * @param {object} manifest
 * @param {string | URL} assetBase manifest 相對素材路徑的基準網址
 * @param {{ timeoutMs?: number, retries?: number,
 *           onProgress?: (loaded: number, total: number) => void }} [options]
 * @returns {Promise<Map<string, HTMLImageElement>>}
 */
export async function preloadImages(manifest, assetBase, options = {}) {
  const timeoutMs = options.timeoutMs ?? IMAGE_TIMEOUT_MS;
  const retries = options.retries ?? RETRIES;
  const onProgress = options.onProgress || (() => {});
  const images = listImages(manifest);
  let loaded = 0;
  // 有一張圖確定失敗後，Promise.all 已經 reject，但其他圖仍會陸續載完；
  // 這時不能再回報進度，否則畫面會從錯誤畫面切回「載入中」，蓋掉重新載入按鈕。
  let failed = false;
  onProgress(loaded, images.length);

  const entries = await Promise.all(images.map(async ({ id, src }) => {
    const url = new URL(src, assetBase).href;
    try {
      const entry = await withRetry(
        (tryIndex) => loadOneImage(id, retryUrl(url, tryIndex), timeoutMs),
        retries
      );
      loaded += 1;
      if (!failed) onProgress(loaded, images.length);
      return entry;
    } catch (error) {
      failed = true;
      throw error;
    }
  }));
  return new Map(entries);
}
