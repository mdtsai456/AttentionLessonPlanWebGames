// 遊戲開局前等圖片全部載完，期間蓋一層「圖片載入中」畫面，計時要等這裡結束才開始。
// 圖片慢不會中斷：一直等下去，超過 slowAfterMs 才多顯示「重新載入」讓老師可以手動重來。
// 圖片載入失敗（onerror）會自動重試，重試完還是失敗才顯示錯誤與「重新載入」。
// 用法：await window.WebGameImageWait.waitFor(['a.png', 'b.png'], { zIndex: 205 })
(function (global) {
  // game-runtime.js 會換掉 setTimeout，暫停遊戲時計時器也跟著停；這裡要用原生的。
  const later = (fn, ms) => (global.WebGameRuntime && global.WebGameRuntime.nativeSetTimeout
    ? global.WebGameRuntime.nativeSetTimeout(fn, ms)
    : global.setTimeout(fn, ms));
  const cancel = (id) => (global.WebGameRuntime && global.WebGameRuntime.nativeClearTimeout
    ? global.WebGameRuntime.nativeClearTimeout(id)
    : global.clearTimeout(id));

  const STYLE_ID = 'webgame-image-wait-style';
  const CSS = `
.webgame-image-wait{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.55);font-family:inherit}
.webgame-image-wait-card{min-width:260px;max-width:min(90vw,420px);padding:24px 32px;border-radius:20px;background:#fffdf6;box-shadow:0 10px 30px rgba(0,0,0,.18);text-align:center;color:#3b3b3b}
.webgame-image-wait-title{margin:0 0 8px;font-size:1.6rem;font-weight:800;color:#3f8f3a}
.webgame-image-wait-text{margin:0;font-size:1rem;line-height:1.6;white-space:pre-line}
.webgame-image-wait-actions{display:flex;gap:12px;justify-content:center;margin-top:16px}
.webgame-image-wait-actions[hidden]{display:none}
.webgame-image-wait-actions button{border:0;border-radius:999px;padding:10px 22px;font:inherit;font-weight:800;cursor:pointer}
.webgame-image-wait-reload{background:#f5a33c;color:#fff}
.webgame-image-wait-back{background:#e6ded0;color:#4a3b2a}
`;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function createOverlay(zIndex) {
    ensureStyle();
    const overlay = document.createElement('div');
    overlay.className = 'webgame-image-wait';
    overlay.style.zIndex = String(zIndex);
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
      <div class="webgame-image-wait-card">
        <p class="webgame-image-wait-title">載入中…</p>
        <p class="webgame-image-wait-text"></p>
        <div class="webgame-image-wait-actions" hidden>
          <button type="button" class="webgame-image-wait-reload">重新載入</button>
          <button type="button" class="webgame-image-wait-back">返回選遊戲</button>
        </div>
      </div>`;
    const title = overlay.querySelector('.webgame-image-wait-title');
    const text = overlay.querySelector('.webgame-image-wait-text');
    const actions = overlay.querySelector('.webgame-image-wait-actions');
    overlay.querySelector('.webgame-image-wait-reload').addEventListener('click', () => {
      global.location.reload();
    });
    overlay.querySelector('.webgame-image-wait-back').addEventListener('click', () => {
      // 還沒開局，沒有成績要送，直接回選遊戲頁。
      if (typeof global.leaveTo === 'function') global.leaveTo('../Select/index.html');
      else global.location.href = '../Select/index.html';
    });
    document.body.appendChild(overlay);
    return {
      setText(value) { text.textContent = value; },
      setTitle(value) { title.textContent = value; },
      showActions() { actions.hidden = false; },
      remove() { overlay.remove(); },
    };
  }

  /** 第 n 次重試加上 retry 參數，避免瀏覽器沿用剛才失敗的請求。 */
  function retryUrl(src, attempt) {
    if (!attempt) return src;
    const url = new URL(src, global.location.href);
    url.searchParams.set('retry', String(attempt));
    return url.href;
  }

  /** 載入一張圖。onerror 會重試 retries 次，都失敗才 reject；慢則一直等。 */
  function loadOne(src, retries, retryDelayMs) {
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const image = new Image();
      image.onload = () => {
        image.onload = null;
        image.onerror = null;
        resolve(image);
      };
      image.onerror = () => {
        if (attempt >= retries) {
          image.onload = null;
          image.onerror = null;
          reject(new Error(`圖片載入失敗：${src}`));
          return;
        }
        attempt += 1;
        later(() => { image.src = retryUrl(src, attempt); }, retryDelayMs);
      };
      image.src = src;
    });
  }

  /**
   * 等 sources 全部載完才 resolve。期間顯示載入畫面與進度；載入失敗時畫面改成錯誤訊息並 reject。
   * sources 可以是還在查的 Promise（例如要先問素材 API 用哪些箭頭），載入畫面會先出現。
   * @param {string[] | Promise<string[]>} sources
   * @param {{ zIndex?: number, retries?: number, retryDelayMs?: number, slowAfterMs?: number }} [options]
   * @returns {Promise<void>}
   */
  async function waitFor(sources, options = {}) {
    const retries = options.retries ?? 2;
    const retryDelayMs = options.retryDelayMs ?? 1000;
    const slowAfterMs = options.slowAfterMs ?? 15000;
    const overlay = createOverlay(options.zIndex ?? 205);
    let list = null;
    let loaded = 0;
    let failed = false;
    let slow = false;
    const render = () => overlay.setText(
      (list ? `正在載入圖片…（${loaded}／${list.length}）` : '正在準備遊戲圖片…')
      + (slow ? '\n網路比較慢，請再稍等一下。' : '')
    );
    render();

    // 太久沒載完：繼續等，但讓老師可以選擇重新載入或先回選遊戲頁。
    const slowTimer = later(() => {
      if (failed) return;
      slow = true;
      render();
      overlay.showActions();
    }, slowAfterMs);

    try {
      list = [...new Set((await sources).filter(Boolean))];
      render();
      await Promise.all(list.map((src) => loadOne(src, retries, retryDelayMs).then(() => {
        loaded += 1;
        // 有一張已確定失敗時不再更新進度，免得蓋掉錯誤訊息。
        if (!failed) render();
      })));
    } catch (error) {
      failed = true;
      cancel(slowTimer);
      overlay.setTitle('發生錯誤');
      overlay.setText('圖片載入失敗，請確認網路連線後按「重新載入」。');
      overlay.showActions();
      throw error;
    }
    cancel(slowTimer);
    overlay.remove();
  }

  global.WebGameImageWait = Object.freeze({ waitFor });
})(window);
