import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDatStats,
  createQuestion,
  getArrowAssetPath,
  getExpectedDirection,
  levelAccuracyText,
  shuffleCopy,
} from './eft-game-logic.js';
import {
  getArrowPlaceholderPath,
  getEftAssetPaths,
  getOppositeHintPath,
} from './eft-assets.js';

function sequenceRandom(values) {
  let randomIndex = 0;
  return () => values[randomIndex++];
}

test('createQuestion preserves direction, opposite, and style randomization order', () => {
  assert.deepEqual(createQuestion(sequenceRandom([0.25, 0.75, 0.625])), {
    direction: 'right',
    opposite: false,
    style: 2,
  });
  assert.deepEqual(createQuestion(sequenceRandom([0.75, 0.25, 0.875])), {
    direction: 'left',
    opposite: true,
    style: 3,
  });
});

test('getExpectedDirection handles normal and opposite arrows', () => {
  assert.equal(getExpectedDirection({ direction: 'left', opposite: false }), 'left');
  assert.equal(getExpectedDirection({ direction: 'left', opposite: true }), 'right');
  assert.equal(getExpectedDirection({ direction: 'right', opposite: true }), 'left');
});

test('getArrowAssetPath preserves image numbering for normal and opposite arrows', () => {
  assert.equal(getArrowAssetPath(0, 'left', false), 'assets/arrow/IMG_6124.PNG');
  assert.equal(getArrowAssetPath(0, 'right', false), 'assets/arrow/IMG_6125.PNG');
  assert.equal(getArrowAssetPath(0, 'left', true), 'assets/opposite_arrow/IMG_6120.PNG');
  assert.equal(getArrowAssetPath(0, 'right', true), 'assets/opposite_arrow/IMG_6121.PNG');
});

test('shuffleCopy returns a shuffled copy without mutating its input', () => {
  const items = ['a', 'b', 'c'];
  const shuffled = shuffleCopy(items, sequenceRandom([0, 0.5]));

  assert.deepEqual(shuffled, ['c', 'b', 'a']);
  assert.deepEqual(items, ['a', 'b', 'c']);
});

test('levelAccuracyText rounds values and limits the requested stages', () => {
  assert.equal(levelAccuracyText([1 / 3, 2 / 3, 1], 2), '0.3333,0.6667');
  assert.equal(levelAccuracyText([], 6), '');
});

test('buildDatStats preserves the backend statistic names and order', () => {
  const data = {
    score: 5,
    wrong: 2,
    accuracy: 5 / 7,
    duration: 120000,
    stage: 3,
    levelAccuracy: '0.5,0.75,1',
    avgReactionMs: 1800,
    questionCount: 7,
  };

  assert.deepEqual(buildDatStats(data), [
    { apiname: 'DAT_correct', value: 5 },
    { apiname: 'DAT_wrong', value: 2 },
    { apiname: 'DAT_accuracy', value: 5 / 7 },
    { apiname: 'DAT_duration', value: 120000 },
    { apiname: 'DAT_stage', value: 3 },
    { apiname: 'DAT_levelAccuracy', value: '0.5,0.75,1' },
    { apiname: 'DAT_avgReactionMs', value: 1800 },
    { apiname: 'DAT_questionCount', value: 7 },
  ]);
});

test('getEftAssetPaths includes every arrow style and optional background', () => {
  const paths = getEftAssetPaths();

  assert.equal(paths.length, 23);
  assert.ok(paths.includes('assets/arrow/目標泡泡.png'));
  assert.ok(paths.includes('assets/arrow/空泡泡.png'));
  assert.ok(paths.includes('assets/arrow/反向提示.PNG'));
  assert.ok(paths.includes('assets/arrow/IMG_6124.PNG'));
  assert.ok(paths.includes('assets/opposite_arrow/IMG_6145.PNG'));
  assert.equal(getEftAssetPaths({ includeBackground: true })[0], 'assets/background.png');
});