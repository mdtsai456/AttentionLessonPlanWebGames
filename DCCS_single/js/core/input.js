// 鍵盤輸入（SPEC 4.3）。外部傳入 bindings，以建立互不干擾的雙人實例。

export function createInput(bindings) {
  const codeToActions = new Map();
  for (const [action, codes] of Object.entries(bindings)) {
    for (const code of codes) {
      if (!codeToActions.has(code)) {
        codeToActions.set(code, []);
      }
      codeToActions.get(code).push(action);
    }
  }

  const down = new Set();
  // action 對應尚未處理的 keydown 次數。
  const pressCounts = new Map();

  function onKeyDown(e) {
    const actions = codeToActions.get(e.code);
    if (!actions) return;
    e.preventDefault();
    for (const action of actions) {
      down.add(action);
      // 長按只計算一次，不處理瀏覽器自動重複的 keydown。
      if (!e.repeat) {
        pressCounts.set(action, (pressCounts.get(action) || 0) + 1);
      }
    }
  }

  function onKeyUp(e) {
    const actions = codeToActions.get(e.code);
    if (!actions) return;
    e.preventDefault();
    for (const action of actions) {
      down.delete(action);
    }
  }

  // 頁面失去焦點時可能未收到 keyup。清除輸入狀態，避免返回頁面後套用舊輸入。
  function clearAll() {
    down.clear();
    pressCounts.clear();
  }

  function onVisibilityChange() {
    if (document.hidden) {
      clearAll();
    }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearAll);
  window.addEventListener('webgame:pause', clearAll);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    isDown(action) {
      return down.has(action);
    },
    /**
     * 取出並歸零 action 累積的按下次數。
     * @param {string} action
     * @returns {number}
     */
    takePresses(action) {
      const n = pressCounts.get(action) || 0;
      pressCounts.set(action, 0);
      return n;
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearAll);
      window.removeEventListener('webgame:pause', clearAll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearAll();
    },
  };
}
