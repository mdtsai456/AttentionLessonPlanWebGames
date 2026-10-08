// SPEC 4.6 — 背景與 sprite 繪製。

import { project } from './projection.js';

const BG_NATIVE_W = 1672;
const BG_NATIVE_H = 941;

/**
 * 以 cover 方式（依寬度縮放、垂直靠上對齊）填滿 viewport，
 * 讓背景圖的地平線對齊 VANISHING_Y 所隱含的位置。
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} bgImage
 * @param {{x:number,y:number,w:number,h:number}} viewport
 */
export function drawBackground(ctx, bgImage, viewport) {
  const { x: vx, y: vy, w, h } = viewport;

  const scale = w / BG_NATIVE_W;
  const drawW = w;
  const drawH = BG_NATIVE_H * scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(vx, vy, w, h);
  ctx.clip();

  // 寬螢幕可能使背景高度不足，以底色補齊。
  if (drawH < h) {
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(vx, vy, w, h);
  }

  ctx.drawImage(bgImage, 0, 0, BG_NATIVE_W, BG_NATIVE_H, vx, vy, drawW, drawH);
  ctx.restore();
}

/**
 * 依 project() 的結果置中繪製 sprite。
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} image
 * @param {number} z
 * @param {number} lane
 * @param {{x:number,y:number,w:number,h:number}} viewport
 * @param {{ inner?: HTMLImageElement, size?: number }} [opts]
 */
export function drawSprite(ctx, image, z, lane, viewport, opts) {
  const { x, y, size: projectedSize } = project(z, lane, viewport);
  // opts.size 只覆寫尺寸；位置仍使用 project()。
  const size = opts && opts.size !== undefined ? opts.size : projectedSize;
  if (size <= 0 || !image) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(viewport.x, viewport.y, viewport.w, viewport.h);
  ctx.clip();

  drawFitCentered(ctx, image, x, y, size);

  if (opts && opts.inner) {
    drawFitCentered(ctx, opts.inner, x, y, size * 0.5);
  }

  ctx.restore();
}

function drawFitCentered(ctx, image, cx, cy, box) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;

  const aspect = iw / ih;
  let drawW = box;
  let drawH = box / aspect;
  if (drawH > box) {
    drawH = box;
    drawW = box * aspect;
  }

  ctx.drawImage(image, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
}
