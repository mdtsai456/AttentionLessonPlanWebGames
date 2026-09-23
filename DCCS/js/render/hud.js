// SPEC 4.7 — HUD 繪製。不使用外部字型，一律使用 system font stack。

import { CONFIG } from '../config.js';

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,w:number,h:number}} viewport
 * @param {{score:number, elapsed:number, total:number, level:number, showTick:boolean}} state
 */
export function drawHud(ctx, viewport, state) {
  const { x: vx, y: vy, w, h } = viewport;
  const { score = 0, elapsed = 0, total = 1, level = 0, showTick = false } = state || {};

  ctx.save();

  drawScorePill(ctx, vx, vy, w, h, score, level);
  drawVerticalTitleAndProgress(ctx, vx, vy, w, h, elapsed, total);
  if (showTick) {
    drawTick(ctx, vx, vy, w, h);
  }

  ctx.restore();
}

function drawScorePill(ctx, vx, vy, w, h, score, level) {
  const pillX = vx + 0.10 * w;
  const pillY = vy + 0.04 * h;
  const pillW = 0.30 * w;
  const pillH = 0.07 * h;
  const radius = pillH / 2;

  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#111111';
  roundRect(ctx, pillX, pillY, pillW, pillH, radius);
  ctx.fill();
  ctx.restore();

  // SCORE_BAR_FULL 是視覺滿格基準，不是分數上限。
  const barMargin = pillW * 0.05;
  const barX = pillX + barMargin;
  const barY = pillY + pillH * 0.62;
  const barW = pillW * 0.42;
  const barH = pillH * 0.16;
  const scoreRatio = Math.max(0, Math.min(1, score / CONFIG.SCORE_BAR_FULL));

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();
  ctx.fillStyle = '#4caf50';
  roundRect(ctx, barX, barY, Math.max(barH, barW * scoreRatio), barH, barH / 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(pillH * 0.4)}px ${FONT_STACK}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(`得分 ${score}`, pillX + barMargin, pillY + pillH * 0.32);
  ctx.restore();

  // 關卡總數由 manifest 決定，此處只顯示目前序號。
  if (level != null) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.round(pillH * 0.32)}px ${FONT_STACK}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(`第 ${level} 關`, pillX + pillW - barMargin, pillY + pillH * 0.32);
    ctx.restore();
  }
}

function drawVerticalTitleAndProgress(ctx, vx, vy, w, h, elapsed, total) {
  const barX = vx + 0.03 * w;
  const barY = vy + 0.14 * h;
  const barW = 0.018 * w;
  const barH = 0.72 * h;
  const ratio = total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 0;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  roundRect(ctx, barX, barY, barW, barH, barW / 2);
  ctx.fill();

  const fillH = barH * ratio;
  ctx.fillStyle = '#2196f3';
  roundRect(ctx, barX, barY + (barH - fillH), barW, fillH, barW / 2);
  ctx.fill();
  ctx.restore();

  // 直立標題：逐字往下排列於進度條左側
  const title = '賽道攔截';
  const charSize = Math.round(0.028 * h);
  const titleX = barX - 0.012 * w;
  let titleY = barY;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${charSize}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const ch of title) {
    ctx.fillText(ch, titleX, titleY);
    titleY += charSize * 1.15;
  }
  ctx.restore();
}

function drawTick(ctx, vx, vy, w, h) {
  const cx = vx + w * 0.90;
  const cy = vy + h * 0.08;
  const r = h * 0.045;

  ctx.save();
  ctx.strokeStyle = '#2ecc40';
  ctx.lineWidth = r * 0.35;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.55, cy);
  ctx.lineTo(cx - r * 0.1, cy + r * 0.45);
  ctx.lineTo(cx + r * 0.6, cy - r * 0.5);
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
