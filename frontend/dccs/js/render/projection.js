// SPEC 4.5 — 透視投影。純函式，無狀態，必須可在 Node 中單獨測試。

import { CONFIG } from '../config.js';

/**
 * 縮放係數。z=0（鏡頭處）時為 1，z 越大越接近 0。
 * @param {number} z 世界深度
 * @returns {number}
 */
export function scaleAt(z) {
  return CONFIG.CAM_DEPTH / (z + CONFIG.CAM_DEPTH);
}

/**
 * 由縮放係數反推世界深度 z（scaleAt 的反函式）。
 * @param {number} s 縮放係數 (0, 1]
 * @returns {number}
 */
export function zAtScale(s) {
  return CONFIG.CAM_DEPTH / s - CONFIG.CAM_DEPTH;
}

/**
 * 將世界座標 (z, lane) 投影到 viewport 內的螢幕座標。
 * @param {number} z 世界深度，0 = 鏡頭處，愈大愈遠
 * @param {number} lane 橫向座標，單位為「賽道半寬」，0 = 賽道正中
 * @param {{x:number,y:number,w:number,h:number}} viewport 畫布內的像素矩形
 * @returns {{x:number,y:number,scale:number,size:number}}
 */
export function project(z, lane, viewport) {
  const { x: vx, y: vy, w, h } = viewport;
  const s = scaleAt(z);

  const screenY = (CONFIG.VANISHING_Y + (CONFIG.BASE_Y - CONFIG.VANISHING_Y) * s) * h + vy;
  const screenX = CONFIG.ROAD_CX * w + lane * CONFIG.ROAD_HALF_W * w * s + vx;
  const size = CONFIG.SPRITE_BASE * s * h;

  return { x: screenX, y: screenY, scale: s, size };
}

/**
 * 目標物專用大小。閥門選項仍使用 project() 的線性透視；指數小於 1
 * 可提升遠處目標的辨識度。TARGET_PERSPECTIVE 為 1 時與 project() 相同。
 * @param {number} z 世界深度
 * @param {{x:number,y:number,w:number,h:number}} viewport
 * @returns {number}
 */
export function targetSizeAt(z, viewport) {
  return CONFIG.SPRITE_BASE * Math.pow(scaleAt(z), CONFIG.TARGET_PERSPECTIVE) * viewport.h;
}
