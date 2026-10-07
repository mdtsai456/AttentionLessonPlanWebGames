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

  function loadImage(src, fallback = 'assets/animals/rabbit.png', timeoutMs = 5000) {
    let cancel;
    const promise = new Promise((resolve) => {
      const image = new Image();
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        resolve(result);
      };
      const timer = setTimeout(() => finish(fallback), timeoutMs);
      image.onload = () => finish(src);
      image.onerror = () => finish(fallback);
      cancel = () => finish(fallback);
      try {
        image.src = src;
      } catch {
        finish(fallback);
      }
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
      img.src = result;
      elementLoads.delete(img);
    }
    return result;
  }

  window.DatAssets = { fetchAssetList, loadImage, setImage };
})();
