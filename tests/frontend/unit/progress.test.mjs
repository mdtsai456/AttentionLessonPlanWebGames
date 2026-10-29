// shared/api.js 的遊戲清單與當日進度：Select 與 Teacher_platform 共用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE_ROOT } from '../site.mjs';

const window = {};
vm.runInNewContext(fs.readFileSync(`${SITE_ROOT}/shared/api.js`, 'utf8'), { window });
// vm 裡建立的物件原型不同，deepEqual 前先複製成本地物件。
const { GAMES, dayProgress, normalizeProgress } = window.WebGameApi;

test('遊戲清單是五款遊戲，順序固定', () => {
  assert.deepEqual(Array.from(GAMES, (game) => game.id), ['DCCS', 'DAT', 'EFT', 'TGame', 'InstructionGame']);
});

test('只算指定那一天，沒玩過的遊戲是 0', () => {
  const records = [
    { gameType: 'DCCS', currentDay: 3, stats: { stage: 3 } },
    { gameType: 'EFT', currentDay: 2, stats: { stage: 6 } },
  ];
  assert.deepEqual({ ...dayProgress(records, '3') }, { DCCS: 50, DAT: 0, EFT: 0, TGame: 0, InstructionGame: 0 });
});

test('同一款取最高的一筆，IM 對到指令出擊', () => {
  const records = [
    { gameType: 'DAT', currentDay: 1, stats: { stage: 6 } },
    { gameType: 'DAT', currentDay: 1, stats: { stage: 2 } },
    { gameType: 'IM', currentDay: 1, stats: { stage: 3 } },
  ];
  const progress = dayProgress(records, 1);
  assert.equal(progress.DAT, 100);
  assert.equal(progress.InstructionGame, 50);
});

test('指定遊戲清單時，只回傳那幾款（雙人沒有指令出擊）', () => {
  const duo = GAMES.filter((game) => game.id !== 'InstructionGame');
  const progress = dayProgress([{ gameType: 'IM', currentDay: 1, stats: { stage: 6 } }], 1, duo);
  assert.deepEqual(Object.keys(progress), ['DCCS', 'DAT', 'EFT', 'TGame']);
});

test('進度轉成最接近的 0、50、100', () => {
  assert.deepEqual([undefined, 20, 30, 74, 76, 'x'].map(normalizeProgress), [0, 0, 50, 50, 100, 0]);
});

test('Select 與 Teacher_platform 不再各寫一份遊戲清單與進度計算', () => {
  for (const file of ['Select/app.js', 'Teacher_platform/app.js']) {
    const text = fs.readFileSync(`${SITE_ROOT}/${file}`, 'utf8');
    assert.doesNotMatch(text, /PROGRESS_STEPS|function emptyProgress|name: "賽道攔截"/, file);
  }
});
