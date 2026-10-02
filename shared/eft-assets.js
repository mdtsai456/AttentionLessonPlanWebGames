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

    const request = (async () => {
        try {
            const response = await fetch(
                `${ASSET_API_HOST}/api/students/${encodeURIComponent(normalizedStudentId)}/assets`
            );
            if (!response.ok) return defaultArrowAssets();

            const jsonData = await response.json();
            const files = jsonData?.EFT?.assets?.files;
            const arrowAssets = Array.isArray(files)
                ? files.filter((file) => typeof file === 'string' && file.trim()).map((file) => file.trim())
                : [];
            return arrowAssets.length ? arrowAssets : defaultArrowAssets();
        } catch {
            return defaultArrowAssets();
        }
    })();

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

function preloadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = reject;
        image.src = src;
    });
}

async function preloadArrowAssets(arrowAssets) {
    return Promise.all(arrowAssets.map(async (src, index) => {
        try {
            await preloadImage(src);
            return src;
        } catch {
            const fallback = getArrowPlaceholderPath(index);
            if (src === fallback) throw new Error(`箭頭素材載入失敗：${src}`);
            await preloadImage(fallback);
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
        .map((src) => preloadImage(src)));
    return loadedArrowAssets;
}