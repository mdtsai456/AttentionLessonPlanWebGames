// DAT_double/js/questions.js 單元測試
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// SITE_ROOT 可指定其他版本的程式碼，用於回歸比對。
const siteRoot = process.env.SITE_ROOT
  ? path.resolve(process.env.SITE_ROOT)
  : path.resolve(import.meta.dirname, '../..');
const {
  COLOR_POOL,
  QUESTION_KINDS,
  generateColorQuestion,
  generateMathQuestion,
  generateQuestionSet,
} = await import(pathToFileURL(path.join(siteRoot, 'DAT_double/js/questions.js')).href);

const COLOR_LABEL = QUESTION_KINDS[0].label;
const MATH_LABEL = QUESTION_KINDS[1].label;
const realRandom = Math.random;

afterEach(() => {
  Math.random = realRandom;
});

test('QUESTION_KINDS 依序為顏色題、數學題', () => {
  assert.equal(QUESTION_KINDS.length, 2);
  assert.match(COLOR_LABEL, /^顏色判斷/);
  assert.match(MATH_LABEL, /^數學判斷/);
});

test('練習模式：2 題固定為顏色、數學各 1 題，並帶練習前綴', () => {
  for (let run = 0; run < 50; run++) {
    const list = generateQuestionSet(2, true);
    assert.deepEqual(list.map((q) => q.type), [
      `【練習 1/2】${COLOR_LABEL}`,
      `【練習 2/2】${MATH_LABEL}`,
    ]);
  }
});

test('正式模式：題型由亂數決定（亂數偏低出顏色題）', () => {
  Math.random = () => 0.25;
  const [q] = generateQuestionSet(1, false);
  assert.equal(q.type, COLOR_LABEL);
});

test('正式模式：題型由亂數決定（亂數偏高出數學題，修正只出顏色題）', () => {
  Math.random = () => 0.75;
  const [q] = generateQuestionSet(1, false);
  assert.equal(q.type, MATH_LABEL);
  assert.match(q.text, /^\d+ [+−] \d+ = \d+$/);
});

test('正式模式：遊戲實際的呼叫方式 generateQuestionSet(1, false) 兩種題型都會出現且比例合理', () => {
  const counts = { [COLOR_LABEL]: 0, [MATH_LABEL]: 0 };
  const total = 400;
  for (let i = 0; i < total; i++) {
    const list = generateQuestionSet(1, false);
    assert.equal(list.length, 1);
    counts[list[0].type]++;
  }
  // 二項分布 n=400、p=0.5 時，結果落在 [120, 280] 外的機率極低。
  assert.ok(counts[COLOR_LABEL] >= 120 && counts[COLOR_LABEL] <= 280, JSON.stringify(counts));
  assert.ok(counts[MATH_LABEL] >= 120 && counts[MATH_LABEL] <= 280, JSON.stringify(counts));
});

test('正式模式：題目沒有練習前綴，一次產生多題也是隨機題型', () => {
  const list = generateQuestionSet(200, false);
  assert.equal(list.length, 200);
  assert.ok(list.every((q) => q.type === COLOR_LABEL || q.type === MATH_LABEL));
  const colorCount = list.filter((q) => q.type === COLOR_LABEL).length;
  assert.ok(colorCount > 0 && colorCount < 200, `顏色題 ${colorCount} / 200`);
  // 原寫法 i % 2 會使題型固定交替。隨機產生 200 題時，通常會出現連續的相同題型。
  const strictlyAlternating = list.every((q, i) => i === 0 || q.type !== list[i - 1].type);
  assert.equal(strictlyAlternating, false);
});

test('顏色題：answer 等於「字色是否就是色名對應的顏色」', () => {
  const hexByName = Object.fromEntries(COLOR_POOL.map((c) => [c.name, c.hex]));
  let trueCount = 0;
  for (let i = 0; i < 500; i++) {
    const q = generateColorQuestion();
    assert.ok(q.text in hexByName, `未知色名 ${q.text}`);
    assert.ok(COLOR_POOL.some((c) => c.hex === q.color), `未知字色 ${q.color}`);
    assert.equal(q.answer, hexByName[q.text] === q.color);
    if (q.answer) trueCount++;
  }
  assert.ok(trueCount > 0 && trueCount < 500);
});

test('數學題：answer 等於算式是否成立，顯示的答案不為負數', () => {
  let trueCount = 0;
  for (let i = 0; i < 500; i++) {
    const q = generateMathQuestion();
    const m = q.text.match(/^(\d+) ([+−]) (\d+) = (\d+)$/);
    assert.ok(m, `算式格式錯誤：${q.text}`);
    const [, a, op, b, shown] = m;
    const actual = op === '+' ? Number(a) + Number(b) : Number(a) - Number(b);
    assert.ok(actual >= 0, `減法結果為負：${q.text}`);
    assert.equal(q.answer, actual === Number(shown), q.text);
    if (q.answer) trueCount++;
  }
  assert.ok(trueCount > 0 && trueCount < 500);
});
