// 遊戲畫面層（SPEC 4.16）。節點限制在 container 內，CSS 可供多實例共用。

const STYLE_ATTR = 'data-dccs-style';

const CSS = `
.dccs-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.72);
  z-index: 10;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC",
    "PingFang TC", "Microsoft JhengHei", Roboto, Helvetica, Arial, sans-serif;
  color: #eee;
}
.dccs-overlay[hidden] {
  display: none !important;
}
.dccs-panel {
  background: #14181f;
  border: 1px solid #2c333f;
  border-radius: 12px;
  padding: 2rem 2.5rem;
  min-width: 320px;
  max-width: min(92vw, 480px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  box-sizing: border-box;
}
.dccs-panel h1 {
  margin: 0 0 0.75rem;
  font-size: 1.4rem;
  letter-spacing: 0.02em;
}
.dccs-hint {
  margin: 0.35rem 0;
  color: #a8b0bf;
  font-size: 0.95rem;
  line-height: 1.5;
}
.dccs-hint.dccs-small {
  font-size: 0.8rem;
  color: #6b7280;
}
/* 教學是單一頁面。上下兩張操作卡對應遊戲裡的兩排選項；小螢幕可捲動，
   避免為了塞進一屏而把文字與按鈕縮得太小。 */
.dccs-overlay-tutorial {
  padding: clamp(10px, 2.4vw, 28px);
  background:
    radial-gradient(circle at 15% 10%, rgba(50, 184, 229, 0.28), transparent 32%),
    radial-gradient(circle at 88% 90%, rgba(255, 190, 53, 0.24), transparent 30%),
    #0b1324;
}

.dccs-overlay-tutorial .dccs-panel {
  width: min(94vw, 900px);
  min-width: 0;
  max-width: 900px;
  max-height: 94%;
  overflow-y: auto;
  padding: clamp(1.15rem, 3vh, 2.25rem) clamp(1rem, 3.6vw, 3rem);
  color: #152238;
  background: #f8fbff;
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: clamp(20px, 3vw, 32px);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
}

.dccs-tutorial-header {
  margin: 0 auto clamp(0.85rem, 2vh, 1.35rem);
  max-width: 680px;
  text-align: center;
}

.dccs-tutorial-eyebrow {
  display: inline-block;
  margin-bottom: 0.35rem;
  padding: 0.3rem 0.75rem;
  color: #087ead;
  background: #dff5ff;
  border-radius: 999px;
  font-size: clamp(0.78rem, 1.5vw, 0.9rem);
  font-weight: 800;
  letter-spacing: 0.08em;
}

.dccs-panel .dccs-tutorial-title {
  margin: 0;
  color: #14223a;
  font-size: clamp(1.55rem, 3.2vw, 2.35rem);
  letter-spacing: 0.03em;
}

.dccs-tutorial-lead {
  margin: 0.45rem 0 0;
  color: #5b6980;
  font-size: clamp(0.95rem, 1.8vw, 1.12rem);
  line-height: 1.55;
}

.dccs-tutorial-rows {
  display: grid;
  gap: clamp(0.65rem, 1.6vh, 1rem);
  width: 100%;
}

.dccs-tutorial-row {
  display: grid;
  grid-template-columns: minmax(165px, 0.72fr) 1.45fr;
  gap: clamp(0.8rem, 2.2vw, 1.6rem);
  align-items: center;
  width: 100%;
  padding: clamp(0.75rem, 1.8vw, 1rem);
  background: #eef5ff;
  border: 2px solid #dce9fb;
  border-radius: 20px;
}

.dccs-tutorial-rowcopy {
  min-width: 0;
}

.dccs-tutorial-rowtitle {
  display: block;
  margin-bottom: 0.45rem;
  color: #273650;
  font-size: clamp(1rem, 2vw, 1.25rem);
  font-weight: 800;
}

.dccs-tutorial-keys {
  display: flex;
  align-items: center;
  gap: 0.38rem;
  flex-wrap: wrap;
}

.dccs-tutorial-keyword {
  color: #6a7890;
  font-size: 0.85rem;
  font-weight: 700;
}

.dccs-tutorial-key {
  display: inline-grid;
  min-width: 2.35rem;
  height: 2.35rem;
  place-items: center;
  padding: 0 0.55rem;
  color: #fff;
  background: #1c9ccd;
  border: 1px solid #087ead;
  border-bottom-width: 4px;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 900;
  line-height: 1;
}

.dccs-tutorial-rownote {
  margin: 0.45rem 0 0;
  color: #64728a;
  font-size: clamp(0.8rem, 1.5vw, 0.92rem);
  line-height: 1.45;
}

.dccs-tutorial-strip {
  display: flex;
  gap: clamp(0.4rem, 1.2vw, 0.8rem);
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.dccs-tutorial-strip img {
  width: clamp(54px, 8vw, 88px);
  height: clamp(54px, 8vw, 88px);
  object-fit: contain;
  background: #fff;
  border: 2px solid #d8e2f0;
  border-radius: 14px;
  padding: 7px;
}

.dccs-tutorial-strip .dccs-tutorial-frame {
  border: 5px solid #f2b72b;
  border-radius: 18px;
  padding: 4px;
}

.dccs-tutorial-answer {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.7rem;
  align-items: center;
  margin: clamp(0.75rem, 1.8vh, 1.1rem) 0 0;
  padding: 0.7rem 0.9rem;
  color: #3b4961;
  background: #fff6d9;
  border: 1px solid #f2dda0;
  border-radius: 14px;
  font-size: clamp(0.9rem, 1.7vw, 1.05rem);
  line-height: 1.55;
}

.dccs-tutorial-answer strong {
  padding: 0.28rem 0.6rem;
  color: #815800;
  background: #ffe19a;
  border-radius: 999px;
  white-space: nowrap;
  font-size: 0.84em;
}

.dccs-tutorial-answer p {
  margin: 0;
}

.dccs-tutorial-reassurance {
  margin: 0.6rem 0 0;
  color: #68758a;
  font-size: clamp(0.82rem, 1.55vw, 0.95rem);
  text-align: center;
}

.dccs-tutorial-keyhint {
  color: #5b6980;
  font-size: clamp(0.9rem, 1.7vw, 1.05rem);
  font-weight: 700;
  margin: clamp(0.75rem, 2vh, 1.1rem) 0 0;
  text-align: center;
}

.dccs-overlay-tutorial .dccs-kbd {
  color: #344057;
  background: #fff;
  border-color: #b9c4d4;
}

@media (max-width: 560px) {
  .dccs-overlay-tutorial .dccs-panel {
    width: 96vw;
    max-height: 96%;
    padding: 1rem 0.85rem;
    border-radius: 20px;
  }

  .dccs-tutorial-row {
    grid-template-columns: 1fr;
    gap: 0.65rem;
  }

  .dccs-tutorial-strip {
    justify-content: flex-start;
  }

  .dccs-tutorial-answer {
    grid-template-columns: 1fr;
    gap: 0.35rem;
  }
}

/* 較矮的畫面改用共用緊湊版；單人與雙人都走同一組數值，保持外觀一致，
   同時讓完整操作說明不必捲動。 */
@media (max-height: 760px) {
  .dccs-overlay-tutorial {
    padding: 8px;
  }

  .dccs-overlay-tutorial .dccs-panel {
    width: min(96vw, 860px);
    max-height: calc(100dvh - 16px);
    overflow: hidden;
    padding: clamp(0.6rem, 1.6vh, 0.85rem) clamp(0.7rem, 2.4vw, 1.35rem);
  }

  .dccs-tutorial-header {
    margin-bottom: clamp(0.35rem, 1vh, 0.55rem);
  }

  .dccs-tutorial-eyebrow {
    margin-bottom: 0.18rem;
    padding: 0.18rem 0.55rem;
    font-size: 0.72rem;
  }

  .dccs-panel .dccs-tutorial-title {
    font-size: clamp(1.25rem, 3.5vh, 1.75rem);
  }

  .dccs-tutorial-lead {
    margin-top: 0.2rem;
    font-size: clamp(0.76rem, 2vh, 0.92rem);
    line-height: 1.35;
  }

  .dccs-tutorial-rows {
    gap: clamp(0.3rem, 0.9vh, 0.5rem);
  }

  .dccs-tutorial-row {
    grid-template-columns: minmax(120px, 0.7fr) 1.4fr;
    gap: clamp(0.45rem, 1.5vw, 0.8rem);
    padding: clamp(0.38rem, 1vh, 0.58rem);
    border-radius: 14px;
  }

  .dccs-tutorial-rowtitle {
    margin-bottom: 0.22rem;
    font-size: clamp(0.84rem, 2.2vh, 1rem);
  }

  .dccs-tutorial-key {
    min-width: 1.9rem;
    height: 1.9rem;
    padding-inline: 0.4rem;
    border-radius: 8px;
    font-size: 0.86rem;
  }

  .dccs-tutorial-rownote {
    margin-top: 0.2rem;
    font-size: clamp(0.7rem, 1.8vh, 0.82rem);
    line-height: 1.25;
  }

  .dccs-tutorial-strip {
    gap: clamp(0.25rem, 0.8vw, 0.45rem);
  }

  .dccs-tutorial-strip img {
    width: clamp(40px, 7.5vh, 58px);
    height: clamp(40px, 7.5vh, 58px);
    padding: 4px;
    border-radius: 10px;
  }

  .dccs-tutorial-strip .dccs-tutorial-frame {
    border-width: 3px;
    border-radius: 12px;
    padding: 3px;
  }

  .dccs-tutorial-answer {
    grid-template-columns: auto 1fr;
    gap: 0.45rem;
    margin-top: clamp(0.35rem, 1vh, 0.55rem);
    padding: 0.4rem 0.6rem;
    border-radius: 10px;
    font-size: clamp(0.72rem, 1.9vh, 0.88rem);
    line-height: 1.3;
  }

  .dccs-tutorial-reassurance {
    margin-top: 0.25rem;
    font-size: clamp(0.7rem, 1.8vh, 0.82rem);
  }

  .dccs-tutorial-keyhint {
    margin-top: clamp(0.3rem, 0.9vh, 0.5rem);
    font-size: clamp(0.72rem, 1.9vh, 0.88rem);
  }
}

@media (max-width: 560px) and (max-height: 760px) {
  .dccs-tutorial-row {
    grid-template-columns: minmax(105px, 0.8fr) 1.25fr;
  }

  .dccs-tutorial-strip img {
    width: clamp(38px, 12vw, 48px);
    height: clamp(38px, 12vw, 48px);
  }
}

.dccs-kbd {
  display: inline-block;
  padding: 0.1em 0.5em;
  border: 1px solid #444c5a;
  border-bottom-width: 2px;
  border-radius: 4px;
  background: #1f2530;
  font-family: inherit;
  font-size: 0.9em;
}
.dccs-summary {
  display: grid;
  grid-template-columns: auto auto;
  gap: 0.15rem 1rem;
  margin: 0.5rem 0;
  font-size: 0.9rem;
}
.dccs-summary dt {
  margin: 0;
  color: #8993a4;
  text-align: right;
}
.dccs-summary dd {
  margin: 0;
  color: #eee;
  font-variant-numeric: tabular-nums;
}
.dccs-overlay-level {
  padding: clamp(10px, 2.2vw, 30px);
  background: linear-gradient(135deg, #f3a51c 0%, #ffd63d 48%, #efa31d 100%);
  color: #27313a;
}
.dccs-overlay-level .dccs-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: min(86%, 980px);
  height: min(70%, 560px);
  min-width: 0;
  max-width: none;
  padding: clamp(72px, 11vh, 120px) clamp(24px, 6vw, 80px) clamp(28px, 5vh, 54px);
  border: 0;
  border-radius: clamp(30px, 5vw, 72px);
  background: #f8f8f6;
  box-shadow: 0 14px 34px rgba(117, 70, 4, 0.22);
}
.dccs-level-badge {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translate(-50%, -38%);
  min-width: clamp(190px, 34%, 360px);
  padding: clamp(15px, 2.5vh, 26px) clamp(28px, 4vw, 54px);
  border-radius: clamp(25px, 3vw, 42px);
  background: linear-gradient(180deg, #35b9e5, #22a8d8);
  box-shadow: 0 6px 0 rgba(17, 130, 174, 0.28);
  color: #fff;
  font-size: clamp(1.5rem, 3.2vw, 2.75rem);
  font-weight: 700;
  text-align: center;
  white-space: nowrap;
}
.dccs-level-message {
  margin: auto 0;
  color: #2e343b;
  font-size: clamp(1.55rem, 3.4vw, 3rem);
  font-weight: 500;
  letter-spacing: 0.08em;
  text-align: center;
}
.dccs-level-continue {
  width: clamp(190px, 31%, 330px);
  margin: 0;
  padding: clamp(13px, 2.1vh, 21px) 28px;
  border: 0;
  border-radius: 999px;
  background: #38a900;
  color: #fff;
  font: inherit;
  font-size: clamp(1.25rem, 2.5vw, 2rem);
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  box-shadow: 0 5px 0 rgba(31, 113, 0, 0.2);
}
.dccs-level-continue:hover,
.dccs-level-continue:focus-visible {
  background: #43bd00;
  outline: 4px solid rgba(56, 169, 0, 0.25);
  outline-offset: 4px;
}
.dccs-level-continue:active {
  transform: translateY(2px);
  box-shadow: 0 3px 0 rgba(31, 113, 0, 0.2);
}
`;

