import { EFT_ARROW_STYLES } from './eft-game-logic.js';

export const ASSET_EMPTY_BUBBLE = 'assets/arrow/空泡泡.png';
export const ASSET_TARGET_BUBBLE = 'assets/arrow/目標泡泡.png';
export const ASSET_OPPOSITE_HINT = 'assets/arrow/反向提示.PNG';

const DEFAULT_ARROW_STYLE = [
    "assets/arrow/箭頭00.png",
    "assets/arrow/箭頭01.png",
    "assets/arrow/箭頭02.png",
    "assets/arrow/箭頭03.png",
];

export async function getArrowAssets() {
    if (getArrowAssets.fetchResult)
        return getArrowAssets.fetchResult;

    return getArrowAssets.fetchResult = DEFAULT_ARROW_STYLE;
} 

getArrowAssets.fetchResult = undefined;

export function getArrowPlaceholderPath(index) {
    return getArrowAssets.fetchResult?.[index] ?? DEFAULT_ARROW_STYLE[index];
}

export async function getEftAssetPaths({ backgroundAssets = [] } = {}) {
    const paths = [
        ...backgroundAssets,
        ASSET_EMPTY_BUBBLE,
        ASSET_TARGET_BUBBLE,
        ASSET_OPPOSITE_HINT,
        ...await getArrowAssets(),
    ];

    return paths;
}

export async function preloadEftAssets(options) {
    const assetPaths = await getEftAssetPaths(options);
    return Promise.all(assetPaths.map((src) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = reject;
        image.src = src;
    })));
}