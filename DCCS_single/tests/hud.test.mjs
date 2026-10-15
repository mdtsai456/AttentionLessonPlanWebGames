// HUD 直立進度條左右位置的 Node 單元測試，不需要瀏覽器。
// 雙人模式玩家 2 的進度條放右側，與玩家 1 左右對稱。
//
// 執行：cd DCCS_single/tests && npm run test:unit

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const GAME_DIRS = ['DCCS_single', 'DCCS_double'];
const repoUrl = new URL('../../', import.meta.url);
const VIEWPORT = { x: 100, y: 20, w: 1000, h: 600 };

async function loadHud(dir) {
  return import(new URL(`${dir}/js/render/hud.js`, repoUrl).href);
}

async function loadTrack(dir) {
  return (await import(new URL(`${dir}/js/game/track.js`, repoUrl).href)).Track;
}

// 假 canvas context：只記下 fillText 的位置，其餘繪圖呼叫都忽略。
function fakeCtx() {
  const texts = [];
  const noop = () => {};
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key === 'texts') return texts;
      if (key === 'fillText') return (text, x, y) => texts.push({ text, x, y });
      if (key === 'measureText') return (text) => ({ width: String(text).length * 10 });
      if (key in target) return target[key];
      return noop;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return ctx;
}

function titleXs(ctx) {
  return ctx.texts.filter(({ text }) => '賽道攔截'.includes(text)).map(({ x }) => x);
}

for (const dir of GAME_DIRS) {
  test(`${dir}：未指定時進度條在左側（單人與玩家 1 不變）`, async () => {
    const { progressBarLayout } = await loadHud(dir);
    const layout = progressBarLayout(VIEWPORT);
    assert.equal(layout.barX, VIEWPORT.x + 0.03 * VIEWPORT.w);
    assert.ok(layout.titleX < layout.barX, '標題在進度條左邊');
  });

  test(`${dir}：右側進度條與左側左右對稱`, async () => {
    const { progressBarLayout } = await loadHud(dir);
    const left = progressBarLayout(VIEWPORT, 'left');
    const right = progressBarLayout(VIEWPORT, 'right');
    const mirror = (x) => 2 * VIEWPORT.x + VIEWPORT.w - x;

    assert.ok(Math.abs(mirror(left.barX + left.barW) - right.barX) < 1e-9);
    assert.ok(Math.abs(mirror(left.titleX) - right.titleX) < 1e-9);
    assert.equal(right.barY, left.barY);
    assert.equal(right.barH, left.barH);
    assert.ok(right.titleX > right.barX + right.barW, '標題在進度條右邊');
    assert.ok(right.barX + right.barW <= VIEWPORT.x + VIEWPORT.w, '進度條不超出畫面');
  });

  test(`${dir}：drawHud 依 progressSide 把標題畫在對應側`, async () => {
    const { drawHud } = await loadHud(dir);
    const center = VIEWPORT.x + VIEWPORT.w / 2;
    const base = { score: 0, elapsed: 30, total: 360, level: 1, remaining: 30 };

    const leftCtx = fakeCtx();
    drawHud(leftCtx, VIEWPORT, base);
    const rightCtx = fakeCtx();
    drawHud(rightCtx, VIEWPORT, { ...base, progressSide: 'right' });

    assert.equal(titleXs(leftCtx).length, 4);
    assert.ok(titleXs(leftCtx).every((x) => x < center));
    assert.equal(titleXs(rightCtx).length, 4);
    assert.ok(titleXs(rightCtx).every((x) => x > center));
  });

  test(`${dir}：Track 把 progressSide 交給 HUD，預設為左側`, async () => {
    const Track = await loadTrack(dir);
    const common = {
      manifest: { levels: [] },
      images: new Map(),
      input: { takePresses: () => 0 },
      viewport: VIEWPORT,
      rng: Math.random,
      stats: {},
    };
    assert.equal(new Track(common).progressSide, 'left');
    assert.equal(new Track({ ...common, progressSide: 'right' }).progressSide, 'right');
  });
}

test('DCCS_double：只有玩家 2 設定 progressSide 為右側', async () => {
  const source = await readFile(new URL('DCCS_double/js/double.js', repoUrl), 'utf8');
  const player2 = source.slice(source.indexOf('const player2Handle'));
  const player1 = source.slice(source.indexOf('const player1Handle'), source.indexOf('const player2Handle'));
  assert.match(player2, /progressSide:\s*'right'/);
  assert.doesNotMatch(player1, /progressSide/);
});
