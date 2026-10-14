(function () {
  'use strict';

  const pendingImageLoads = new WeakMap();
  const elementLoads = new WeakMap();

  async function fetchAssetList(apiUrl, defaults, timeoutMs = 5000) {
    const fallback = [...defaults];
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve(fallback);
        controller.abort();
      }, timeoutMs);
    });
    const request = (async () => {
      try {
        const response = await fetch(apiUrl, { signal: controller.signal });
        if (!response.ok) return fallback;
        const data = await response.json();
        const files = data?.DAT?.assets?.files;
        const base = `${new URL(apiUrl).origin}/`;
        const assets = Array.isArray(files) ? files.flatMap((file) => {
          if (typeof file !== 'string' || !file.trim()) return [];
          try {
            const url = new URL(file.trim(), base);
            return ['http:', 'https:'].includes(url.protocol) ? [url.href] : [];
          } catch {
            return [];
          }
        }) : [];
        if (!assets.length) return fallback;
        return assets.length === 1
          ? [...assets, ...fallback.filter((file) => file !== assets[0])]
          : assets;
      } catch {
        return fallback;
      }
    })();
    try {
      return await Promise.race([request, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  // 跨來源圖片（素材伺服器的上傳圖）以 CORS 載入，命中遮罩才能用 canvas 讀透明度；
  // 素材伺服器有回 Access-Control-Allow-Origin: *。伺服器不給 CORS 時改用一般載入，
  // 圖片照常顯示，命中判定退回只用中央圓。
  const noCorsSources = new Set();

  function isCrossOrigin(src) {
    if (typeof location === 'undefined' || typeof document === 'undefined') return false;
    try {
      const url = new URL(src, document.baseURI);
      return ['http:', 'https:'].includes(url.protocol) && url.origin !== location.origin;
    } catch {
      return false;
    }
  }

  function corsMode(src) {
    return isCrossOrigin(src) && !noCorsSources.has(src) ? 'anonymous' : null;
  }

  function loadImage(src, fallback = 'assets/animals/rabbit.png', timeoutMs = 5000) {
    let cancel;
    const promise = new Promise((resolve) => {
      let image = null;
      let settled = false;
      const detach = () => {
        if (!image) return;
        image.onload = null;
        image.onerror = null;
      };
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        detach();
        resolve(result);
      };
      const attempt = (crossOrigin) => {
        detach();
        image = new Image();
        // crossOrigin 要在 src 之前設定，否則已經以非 CORS 方式開始載入。
        if (crossOrigin) image.crossOrigin = crossOrigin;
        image.onload = () => {
          if (!crossOrigin && isCrossOrigin(src)) noCorsSources.add(src);
          finish(src);
        };
        // CORS 載入失敗（伺服器沒給 CORS 標頭或真的載入失敗）時，再試一次一般載入。
        image.onerror = () => (crossOrigin ? attempt(null) : finish(fallback));
        try {
          image.src = src;
        } catch {
          finish(fallback);
        }
      };
      const timer = setTimeout(() => finish(fallback), timeoutMs);
      cancel = () => finish(fallback);
      attempt(corsMode(src));
    });
    pendingImageLoads.set(promise, cancel);
    promise.then(() => pendingImageLoads.delete(promise));
    return promise;
  }

  async function setImage(img, src, fallback = 'assets/animals/rabbit.png', timeoutMs = 5000) {
    elementLoads.get(img)?.cancel();
    const promise = loadImage(src, fallback, timeoutMs);
    const load = { cancel: pendingImageLoads.get(promise) };
    elementLoads.set(img, load);
    const result = await promise;
    if (elementLoads.get(img) === load) {
      // 畫面上的 <img> 用與預載相同的 CORS 模式，命中遮罩讀的就是畫面上這張圖。
      const crossOrigin = corsMode(result);
      if ((img.crossOrigin || null) !== crossOrigin) img.crossOrigin = crossOrigin;
      img.src = result;
      elementLoads.delete(img);
    }
    return result;
  }

  // 命中遮罩：128×128，與動物框（正方形、object-fit: contain）對齊。
  const MASK_SIZE = 128;
  const MASK_ALPHA = 128; // 與兔子遮罩取樣門檻一致：半透明以上才算動物本體
  const imageMasks = new Map();

  function isBundledRabbit(img) {
    return img.src === new URL('assets/animals/rabbit.png', document.baseURI).href;
  }

  // 由目前顯示的圖片透明度建立遮罩；跨來源未授權（canvas 被汙染）或尚未載入時回傳 null。
  function imageHitMask(img) {
    if (!img.complete || !img.naturalWidth || !img.naturalHeight) return null;
    // 同一網址以 CORS／非 CORS 載入時讀得到的像素不同，快取分開。
    const src = `${img.crossOrigin || ''} ${img.currentSrc || img.src}`;
    if (imageMasks.has(src)) return imageMasks.get(src);
    let mask = null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = MASK_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const scale = Math.min(MASK_SIZE / img.naturalWidth, MASK_SIZE / img.naturalHeight);
      const width = img.naturalWidth * scale;
      const height = img.naturalHeight * scale;
      ctx.drawImage(img, (MASK_SIZE - width) / 2, (MASK_SIZE - height) / 2, width, height);
      const pixels = ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
      mask = new Uint8Array(MASK_SIZE * MASK_SIZE);
      for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] >= MASK_ALPHA ? 1 : 0;
    } catch {
      mask = null;
    }
    imageMasks.set(src, mask);
    return mask;
  }

  // 準心是否在動物上：中央圓一律算命中；圓外依「目前顯示的圖片」的遮罩判定。
  // 內建兔子用預先取樣的 RABBIT_HIT_MASK；其他圖片讀不到透明度時只用中央圓，不退回兔子形狀。
  function isOnAnimal(field, animal, image, aim) {
    const fieldRect = field.getBoundingClientRect();
    const aimX = fieldRect.left + aim.x / 100 * fieldRect.width;
    const aimY = fieldRect.top + aim.y / 100 * fieldRect.height;
    const animalRect = animal.getBoundingClientRect();
    if (animalRect.width && animalRect.height) {
      const radius = Math.min(animalRect.width, animalRect.height) * 0.36;
      const centerX = animalRect.left + animalRect.width / 2;
      const centerY = animalRect.top + animalRect.height / 2;
      if (Math.hypot(aimX - centerX, aimY - centerY) <= radius) return true;
    }
    if (!image) return false;
    const rect = image.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    if (!size) return false;
    const left = rect.left + (rect.width - size) / 2;
    const top = rect.top + (rect.height - size) / 2;
    const x = Math.floor((aimX - left) / size * MASK_SIZE);
    const y = Math.floor((aimY - top) / size * MASK_SIZE);
    if (x < 0 || y < 0 || x >= MASK_SIZE || y >= MASK_SIZE) return false;
    if (isBundledRabbit(image)) {
      return typeof RABBIT_HIT_MASK !== 'undefined' && RABBIT_HIT_MASK[y][x] === '1'; // eslint-disable-line no-undef
    }
    const mask = imageHitMask(image);
    return Boolean(mask && mask[y * MASK_SIZE + x]);
  }

  window.DatAssets = { fetchAssetList, loadImage, setImage, isOnAnimal };
})();
