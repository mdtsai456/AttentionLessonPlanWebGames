// js/questions.js

export const COLOR_POOL = [
  { name: '紅色', hex: '#c52c35' },
  { name: '藍色', hex: '#215cc1' },
  { name: '綠色', hex: '#168047' },
  { name: '黃色', hex: '#c48221' },
  { name: '紫色', hex: '#7d3c98' },
  { name: '橘色', hex: '#e08e2b' },
];

export function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function generateColorQuestion() {
  const nameColor = pickRandom(COLOR_POOL);
  const isMatch = Math.random() < 0.5;
  const displayColor = isMatch
    ? nameColor
    : pickRandom(COLOR_POOL.filter((c) => c.name !== nameColor.name));
  return { text: nameColor.name, color: displayColor.hex, answer: isMatch };
}

export function generateMathQuestion() {
  const useSubtraction = Math.random() < 0.5;
  let a = Math.floor(Math.random() * 8) + 2;
  let b = Math.floor(Math.random() * 8) + 1;
  let op = '+', correct;
  if (useSubtraction) {
    op = '−';
    if (b > a) [a, b] = [b, a];
    correct = a - b;
  } else {
    correct = a + b;
  }
  const isCorrect = Math.random() < 0.5;
  let shown = correct;
  if (!isCorrect) {
    const offsets = [-2, -1, 1, 2].filter((n) => correct + n >= 0);
    shown = correct + pickRandom(offsets);
  }
  return { text: `${a} ${op} ${b} = ${shown}`, color: '#65462f', answer: isCorrect };
}

export const QUESTION_KINDS = [
  { label: '顏色判斷：色名與字色是否相同？', generate: generateColorQuestion },
  { label: '數學判斷：算式答案是否正確？', generate: generateMathQuestion },
];

/**
 * 產生指定數量的題目集合
 * @param {number} count 題目數量
 * @param {boolean} practice 是否為練習模式
 */
export function generateQuestionSet(count, practice = false) {
  const list = [];
  for (let i = 0; i < count; i++) {
    const kind = QUESTION_KINDS[i % QUESTION_KINDS.length];
    const question = kind.generate();
    const prefix = practice ? `【練習 ${i + 1}/${count}】` : '';
    list.push({ type: `${prefix}${kind.label}`, ...question });
  }
  return list;
}