function injectStyleOnce() {
  if (document.querySelector(`style[${STYLE_ATTR}]`)) return;
  const style = document.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  style.textContent = CSS;
  document.head.appendChild(style);
}

function buildOverlay(extraClassName, innerHTML) {
  const overlay = document.createElement('div');
  overlay.className = `dccs-overlay ${extraClassName}`;
  overlay.hidden = true;
  const panel = document.createElement('div');
  panel.className = 'dccs-panel';
  panel.innerHTML = innerHTML;
  overlay.appendChild(panel);
  return overlay;
}

function renderSummaryFields(dl, summary) {
  dl.innerHTML = '';
  const fields = [
    ['得分', summary.correct_count],
    ['正確率', `${((summary.accuracy || 0) * 100).toFixed(1)}%`],
    ['錯誤數', summary.wrong_count],
    ['到達關卡', summary.stage],
    ['玩過關卡', summary.levelsPlayed],
    ['時長(秒)', Math.round((summary.duration || 0) / 1000)],
  ];
  for (const [label, value] of fields) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
}

/** 供雙人版等外部畫面使用：確保 .dccs-* 樣式已注入。 */
export function ensureOverlayStyles() {
  injectStyleOnce();
}

/**
 * 把單頁操作說明的內容畫進指定元素（只建 DOM，不管顯示與互動）。
 * 單人版由 showTutorial() 使用；雙人版自己有一套共用畫面，直接用這支，
 * 才不會變成左右兩側各跑一次教學。
 *
 * @param {HTMLElement} element 目標容器，內容會被清空
 * @param {object} content 見 showTutorial 的 content 參數
 */
