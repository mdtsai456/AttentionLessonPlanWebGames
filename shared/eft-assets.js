export const ASSET_EMPTY_BUBBLE = 'assets/arrow/空泡泡.png';
export const ASSET_TARGET_BUBBLE = 'assets/arrow/目標泡泡.png';
export const ASSET_OPPOSITE_HINT = 'assets/arrow/反向提示.png';

export const DEFAULT_ARROW_STYLE = Object.freeze([
    'assets/arrow/箭頭00.png',
    'assets/arrow/箭頭01.png',
    'assets/arrow/箭頭02.png',
    'assets/arrow/箭頭03.png',
]);

const ASSET_API_HOST = 'https://attention-lesson-plan-assets.zeabur.app';
// 素材 API 或圖片卡住時最多等 5 秒（同 shared/dat-assets.js），之後改用內建箭頭。
const ASSET_TIMEOUT_MS = 5000;
const arrowAssetRequests = new Map();

export function normalizeAssetStudentId(rawId) {
    const id = String(rawId || '').trim();
    const caseId = id.includes('_') ? id.split('_').pop() : id;
    const match = /^([A-Za-z]+)(\d+)$/.exec(caseId);
    if (!match) return caseId || 'S001';
    return `${match[1].toUpperCase()}${String(Number(match[2])).padStart(3, '0')}`;
}

function defaultArrowAssets() {
    return [...DEFAULT_ARROW_STYLE];
}

export function getArrowAssets(studentId = 'S001') {
    const normalizedStudentId = normalizeAssetStudentId(studentId);
    const cachedRequest = arrowAssetRequests.get(normalizedStudentId);
    if (cachedRequest) return cachedRequest;

    const controller = new AbortController();
    let timer;
    const deadline = new Promise((resolve) => {
        timer = setTimeout(() => {
            resolve(defaultArrowAssets());
            controller.abort();
        }, ASSET_TIMEOUT_MS);
    });
    const fetchAssets = (async () => {
        try {
            const response = await fetch(
                `${ASSET_API_HOST}/api/students/${encodeURIComponent(normalizedStudentId)}/assets`,
                { signal: controller.signal }
            );
            if (!response.ok) return defaultArrowAssets();

            const jsonData = await response.json();
            const files = jsonData?.EFT?.assets?.files;
            const arrowAssets = Array.isArray(files)
                ? files.filter((file) => typeof file === 'string' && file.trim()).map((file) => file.trim())
                : [];
            return arrowAssets.length
                ? [DEFAULT_ARROW_STYLE[0], ...arrowAssets]
                : defaultArrowAssets();
        } catch {
            return defaultArrowAssets();
        }
    })();
    const request = Promise.race([fetchAssets, deadline]).finally(() => clearTimeout(timer));

    arrowAssetRequests.set(normalizedStudentId, request);
    return request;
}

export function getArrowPlaceholderPath(index, arrowAssets = DEFAULT_ARROW_STYLE) {
    const assets = arrowAssets.length ? arrowAssets : DEFAULT_ARROW_STYLE;
    return assets[index % assets.length];
}

export async function getEftAssetPaths({ backgroundAssets = [], studentId = 'S001', arrowAssets } = {}) {
    const availableArrowAssets = arrowAssets || await getArrowAssets(studentId);
    const paths = [
        ...backgroundAssets,
        ASSET_EMPTY_BUBBLE,
        ASSET_TARGET_BUBBLE,
        ASSET_OPPOSITE_HINT,
        ...availableArrowAssets,
    ];

    return [...new Set(paths)];
}

// 載入失敗會 reject；超過時間也 reject，並標記 timedOut。
function preloadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const finish = (callback, value) => {
            clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            callback(value);
        };
        const timer = setTimeout(() => {
            finish(reject, Object.assign(new Error(`圖片載入逾時：${src}`), { timedOut: true }));
        }, ASSET_TIMEOUT_MS);
        image.onload = () => finish(resolve);
        image.onerror = () => finish(reject, new Error(`圖片載入失敗：${src}`));
        image.src = src;
    });
}

// 本機圖只是慢就不擋開局（瀏覽器會繼續載入）；真的載入失敗才 reject。
async function preloadLocalImage(src) {
    try {
        await preloadImage(src);
    } catch (error) {
        if (!error.timedOut) throw error;
        console.warn(error.message);
    }
}

async function preloadArrowAssets(arrowAssets) {
    return Promise.all(arrowAssets.map(async (src, index) => {
        const fallback = getArrowPlaceholderPath(index);
        if (src === fallback) {
            await preloadLocalImage(src);
            return src;
        }
        try {
            await preloadImage(src);
            return src;
        } catch {
            await preloadLocalImage(fallback);
            return fallback;
        }
    }));
}

export async function preloadEftAssets(options = {}) {
    const arrowAssets = await getArrowAssets(options.studentId);
    const loadedArrowAssets = await preloadArrowAssets(arrowAssets);
    const assetPaths = await getEftAssetPaths({ ...options, arrowAssets: loadedArrowAssets });
    const arrowAssetSet = new Set(loadedArrowAssets);
    await Promise.all(assetPaths
        .filter((src) => !arrowAssetSet.has(src))
        .map((src) => preloadLocalImage(src)));
    return loadedArrowAssets;
}