// 同一個瀏覽器的分頁共用一組登入。
//
// 登入資料仍存在各分頁自己的 sessionStorage，遊戲照舊讀它；另外在 localStorage 放一份副本：
// - 新分頁開啟時，把副本複製到自己的 sessionStorage，不用重新登入。
// - 登出、登入失效或換帳號時，副本會被刪除或換掉。其他分頁收到 storage 事件後清掉自己的
//   登入並回登入頁，避免繼續用舊帳號作答、成績記到別人名下。
//
// 副本只記錄「誰登入了」；登入是否仍有效，一律由 require-student.js 呼叫 /auth/me 判斷。
//
// 只有「還有這組登入的分頁開著」時才共用：每個登入中的分頁每 10 秒在 ALIVE_KEY 記一次自己還在，
// 關閉分頁（pagehide）時移除自己。新分頁、登入頁只在 30 秒內有分頁回報過時才沿用副本。
// 共用電腦上，學生沒登出就關掉整個瀏覽器，下一位打開網站時要重新登入，不會進到前一位的帳號。
// 各功能頁要在 require-student.js 之前同步載入本檔。
// 登入頁加 data-restore="manual"：不自動複製，由 Home/app.js 決定要不要直接進入。
(function (global) {
  const SHARED_KEY = "webgame_login";
  // 這個分頁目前用的是哪一次登入；和副本的 id 不同，代表別的分頁已登出或換了帳號。
  const ID_KEY = "login_share_id";
  // 還開著的分頁：{ id: 副本 id, tabs: { 分頁 id: 最後回報時間 } }。和副本分開存，
  // 定期回報不會觸發其他分頁對 SHARED_KEY 的 storage 處理。
  const ALIVE_KEY = "webgame_login_alive";
  // 這個分頁的 id，存在 sessionStorage：同一個分頁換頁後沿用，複製分頁時兩邊會不同。
  const TAB_KEY = "login_share_tab";
  const BEAT_MS = 10 * 1000;
  const ALIVE_WINDOW_MS = 30 * 1000;
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
  // 先記住原生的計時器：遊戲頁之後會由 game-runtime.js 換成可暫停的版本，暫停時不能停止回報。
  const nativeSetInterval = typeof global.setInterval === "function" ? global.setInterval.bind(global) : null;

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

  function tabId() {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = newId();
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  }

  function readAlive() {
    try {
      const value = JSON.parse(global.localStorage.getItem(ALIVE_KEY));
      return value && typeof value.id === "string" && value.tabs && typeof value.tabs === "object"
        ? value
        : null;
    } catch (_err) {
      return null;
    }
  }

  function writeAlive(value) {
    try {
      global.localStorage.setItem(ALIVE_KEY, JSON.stringify(value));
    } catch (_err) {
      // localStorage 無法使用時本來就沒有副本可共用。
    }
  }

  /** 最近 ALIVE_WINDOW_MS 內是否有這組登入的分頁回報過。 */
  function isAlive(shared) {
    const alive = readAlive();
    if (!alive || alive.id !== shared.id) return false;
    const now = Date.now();
    return Object.values(alive.tabs).some((at) => typeof at === "number" && now - at < ALIVE_WINDOW_MS);
  }

  /** 這個分頁用的是副本那組登入時，回報自己還開著；順便清掉太久沒回報的分頁。 */
  function beat() {
    const mine = sessionStorage.getItem(ID_KEY);
    if (!mine || !sessionStorage.getItem("user_role")) return;
    const shared = readShared();
    if (!shared || shared.id !== mine) return;
    const now = Date.now();
    const alive = readAlive();
    const tabs = {};
    if (alive && alive.id === mine) {
      Object.entries(alive.tabs).forEach(([id, at]) => {
        if (typeof at === "number" && now - at < ALIVE_WINDOW_MS) tabs[id] = at;
      });
    }
    tabs[tabId()] = now;
    writeAlive({ id: mine, tabs });
  }

  /** 分頁關閉或換頁時移除自己；最後一個分頁關掉後，副本就不再被新分頁沿用。 */
  function dropTab() {
    const mine = sessionStorage.getItem(ID_KEY);
    const id = sessionStorage.getItem(TAB_KEY);
    const alive = readAlive();
    if (!mine || !id || !alive || alive.id !== mine || !(id in alive.tabs)) return;
    delete alive.tabs[id];
    writeAlive(alive);
  }

  /** 登入成功、sessionStorage 寫好之後呼叫：把這次登入存成副本，給其他分頁使用。 */
  function save() {
    const data = {};
    LOGIN_KEYS.forEach((key) => {
      const value = sessionStorage.getItem(key);
      if (value !== null) data[key] = value;
    });
    const id = newId();
    try {
      // 先記「這組登入有分頁開著」，再寫副本：其他分頁收到副本的 storage 事件時，
      // 要能同時讀到這筆紀錄，停在登入頁的分頁才會跟著進入。
      global.localStorage.setItem(ALIVE_KEY, JSON.stringify({ id, tabs: { [tabId()]: Date.now() } }));
      global.localStorage.setItem(SHARED_KEY, JSON.stringify({ id, data }));
    } catch (_err) {
      // 存不了副本時，這個分頁仍可正常使用，只是新分頁要重新登入。
      // 不記 ID_KEY：否則下一頁會因為「找不到副本」被當成已在別處登出，永遠進不去。
      sessionStorage.removeItem(ID_KEY);
      return;
    }
    sessionStorage.setItem(ID_KEY, id);
    beat();
  }

  /** 把副本複製到這個分頁的 sessionStorage（先清空舊內容）。沒有副本、或已沒有分頁開著時回傳 false。 */
  function copyShared(shared) {
    if (!shared || !isAlive(shared)) return false;
    const tab = sessionStorage.getItem(TAB_KEY);
    sessionStorage.clear();
    if (tab) sessionStorage.setItem(TAB_KEY, tab);
    Object.entries(shared.data).forEach(([key, value]) => {
      if (LOGIN_KEYS.includes(key)) sessionStorage.setItem(key, String(value));
    });
    sessionStorage.setItem(ID_KEY, shared.id);
    beat();
    return true;
  }

  /** 這個分頁還沒登入、但已有副本時複製過來（新分頁）。有複製回傳 true。 */
  function restore() {
    if (sessionStorage.getItem("user_role")) return false;
    return copyShared(readShared());
  }

  /** 登入頁用：改用副本的登入（不論這個分頁原本是什麼），回傳角色；沒有可用的副本回傳 null。 */
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
    if (!isStale()) return false;
    leave();
    return true;
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
    if (event.persisted && !check()) beat();
  });
  global.addEventListener("pagehide", dropTab);
  if (nativeSetInterval) nativeSetInterval(beat, BEAT_MS);

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
    // 已被別的分頁登出或換帳號時只回登入頁，不能接著把另一組登入複製進來。
    if (!check() && !restore()) beat();
  }
})(window);
