// 同一個瀏覽器的分頁共用一組登入。
//
// 登入資料仍存在各分頁自己的 sessionStorage，遊戲照舊讀它；另外在 localStorage 放一份副本：
// - 新分頁開啟時，把副本複製到自己的 sessionStorage，不用重新登入。
// - 登出、登入失效或換帳號時，副本會被刪除或換掉。其他分頁收到 storage 事件後清掉自己的
//   登入並回登入頁，避免繼續用舊帳號作答、成績記到別人名下。
//
// 副本只記錄「誰登入了」；登入是否仍有效，一律由 require-student.js 呼叫 /auth/me 判斷。
// 各功能頁要在 require-student.js 之前同步載入本檔。
// 登入頁加 data-restore="manual"：不自動複製，由 Home/app.js 決定要不要直接進入。
(function (global) {
  const SHARED_KEY = "webgame_login";
  // 這個分頁目前用的是哪一次登入；和副本的 id 不同，代表別的分頁已登出或換了帳號。
  const ID_KEY = "login_share_id";
  // Home/app.js 登入時寫入的欄位。煙火是否顯示過、到期時間等各分頁自己的狀態不共用。
  const SLOT_FIELDS = ["token", "account", "key", "case", "grade", "school", "day"];
  const LOGIN_KEYS = [
    "user_role", "login_role", "game_mode", "token",
    "grade", "caseId", "school", "current_day", "currentDay",
    "teacher_id", "teacher_name", "teacher_school",
    ...SLOT_FIELDS.map((field) => `student1_${field}`),
    ...SLOT_FIELDS.map((field) => `student2_${field}`),
  ];

  const entry = document.currentScript;
  const homeHref = new URL("../Home/index.html", entry.src).href;
  const isLoginPage = entry.dataset.restore === "manual";
  let onSharedLogin = null;

  // 隱私模式等情況下 localStorage 可能無法使用：一律視為沒有副本，退回各分頁各自登入。
  function readShared() {
    try {
      const value = JSON.parse(global.localStorage.getItem(SHARED_KEY));
      return value && typeof value.id === "string" && value.data && typeof value.data === "object"
        ? value
        : null;
    } catch (_err) {
      return null;
    }
  }

  function removeShared() {
    try {
      global.localStorage.removeItem(SHARED_KEY);
    } catch (_err) {
      // localStorage 無法使用時本來就沒有副本。
    }
  }

  function newId() {
    return global.crypto && global.crypto.randomUUID
      ? global.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  /** 登入成功、sessionStorage 寫好之後呼叫：把這次登入存成副本，給其他分頁使用。 */
  function save() {
    const data = {};
    LOGIN_KEYS.forEach((key) => {
      const value = sessionStorage.getItem(key);
      if (value !== null) data[key] = value;
    });
    const id = newId();
    sessionStorage.setItem(ID_KEY, id);
    try {
      global.localStorage.setItem(SHARED_KEY, JSON.stringify({ id, data }));
    } catch (_err) {
      // 存不了副本時，這個分頁仍可正常使用，只是新分頁要重新登入。
    }
  }

  /** 把副本複製到這個分頁的 sessionStorage（先清空舊內容）。沒有副本時回傳 false。 */
  function copyShared(shared) {
    if (!shared) return false;
    sessionStorage.clear();
    Object.entries(shared.data).forEach(([key, value]) => {
      if (LOGIN_KEYS.includes(key)) sessionStorage.setItem(key, String(value));
    });
    sessionStorage.setItem(ID_KEY, shared.id);
    return true;
  }

  /** 這個分頁還沒登入、但已有副本時複製過來（新分頁）。有複製回傳 true。 */
  function restore() {
    if (sessionStorage.getItem("user_role")) return false;
    return copyShared(readShared());
  }

  /** 登入頁用：改用副本的登入（不論這個分頁原本是什麼），回傳角色；沒有副本回傳 null。 */
  function adopt() {
    const shared = readShared();
    return copyShared(shared) ? sessionStorage.getItem("user_role") : null;
  }

  /** 副本裡的 token，登入新帳號前要一起登出，維持一個瀏覽器只有一組登入。 */
  function sharedTokens() {
    const shared = readShared();
    if (!shared) return [];
    const { data } = shared;
    return [data.student1_token, data.student2_token, data.token].filter(
      (value, index, list) => value && list.indexOf(value) === index
    );
  }

  /**
   * 登出或登入失效時呼叫，要在清空 sessionStorage 之前：副本是這個分頁的登入才刪除。
   * 這個分頁的登入如果已經被別的分頁換掉，就不能刪掉別人的新登入。force 則一律刪除。
   */
  function forget(options) {
    const shared = readShared();
    if (!shared) return;
    if ((options && options.force) || shared.id === sessionStorage.getItem(ID_KEY)) {
      removeShared();
    }
  }

  /**
   * 這個分頁的登入是否已被別的分頁登出或換掉。
   * 沒有 ID_KEY 的分頁（本功能上線前就登入的）不判斷，維持原本行為。
   */
  function isStale() {
    const mine = sessionStorage.getItem(ID_KEY);
    if (!mine || !sessionStorage.getItem("user_role")) return false;
    const shared = readShared();
    return !shared || shared.id !== mine;
  }

  function leave() {
    // 先清空 sessionStorage：leave-confirm.js 看到沒有登入就不會跳出「確定離開嗎」擋住導頁。
    sessionStorage.clear();
    global.location.replace(homeHref);
  }

  // 頁面載入、從上一頁快取（bfcache）返回時檢查：分頁在背景被凍結或快取時收不到 storage 事件。
  function check() {
    if (isStale()) leave();
  }

  global.addEventListener("storage", (event) => {
    // key 為 null 代表整個 localStorage 被清空。
    if (event.key !== SHARED_KEY && event.key !== null) return;
    if (isStale()) {
      leave();
      return;
    }
    if (!sessionStorage.getItem("user_role") && readShared() && onSharedLogin) onSharedLogin();
  });
  global.addEventListener("pageshow", (event) => {
    if (event.persisted) check();
  });

  global.WebGameLogin = {
    save,
    restore,
    adopt,
    sharedTokens,
    forget,
    /** 登入頁用：這個分頁還沒登入時，別的分頁登入成功就呼叫 callback。 */
    onSharedLogin(callback) {
      onSharedLogin = callback;
    },
  };

  if (!isLoginPage) {
    check();
    restore();
  }
})(window);
