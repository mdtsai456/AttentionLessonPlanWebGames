// Manifest 載入與圖片預載（SPEC 4.4）。資產網址一律相對於 assetBase。

export async function loadManifest(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`loadManifest: failed to fetch ${url} (${res.status})`);
  }
  return res.json();
}

function loadOneImage(id, src, assetBase) {
  const resolvedUrl = new URL(src, assetBase).href;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.decode) {
        img.decode().then(
          () => resolve([id, img]),
          () => resolve([id, img]) // onload 成功即視為可用，兼容 decode() 失敗的瀏覽器
        );
      } else {
        resolve([id, img]);
      }
    };
    img.onerror = () => {
      reject(new Error(`preloadImages: failed to load "${resolvedUrl}" (id: ${id})`));
    };
    img.src = resolvedUrl;
  });
}

/**
 * 載入 manifest 內所有圖片（背景、shapes、所有 categories 的 images）。
 * 全部 decode() 完成後才 resolve。任何一張失敗即 reject 並指出檔名。
 * @param {object} manifest
 * @param {string | URL} assetBase manifest 相對資產路徑的基準網址
 * @returns {Promise<Map<string, HTMLImageElement>>}
 */
export async function preloadImages(manifest, assetBase) {
  const jobs = [];

  if (manifest.backgrounds) {
    for (const [key, src] of Object.entries(manifest.backgrounds)) {
      jobs.push(loadOneImage(key, src, assetBase));
    }
  }

  if (Array.isArray(manifest.shapes)) {
    for (const shape of manifest.shapes) {
      jobs.push(loadOneImage(shape.id, shape.src, assetBase));
    }
  }

  if (Array.isArray(manifest.categories)) {
    for (const category of manifest.categories) {
      for (const image of category.images) {
        jobs.push(loadOneImage(image.id, image.src, assetBase));
      }
    }
  }

  const entries = await Promise.all(jobs);
  return new Map(entries);
}