export function renderTutorialInto(element, content) {
  injectStyleOnce();
  element.replaceChildren();
  if (!content) return;

  const headerEl = document.createElement('header');
  headerEl.className = 'dccs-tutorial-header';

  const eyebrowEl = document.createElement('span');
  eyebrowEl.className = 'dccs-tutorial-eyebrow';
  eyebrowEl.textContent = '操作說明';
  headerEl.appendChild(eyebrowEl);

  const titleEl = document.createElement('h1');
  titleEl.className = 'dccs-tutorial-title';
  titleEl.textContent = content.title || '';
  headerEl.appendChild(titleEl);

  const leadEl = document.createElement('p');
  leadEl.className = 'dccs-tutorial-lead';
  leadEl.textContent = content.lead || '';
  headerEl.appendChild(leadEl);
  element.appendChild(headerEl);

  const rowsEl = document.createElement('div');
  rowsEl.className = 'dccs-tutorial-rows';
  for (const row of content.rows || []) {
    rowsEl.appendChild(buildTutorialRowElement(row));
  }
  element.appendChild(rowsEl);

  const answerEl = document.createElement('div');
  answerEl.className = 'dccs-tutorial-answer';

  const answerLabelEl = document.createElement('strong');
  answerLabelEl.textContent = '怎麼作答';
  answerEl.appendChild(answerLabelEl);

  const answerTextEl = document.createElement('p');
  answerTextEl.textContent = content.answer || '';
  answerEl.appendChild(answerTextEl);
  element.appendChild(answerEl);

  const reassuranceEl = document.createElement('p');
  reassuranceEl.className = 'dccs-tutorial-reassurance';
  reassuranceEl.textContent = content.reassurance || '';
  element.appendChild(reassuranceEl);
}

