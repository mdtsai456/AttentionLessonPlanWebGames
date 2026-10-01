import { EFT_ARROW_STYLES } from './eft-game-logic.js';

export function getArrowPlaceholderPath(style) {
    return `assets/arrow/箭頭${String(style).padStart(2, '0')}.PNG`;
}

export function getOppositeHintPath() {
    return 'assets/arrow/反向提示.PNG';
}

export function getEftAssetPaths({ includeBackground = false } = {}) {
    const paths = [
        ...(includeBackground ? ['assets/background.png'] : []),
        'assets/arrow/目標泡泡.png',
        'assets/arrow/空泡泡.png',
        ...EFT_ARROW_STYLES.map((style, index) => getArrowPlaceholderPath(index)),
        getOppositeHintPath(),
    ];

    for (const style of EFT_ARROW_STYLES) {
        for (const offset of [2, 3]) {
            paths.push(`assets/arrow/IMG_${style.normal + offset}.PNG`);
            paths.push(`assets/opposite_arrow/IMG_${style.opposite + offset}.PNG`);
        }
    }

    return paths;
}

export function preloadEftAssets(options) {
    return Promise.all(getEftAssetPaths(options).map((src) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = reject;
        image.src = src;
    })));
}