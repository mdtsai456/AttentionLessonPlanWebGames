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

/**
 * @param {HTMLElement} container
 * @returns {{
 *   showLoading(detail: string): void,
 *   showTitle(meta: object): void,
 *   showLevelPrompt(levelNo: number): Promise<void>,
 *   showResult(summary: object, statusText: string): void,
 *   setResultStatus(text: string): void,
 *   showError(message: string): void,
 *   hideAll(): void,
 *   destroy(): void,
 * }}
 */
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
      '<p class="dccs-hint">按 <span class="dccs-kbd">空白鍵</span> 開始</p>' +
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

  wrapper.appendChild(loadingEl);
  wrapper.appendChild(titleEl);
  wrapper.appendChild(levelEl);
  wrapper.appendChild(resultEl);
  wrapper.appendChild(errorEl);
  container.appendChild(wrapper);

  const all = [loadingEl, titleEl, levelEl, resultEl, errorEl];
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

  function showError(message) {
    errorEl.querySelector('.dccs-error-detail').textContent = message || '';
    showOnly(errorEl);
  }

  function destroy() {
    settleLevelPrompt();
    levelButton.removeEventListener('click', settleLevelPrompt);
    wrapper.remove();
  }

  return {
    showLoading,
    showTitle,
    showLevelPrompt,
    showResult,
    setResultStatus,
    showError,
    hideAll,
    destroy,
  };
}
