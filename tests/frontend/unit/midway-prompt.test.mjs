// 第 3 關後的中場提示文字。QA（10.05 ~ 10.11）：原本的「挑戰完成！第 3 關已結束」
// 會讓學生誤以為整場已經玩完，改為「中場休息／已完成一半的遊玩進度」。
// 整場結束的結算畫面仍是「挑戰完成！」，不在此檢查範圍內。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SITE_ROOT } from '../site.mjs';

const TITLE = '中場休息';
const MESSAGE = '已完成一半的遊玩進度';

// 中場畫面寫在哪些檔案；有些遊戲同時寫在 HTML 和 JS 裡。
const MIDWAY_SOURCES = [
  'DAT_single/DAT_single.js',
  'DAT_double/DAT_double.html',
  'DCCS_single/js/ui/overlays.js',
  'DCCS_double/js/ui/overlays.js',
  'DCCS_double/index.html',
  'EFT_single/EFT_single.html',
  'EFT_double/EFT_double.html',
  'IM_single/index.html',
  'IM_single/app.js',
  'TGame_single/app.js',
  'TGame_double/index.html',
];

const read = (file) => fs.readFileSync(`${SITE_ROOT}/${file}`, 'utf8');

for (const file of MIDWAY_SOURCES) {
  test(`${file}：中場提示說明只完成一半`, () => {
    const source = read(file);
    assert.ok(source.includes(MESSAGE), `缺少「${MESSAGE}」`);
    assert.ok(!/第 3 關已結束<br\s*\/?>要繼續遊玩嗎/.test(source), '仍有舊的中場文字');
  });
}

// IM 的中場文字只寫在 app.js，標題在 index.html，其餘檔案標題和文字相鄰。
for (const file of MIDWAY_SOURCES.filter((f) => f !== 'IM_single/app.js')) {
  test(`${file}：中場標題是「${TITLE}」，不是「挑戰完成！」`, () => {
    const source = read(file);
    const at = source.indexOf(MESSAGE);
    const before = source.slice(Math.max(0, at - 200), at);
    assert.ok(before.includes(TITLE), `中場文字前沒有「${TITLE}」標題`);
    assert.ok(!before.includes('挑戰完成'), '中場標題仍是「挑戰完成！」');
  });
}

test('整場結束的結算標題仍是「挑戰完成！」', () => {
  for (const file of ['DCCS_single/js/ui/overlays.js', 'DCCS_double/js/ui/overlays.js']) {
    assert.match(read(file), /dccs-overlay-result',\s*'<div class="dccs-level-badge">挑戰完成！<\/div>'/);
  }
  assert.match(read('TGame_single/app.js'), /resultTitle\.textContent = "挑戰完成！"/);
  assert.match(read('IM_single/app.js'), /resultTitle\.textContent = "挑戰完成！"/);
});
