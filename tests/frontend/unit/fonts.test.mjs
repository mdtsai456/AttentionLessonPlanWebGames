import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT } from '../site.mjs';

const FONT = path.join(SITE_ROOT, 'shared/fonts/MaokenAssortedSans-TC.woff2');
const files = fs.readdirSync(SITE_ROOT, { recursive: true })
  .map((file) => file.split(path.sep).join('/'))
  .filter((file) => !/(^|\/)(node_modules|\.git|\.venv)(\/|$)/.test(file));

// DCCS 的 overlays.js 把 @font-face 插進頁面，網址相對於遊戲頁（DCCS_*/index.html）。
function baseOf(file) {
  const overlay = file.match(/^(DCCS_\w+)\/js\/ui\/overlays\.js$/);
  return overlay ? path.join(SITE_ROOT, overlay[1], 'index.html') : path.join(SITE_ROOT, file);
}

test('全站只留一份字型檔，放在 shared/fonts', () => {
  const fonts = files.filter((file) => /\.(ttf|otf|woff2?)$/i.test(file));
  assert.deepEqual(fonts, ['shared/fonts/MaokenAssortedSans-TC.woff2']);
  assert.ok(fs.statSync(FONT).size > 0);
});

test('每個 @font-face 都指到 shared/fonts 的 woff2', () => {
  const sources = files.filter((file) => /\.(css|js)$/.test(file) && !file.startsWith('tests/'));
  let count = 0;
  for (const file of sources) {
    const text = fs.readFileSync(path.join(SITE_ROOT, file), 'utf8');
    for (const [, url] of text.matchAll(/url\("([^"]*MaokenAssortedSans[^"]*)"\)/g)) {
      count += 1;
      assert.equal(path.resolve(path.dirname(baseOf(file)), url), FONT, `${file} 的 ${url}`);
    }
  }
  assert.ok(count >= 16, `只找到 ${count} 個 @font-face`);
});