function buildTutorialRowElement(row) {
  const rowEl = document.createElement('div');
  rowEl.className = 'dccs-tutorial-row';

  const copyEl = document.createElement('div');
  copyEl.className = 'dccs-tutorial-rowcopy';

  const labelEl = document.createElement('span');
  labelEl.className = 'dccs-tutorial-rowtitle';
  labelEl.textContent = row.label;
  copyEl.appendChild(labelEl);

  const keysEl = document.createElement('div');
  keysEl.className = 'dccs-tutorial-keys';

  const keywordEl = document.createElement('span');
  keywordEl.className = 'dccs-tutorial-keyword';
  keywordEl.textContent = '按';
  keysEl.appendChild(keywordEl);

  for (const [index, key] of (row.keys || []).entries()) {
    if (index > 0) {
      const orEl = document.createElement('span');
      orEl.className = 'dccs-tutorial-keyword';
      orEl.textContent = '或';
      keysEl.appendChild(orEl);
    }

    const keyEl = document.createElement('span');
    keyEl.className = 'dccs-tutorial-key';
    keyEl.textContent = key;
    keysEl.appendChild(keyEl);
  }

  copyEl.appendChild(keysEl);

  const noteEl = document.createElement('p');
  noteEl.className = 'dccs-tutorial-rownote';
  noteEl.textContent = row.note || '';
  copyEl.appendChild(noteEl);
  rowEl.appendChild(copyEl);

  const stripEl = document.createElement('div');
  stripEl.className = 'dccs-tutorial-strip';

  for (const item of row.images || []) {
    const img = document.createElement('img');
    img.src = item.src;
    // 教學圖只是示意，讀屏軟體念出檔名沒有意義。
    img.alt = '';
    if (item.framed) img.className = 'dccs-tutorial-frame';
    stripEl.appendChild(img);
  }

  rowEl.appendChild(stripEl);
  return rowEl;
}

