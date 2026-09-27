
//隨機的題目生成
// 色名與代表顏色的 Hex 碼對照
const COLOR_OPTIONS = [
  { name: '紅色', code: '#c52c35' },
  { name: '藍色', code: '#1e88e5' },
  { name: '綠色', code: '#168047' },
  { name: '黃色', code: '#f5e500' },
  { name: '黑色', code: '#212121' },
  { name: '紫色', code: '#8e24aa' }
];

// 1. 生成隨機顏色題目
function generateColorQuestion() {
  const isTrue = Math.random() < 0.5; // 50% 機率正確、50% 機率錯誤
  const textObj = COLOR_OPTIONS[Math.floor(Math.random() * COLOR_OPTIONS.length)];
  let colorObj = textObj;

  if (!isTrue) {
    // 當答案為假時，從剩餘顏色中挑選一個不同的字色
    const otherColors = COLOR_OPTIONS.filter(c => c.name !== textObj.name);
    colorObj = otherColors[Math.floor(Math.random() * otherColors.length)];
  }

  return {
    type: '顏色判斷：色名與字色是否相同？',
    text: textObj.name,
    color: colorObj.code,
    answer: isTrue
  };
}

// 2. 生成隨機數學算式題目
function generateMathQuestion() {
  const isTrue = Math.random() < 0.5;
  const isAddition = Math.random() < 0.5; // 隨機加法或減法
  let num1, num2, actualResult, displayResult;

  if (isAddition) {
    num1 = Math.floor(Math.random() * 10) + 1; // 1 ~ 10
    num2 = Math.floor(Math.random() * 10) + 1;
    actualResult = num1 + num2;
  } else {
    num1 = Math.floor(Math.random() * 15) + 5; // 5 ~ 19
    num2 = Math.floor(Math.random() * num1) + 1; // 確保結果為正數
    actualResult = num1 - num2;
  }

  if (isTrue) {
    displayResult = actualResult;
  } else {
    // 答案錯誤時，隨機加減 1 或 2 作為干擾項
    const offset = (Math.random() < 0.5 ? 1 : -1) * (Math.floor(Math.random() * 2) + 1);
    displayResult = actualResult + offset;
    if (displayResult <= 0) displayResult = actualResult + 3; // 避免出現小於等於 0 的不合理答案
  }

  const operator = isAddition ? '+' : '−';
  return {
    type: '數學判斷：算式答案是否正確？',
    text: `${num1} ${operator} ${num2} = ${displayResult}`,
    color: '#65462f', // 數學題統一字體顏色
    answer: isTrue
  };
}

// 3. 混合生成指定數量題目
export function generateRandomQuestions(count = 10) {
  const list = [];
  for (let i = 0; i < count; i++) {
    // 50% 機率抽顏色題，50% 機率抽數學題
    const q = Math.random() < 0.5 ? generateColorQuestion() : generateMathQuestion();
    list.push(q);
  }
  return list;
}