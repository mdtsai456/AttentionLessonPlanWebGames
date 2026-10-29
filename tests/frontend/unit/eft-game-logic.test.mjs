// EFT 的 levelAccuracyText：後半那一局只玩第 4～6 關，前面的空位要略過，不能丟錯或產生 ",,,a,b,c"。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelAccuracyText } from '../../../shared/eft-game-logic.js';

test('六關都玩過：依序輸出，最多取 stageCount 個', () => {
  assert.equal(levelAccuracyText([1, 0.5, 0, 0.25, 0.75, 1], 6), '1,0.5,0,0.25,0.75,1');
  assert.equal(levelAccuracyText([1, 0.5, 0, 0.25, 0.75, 1], 3), '1,0.5,0');
});

test('只玩後半：takeSnapshot 複製出來的 undefined 空位不丟錯，只剩 3 個值', () => {
  const sparse = [];
  sparse[3] = 0.6;
  sparse[4] = 0.8;
  sparse[5] = 1;
  // takeSnapshot 用 [...levelAccuracies]，空位會變成 undefined。
  assert.equal(levelAccuracyText([...sparse], 6), '0.6,0.8,1');
  assert.equal(levelAccuracyText(sparse, 6), '0.6,0.8,1');
});

test('null 與稀疏陣列的空位也略過', () => {
  assert.equal(levelAccuracyText([null, undefined, null, 0.5], 6), '0.5');
  assert.equal(levelAccuracyText([, , , 0.5], 5), '0.5');
});

test('正確率 0 要保留，四捨五入到小數 4 位', () => {
  assert.equal(levelAccuracyText([undefined, 0, 1 / 3], 6), '0,0.3333');
});