export function createOverlays(container) {
  injectStyleOnce();

  const wrapper = document.createElement('div');
  wrapper.className = 'dccs-overlays';

  const loadingEl = buildOverlay(
    'dccs-overlay-loading',
    '<h1>載入中…</h1><p class="dccs-hint dccs-loading-detail">正在準備素材</p>'
  );
  const titleEl = buildOverlay(
    'dccs-overlay-title',
    '<h1>賽道攔截 · DCCS</h1>' +
      '<p class="dccs-hint">按 <span class="dccs-kbd">Enter</span> 或 ' +
      '<span class="dccs-kbd">空白鍵</span> 開始</p>' +
      '<p class="dccs-hint dccs-small dccs-title-meta"></p>'
  );
  const levelEl = buildOverlay(
    'dccs-overlay-level',
    '<div class="dccs-level-badge"></div>' +
      '<p class="dccs-level-message"></p>' +
      '<button class="dccs-level-continue" type="button">繼續</button>'
  );
  const resultEl = buildOverlay(
    'dccs-overlay-result',
    '<h1>本場結束</h1>' +
      '<dl class="dccs-summary dccs-result-summary"></dl>' +
      '<p class="dccs-hint dccs-result-status"></p>'
  );
  const errorEl = buildOverlay(
    'dccs-overlay-error',
    '<h1>發生錯誤</h1><p class="dccs-hint dccs-error-detail"></p>'
  );
  // SPEC 1.4：教學只說明操作，不揭露受試者要自行推導的答題規則。
  const tutorialEl = buildOverlay(
    'dccs-overlay-tutorial',
    '<header class="dccs-tutorial-header">' +
      '<span class="dccs-tutorial-eyebrow">操作說明</span>' +
      '<h1 class="dccs-tutorial-title"></h1>' +
      '<p class="dccs-tutorial-lead"></p>' +
      '</header>' +
      '<div class="dccs-tutorial-rows"></div>' +
      '<div class="dccs-tutorial-answer">' +
      '<strong>怎麼作答</strong><p class="dccs-tutorial-answer-text"></p>' +
      '</div>' +
      '<p class="dccs-tutorial-reassurance"></p>' +
      '<p class="dccs-tutorial-keyhint">' +
      '按 <span class="dccs-kbd">Enter</span> 或 ' +
      '<span class="dccs-kbd">空白鍵</span> 開始' +
      '</p>'
  );

  wrapper.appendChild(loadingEl);
  wrapper.appendChild(titleEl);
  wrapper.appendChild(levelEl);
  wrapper.appendChild(resultEl);
  wrapper.appendChild(errorEl);
  wrapper.appendChild(tutorialEl);
  container.appendChild(wrapper);

  const all = [loadingEl, titleEl, levelEl, resultEl, errorEl, tutorialEl];
  const levelButton = levelEl.querySelector('.dccs-level-continue');
  let resolveLevelPrompt = null;

  function settleLevelPrompt() {
    if (!resolveLevelPrompt) return;
    const resolve = resolveLevelPrompt;
    resolveLevelPrompt = null;
    resolve();
  }

  levelButton.addEventListener('click', settleLevelPrompt);

  function showOnly(target) {
    for (const el of all) el.hidden = el !== target;
  }

  function hideAll() {
    for (const el of all) el.hidden = true;
  }

  function showLoading(detail) {
    loadingEl.querySelector('.dccs-loading-detail').textContent = detail || '';
    showOnly(loadingEl);
  }

  function showTitle(meta) {
    const metaEl = titleEl.querySelector('.dccs-title-meta');
    metaEl.textContent = meta
      ? Object.entries(meta)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')
      : '';
    showOnly(titleEl);
  }

  function showLevelPrompt(levelNo) {
    levelEl.querySelector('.dccs-level-badge').textContent = `第 ${levelNo} 關`;
    levelEl.querySelector('.dccs-level-message').textContent = `準備開始第 ${levelNo} 關！`;
    showOnly(levelEl);
    levelButton.focus();
    return new Promise((resolve) => {
      resolveLevelPrompt = resolve;
    });
  }

  function showResult(summary, statusText) {
    renderSummaryFields(resultEl.querySelector('.dccs-result-summary'), summary || {});
    resultEl.querySelector('.dccs-result-status').textContent = statusText || '';
    showOnly(resultEl);
  }

  function setResultStatus(text) {
    resultEl.querySelector('.dccs-result-status').textContent = text || '';
  }

  const tutorialTitleEl = tutorialEl.querySelector('.dccs-tutorial-title');
  const tutorialLeadEl = tutorialEl.querySelector('.dccs-tutorial-lead');
  const tutorialRowsEl = tutorialEl.querySelector('.dccs-tutorial-rows');
  const tutorialAnswerEl = tutorialEl.querySelector('.dccs-tutorial-answer-text');
  const tutorialReassuranceEl = tutorialEl.querySelector('.dccs-tutorial-reassurance');

  let resolveTutorial = null;

  function settleTutorial() {
    window.removeEventListener('keydown', onTutorialKeyDown);
    if (!resolveTutorial) return;
    const resolve = resolveTutorial;
    resolveTutorial = null;
    resolve();
  }

  function onTutorialKeyDown(event) {
    if (
      event.code !== 'Enter' &&
      event.code !== 'NumpadEnter' &&
      event.code !== 'Space'
    ) {
      return;
    }

    event.preventDefault();
    settleTutorial();
  }

  /**
   * 顯示單頁操作說明，回傳的 Promise 在受試者按「開始」時 resolve。
   * @param {{title: string, lead?: string, answer?: string, reassurance?: string,
   *          rows?: Array<{label: string, keys?: Array<string>, note?: string,
   *                        images?: Array<{src: string, framed?: boolean}>}>}} content
   * @returns {Promise<void>}
   */
  function showTutorial(content) {
    if (!content) {
      return Promise.resolve();
    }

    tutorialTitleEl.textContent = content.title || '';
    tutorialLeadEl.textContent = content.lead || '';
    tutorialAnswerEl.textContent = content.answer || '';
    tutorialReassuranceEl.textContent = content.reassurance || '';

    tutorialRowsEl.replaceChildren();
    for (const row of content.rows || []) {
      tutorialRowsEl.appendChild(buildTutorialRowElement(row));
    }

    showOnly(tutorialEl);
    const panelEl = tutorialEl.querySelector('.dccs-panel');
    panelEl.scrollTop = 0;
    panelEl.tabIndex = -1;
    panelEl.focus({ preventScroll: true });
    window.addEventListener('keydown', onTutorialKeyDown);

    return new Promise((resolve) => {
      resolveTutorial = resolve;
    });
  }

  function showError(message) {
    errorEl.querySelector('.dccs-error-detail').textContent = message || '';
    showOnly(errorEl);
  }

  function destroy() {
    settleLevelPrompt();
    settleTutorial();
    levelButton.removeEventListener('click', settleLevelPrompt);
    wrapper.remove();
  }

  return {
    showLoading,
    showTitle,
    showLevelPrompt,
    showTutorial,
    showResult,
    setResultStatus,
    showError,
    hideAll,
    destroy,
  };
}
