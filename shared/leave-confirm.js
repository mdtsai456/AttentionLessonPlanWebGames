// 遊戲內的離開確認。先問、確定後才存檔並離開：
//   if (!(await window.confirmLeave())) return;  // 取消：什麼都不送，遊戲照常繼續
//   await 存檔();
//   window.leaveTo('../Select/index.html');
// 以前是先存檔再跳出瀏覽器的離開詢問；瀏覽器不會告訴頁面使用者按了取消，
// 取消後已經送出的檢查點會跟之後打完的成績各留一筆。
(function () {
  const TITLE = '確定要離開嗎？';
  const STYLE = `
.webgame-leave-confirm{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(30,20,10,.55);font-family:inherit}
.webgame-leave-confirm__card{min-width:min(22rem,86vw);max-width:90vw;padding:1.6rem 1.8rem;border-radius:1.2rem;background:#fffaf0;color:#4a3420;box-shadow:0 12px 32px rgba(0,0,0,.25);text-align:center}
.webgame-leave-confirm__title{margin:0 0 .5rem;font-size:1.5rem}
.webgame-leave-confirm__text{margin:0 0 1.2rem;font-size:1.05rem;line-height:1.5}
.webgame-leave-confirm__actions{display:flex;gap:1rem;justify-content:center}
.webgame-leave-confirm__actions button{min-width:7rem;padding:.6rem 1.2rem;border:0;border-radius:999px;font:inherit;font-size:1.1rem;cursor:pointer}
.webgame-leave-confirm__stay{background:#f2a541;color:#fff}
.webgame-leave-confirm__leave{background:#e3d6c4;color:#4a3420}
.webgame-leave-confirm__actions button:focus-visible{outline:3px solid #2b6cb0;outline-offset:3px}`;

  let pending = null;

  function ensureStyle() {
    if (document.getElementById('webgame-leave-confirm-style')) return;
    const style = document.createElement('style');
    style.id = 'webgame-leave-confirm-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  /**
   * 顯示確認框，回傳 Promise<boolean>：確定離開為 true，繼續遊戲／Esc 為 false。
   * 開著時暫停遊戲時鐘並攔下按鍵；取消時只解除這裡掛的暫停（例如視窗太小造成的
   * 暫停要維持）。確定時維持暫停，存檔請求的逾時要用 WebGameRuntime.nativeSetTimeout。
   */
  window.confirmLeave = function (message = '離開後會回到選擇遊戲頁面。') {
    if (pending) return pending;
    ensureStyle();
    const runtime = window.WebGameRuntime;
    // 用自己的暫停原因：別處的 resume() 不會解除它，關閉時也只解除自己的，
    // 例如視窗太小造成的暫停會維持。
    if (runtime) runtime.pause('leave-confirm');

    const overlay = document.createElement('div');
    overlay.className = 'webgame-leave-confirm';
    overlay.innerHTML = `
      <div class="webgame-leave-confirm__card" role="dialog" aria-modal="true"
           aria-labelledby="webgame-leave-confirm-title" aria-describedby="webgame-leave-confirm-text">
        <h2 class="webgame-leave-confirm__title" id="webgame-leave-confirm-title"></h2>
        <p class="webgame-leave-confirm__text" id="webgame-leave-confirm-text"></p>
        <div class="webgame-leave-confirm__actions">
          <button type="button" class="webgame-leave-confirm__stay">繼續遊戲</button>
          <button type="button" class="webgame-leave-confirm__leave">離開</button>
        </div>
      </div>`;
    overlay.querySelector('h2').textContent = TITLE;
    overlay.querySelector('p').textContent = message;
    const stay = overlay.querySelector('.webgame-leave-confirm__stay');
    const leave = overlay.querySelector('.webgame-leave-confirm__leave');
    const buttons = [stay, leave];

    pending = new Promise((resolve) => {
      function close(answer) {
        window.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('focusin', onFocusin, true);
        overlay.remove();
        pending = null;
        // 取消才恢復。確定離開時維持暫停到導頁，存檔期間遊戲不會打完下一關又多送一筆；
        // 流程中途放棄（例如存檔失敗留在頁面）要呼叫 cancelLeave()。
        if (runtime && !answer) runtime.resume('leave-confirm');
        // 不把焦點還給「離開」按鈕：遊戲用空白鍵／Enter 作答，焦點留在按鈕上
        // 下一次按鍵會又打開確認框。焦點回到頁面本身，按鍵照常交給遊戲。
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        resolve(answer);
      }
      // 擷取階段攔下按鍵：方向鍵、空白鍵等不能傳到遊戲；按鈕本身的 Enter／空白鍵照常觸發。
      function onKeydown(event) {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          close(false);
        } else if (event.key === 'Tab') {
          event.preventDefault();
          const current = buttons.indexOf(document.activeElement);
          const step = event.shiftKey ? -1 : 1;
          buttons[(current + step + buttons.length) % buttons.length].focus();
        }
      }
      // 遊戲自己的畫面（例如關卡提示）可能在確認框開著時搶焦點；拉回確認框。
      function onFocusin(event) {
        if (!overlay.contains(event.target)) stay.focus();
      }
      stay.addEventListener('click', () => close(false));
      leave.addEventListener('click', () => close(true));
      window.addEventListener('keydown', onKeydown, true);
      document.addEventListener('focusin', onFocusin, true);
    });

    document.body.appendChild(overlay);
    stay.focus();
    return pending;
  };

  /** 確定離開後流程沒走完（例如存檔失敗、留在頁面）：解除離開確認的暫停，遊戲繼續。 */
  window.cancelLeave = function () {
    if (window.WebGameRuntime) window.WebGameRuntime.resume('leave-confirm');
  };

  // 確定離開後按上一頁回來（bfcache）時，不沿用離開流程的暫停。
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.cancelLeave();
  });

  /** 已確認要離開：直接導頁，不再跳出瀏覽器的離開詢問。 */
  window.leaveTo = function (url) {
    window.location.href = url;
  };

  // 舊流程：先存檔再跳出瀏覽器的離開詢問。只留給還沒改用 confirmLeave 的頁面
  // （各遊戲分批合併期間），全部改完後沒有呼叫端。
  window.addEventListener('beforeunload', (event) => {
    if (!window.__askLeave) return;
    event.preventDefault();
    event.returnValue = '';
    // 按「取消」留在頁面時，之後的程式導向（返回大廳、結算後跳轉）不能再詢問。
    window.__askLeave = false;
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.__askLeave = false;
  });
  window.askLeave = function (url) {
    window.__askLeave = true;
    window.location.href = url;
  };
})();
