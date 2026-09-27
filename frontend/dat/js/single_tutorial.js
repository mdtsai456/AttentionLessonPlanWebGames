    // 1. 題型說明資料庫 (可動態擴充題型數量)
const questionTypes = [
  {
    title: "當問題的顏色與文字相同時，按下選擇鍵。",
    example: "例：藍色的文字搭配內容為「藍色」",
    bgColor: "#fff7ed",
    color: "#1b439b",
    text: "藍色",
    hint: "顏色正確的話，按下選擇鍵"
  },
  {
    title: "當算式答案計算正確時，按下選擇鍵。",
    example: "例：2 + 3 = 5",
    bgColor: "#fff7ed",
    color: "#65462f",
    text: "2 + 3 = 5",
    hint: "算式正確的話，按下選擇鍵"
  },
  // 若需新增題型，直接在此新增物件即可
];

let currentTypeIndex = 0;

// DOM 元素引用
const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const step3 = document.getElementById('step-3');

const typeTitle = document.getElementById('type-title');
const typeExample = document.getElementById('type-example');
const previewBox = document.getElementById('preview-box');
const prevBtn = document.getElementById('prev-type');
const nextBtn = document.getElementById('next-type');

// 畫面切換事件
document.getElementById('btn-to-step2').addEventListener('click', () => {
  step1.hidden = true;
  step2.hidden = false;
  renderTypeCard();
});

document.getElementById('btn-to-step3').addEventListener('click', () => {
  step2.hidden = true;
  step3.hidden = false;
});

// 渲染題型輪播內容
function renderTypeCard() {
  const data = questionTypes[currentTypeIndex];
  typeTitle.textContent = data.title;
  typeExample.textContent = data.example;

  previewBox.innerHTML = `
    <div class="preview-badge" style="background-color: ${data.bgColor}; color: ${data.color};">
      ${data.text}
    </div>
    <div class="preview-hint">${data.hint}</div>
  `;

  // 更新按鈕啟用/停用狀態
  prevBtn.disabled = currentTypeIndex === 0;
  nextBtn.disabled = currentTypeIndex === questionTypes.length - 1;
}

// 左右箭頭切換事件
prevBtn.addEventListener('click', () => {
  if (currentTypeIndex > 0) {
    currentTypeIndex--;
    renderTypeCard();
  }
});

nextBtn.addEventListener('click', () => {
  if (currentTypeIndex < questionTypes.length - 1) {
    currentTypeIndex++;
    renderTypeCard();
  }
});

// 畫面三：模式選擇事件
document.getElementById('btn-practice').addEventListener('click', () => {
  // 跳轉至練習模式
  window.location.href = 'single.html?mode=practice';
});

document.getElementById('btn-start').addEventListener('click', () => {
  // 跳轉至正式遊戲
  window.location.href = 'single.html?mode=game';
});