// 閒置 30 分鐘自動登出；持續操作時延長，最多到登入後 8 小時（上限由後端控制）。
// - 偵測鍵盤、滑鼠、觸控與捲動；有操作時最多每分鐘呼叫一次 /auth/heartbeat 延長登入。
// - 本機到期時先問後端（/auth/me）：別的分頁可能還在操作、已經延長；真的到期才登出並返回 Home。
// 到期時間使用回應的 expiresIn（剩餘秒數）加上本機現在時間，不受裝置時鐘快慢影響。
// 舊後端只有 expiresAt 時沿用它。舊分頁兩者都沒有時，從首次開啟頁面起算 30 分鐘。
(function (global) {
  const TTL_MS = 30 * 60 * 1000;
  // 有操作時，距離上次 heartbeat 至少隔這麼久才再送，避免每次按鍵都打後端。
  const HEARTBEAT_INTERVAL_MS = 60 * 1000;
  // 單次請求的上限：卡住的請求不能讓 heartbeatInFlight 一直是 true，否則之後都不會再延長登入。
  const REQUEST_TIMEOUT_MS = 15 * 1000;
  // 到期時連不上後端：隔這麼久再問一次，不因為暫時斷線就登出（也不去作廢其他分頁共用的登入）。
  const OFFLINE_RETRY_MS = 30 * 1000;
  const ACTIVITY_EVENTS = ["keydown", "pointerdown", "pointermove", "touchstart", "wheel", "scroll"];
  // setTimeout 延遲上限約 24.8 天，超過會溢位成立刻觸發；到點後 expireSession 會再檢查並重新排程。
  const MAX_TIMEOUT = 2 ** 31 - 1;
  const EXPIRES_KEY = "login_expires_at";
  const scriptSrc = document.currentScript && document.currentScript.src;
  const loginPageHref = new URL(
    "../Home/index.html",
    scriptSrc || global.location.href
  ).href;

  let loggingOut = false;
  let timerId = 0;
  let lastHeartbeat = 0;
  let heartbeatInFlight = false;
  let checkingServer = false;

  function isLoggedIn() {
    return Boolean(
      sessionStorage.getItem("token") ||
        sessionStorage.getItem("user_role") ||
        sessionStorage.getItem("student1_token")
    );
  }

  function isLoginPage() {
    const path = global.location.pathname.replace(/\\/g, "/");
    return /\/Home\/(?:index\.html)?$/i.test(path);
  }

  // value 可以是登入回應物件（{ expiresAt, expiresIn }）、ISO 字串或毫秒時間戳。
  function parseExpiry(value) {
    if (value && typeof value === "object") {
      if (typeof value.expiresIn === "number" && Number.isFinite(value.expiresIn)) {
        return Date.now() + value.expiresIn * 1000;
      }
      return parseExpiry(value.expiresAt);
    }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function readExpiry() {
    const expires = Number(sessionStorage.getItem(EXPIRES_KEY));
    return Number.isFinite(expires) && expires > 0 ? expires : NaN;
  }

  function schedule(expires) {
    global.clearTimeout(timerId);
    const remaining = expires - Date.now();
    if (remaining <= 0) {
      confirmThenExpire();
      return;
    }
    timerId = global.setTimeout(confirmThenExpire, Math.min(remaining, MAX_TIMEOUT));
  }

  function stampLoginExpiry(login) {
    const values = Array.isArray(login) ? login : [login];
    const parsed = values.map(parseExpiry).filter(function (value) {
      return Number.isFinite(value) && value > 0;
    });
    const next = parsed.length ? Math.min.apply(null, parsed) : Date.now() + TTL_MS;
    loggingOut = false;
    sessionStorage.setItem(EXPIRES_KEY, String(next));
    schedule(next);
  }

  function collectTokens() {
    return [
      sessionStorage.getItem("student1_token"),
      sessionStorage.getItem("student2_token"),
      sessionStorage.getItem("token"),
    ].filter(function (value, index, list) {
      return value && list.indexOf(value) === index;
    });
  }

  /**
   * 對每個 token 呼叫後端；回傳各自的 JSON（失敗時是 { status }）。
   * 連線失敗或超過 REQUEST_TIMEOUT_MS 會 throw。
   */
  function callEach(path, method) {
    const base = global.resolveApiBase();
    return Promise.all(collectTokens().map(function (token) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      // 用原生計時器：遊戲暫停時 setTimeout 會被 game-runtime.js 一起暫停，逾時不能跟著停。
      const setTimer = (global.WebGameRuntime && global.WebGameRuntime.nativeSetTimeout) || global.setTimeout;
      const timer = controller ? setTimer(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : 0;
      return fetch(base + path, {
        method: method,
        headers: { Authorization: "Bearer " + token },
        cache: "no-store",
        signal: controller ? controller.signal : undefined,
      }).then(function (res) {
        return res.ok ? res.json() : { status: res.status };
      }).finally(function () {
        global.clearTimeout(timer);
      });
    }));
  }

  function hasLifetime(body) {
    return body && typeof body.expiresIn === "number" && body.expiresIn > 0;
  }

  /** 後端給了新的到期時間：更新本機計時，也通知 require-student.js 重排它的計時。 */
  function applyServerExpiry(bodies) {
    stampLoginExpiry(bodies);
    if (global.WebGameAuth && global.WebGameAuth.extend) global.WebGameAuth.extend(readExpiry());
  }

  /** 使用者有操作時延長登入。雙人模式兩個 token 都要延長，到期時間取較早的。 */
  function sendHeartbeat() {
    heartbeatInFlight = true;
    return callEach("/auth/heartbeat", "POST").then(function (bodies) {
      if (loggingOut || !isLoggedIn()) return;
      // 401：登入已失效（例如已達 8 小時上限、或在別處登出），直接登出。
      if (bodies.some(function (body) { return body.status === 401; })) {
        expireSession(true);
        return;
      }
      if (bodies.length && bodies.every(hasLifetime)) applyServerExpiry(bodies);
    }).catch(function () {
      // 連線失敗時不處理：到期時還會再問後端一次。
    }).then(function () {
      heartbeatInFlight = false;
    });
  }

  function onActivity() {
    if (loggingOut || heartbeatInFlight || !isLoggedIn()) return;
    const now = Date.now();
    if (now - lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeat = now;
    sendHeartbeat();
  }

  /**
   * 本機到期時呼叫：先問後端是否真的到期。別的分頁可能還在操作、已經延長，
   * 後端說還有效就更新到期時間；後端說無效或連不上，才照原本流程登出。
   */
  function confirmThenExpire() {
    if (loggingOut || checkingServer || !isLoggedIn()) return;
    const expires = readExpiry();
    if (Number.isFinite(expires) && Date.now() < expires) {
      schedule(expires);
      return;
    }
    // 功能頁由 require-student.js 重新驗證並導回 Home（帶 auth=expired 提示）；
    // 這裡不再自己問後端、自己導頁，免得兩邊同時導頁、互相中斷。驗證通過後依新的到期時間重排。
    if (global.WebGameAuth && global.WebGameAuth.revalidate) {
      checkingServer = true;
      Promise.resolve(global.WebGameAuth.revalidate()).then(function () {
        checkingServer = false;
        const next = readExpiry();
        if (!loggingOut && isLoggedIn() && Number.isFinite(next) && next > Date.now()) schedule(next);
      }, function () {
        checkingServer = false;
      });
      return;
    }
    if (!collectTokens().length) {
      expireSession(false);
      return;
    }
    checkingServer = true;
    callEach("/auth/me", "GET").then(function (bodies) {
      checkingServer = false;
      if (loggingOut || !isLoggedIn()) return;
      if (bodies.every(hasLifetime)) applyServerExpiry(bodies);
      else expireSession(false);
    }, function () {
      // 連不上後端：不能確定是否真的到期，晚點再問，不在這裡登出。
      // 真的到期時，之後任何 API 都會回 401，也一樣會回登入頁。
      checkingServer = false;
      if (loggingOut || !isLoggedIn()) return;
      global.clearTimeout(timerId);
      timerId = global.setTimeout(confirmThenExpire, OFFLINE_RETRY_MS);
    });
  }

  function expireSession(force) {
    const expires = readExpiry();
    if (!force && isLoggedIn() && Number.isFinite(expires) && Date.now() < expires) {
      schedule(expires);
      return;
    }
    if (!force && !isLoggedIn()) return;
    if (loggingOut) return;
    loggingOut = true;
    global.clearTimeout(timerId);

    const tokens = collectTokens();
    const base = global.resolveApiBase();
    sessionStorage.clear();
    tokens.forEach(function (token) {
      fetch(base + "/auth/logout", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        keepalive: true,
      }).catch(function () {});
    });

    if (!isLoginPage()) {
      global.location.replace(loginPageHref);
    }
  }

  function arm() {
    if (!isLoggedIn()) return;
    let expires = readExpiry();
    if (!Number.isFinite(expires)) {
      stampLoginExpiry(Date.now() + TTL_MS);
      return;
    }
    schedule(expires);
  }

  function check() {
    if (loggingOut || !isLoggedIn()) return;
    const expires = readExpiry();
    if (Number.isFinite(expires) && Date.now() >= expires) {
      confirmThenExpire();
    }
  }

  global.WebGameSession = {
    ttlMs: TTL_MS,
    stampLoginExpiry: stampLoginExpiry,
    expireSession: expireSession,
  };

  arm();
  ACTIVITY_EVENTS.forEach(function (name) {
    // capture：捲動事件不會冒泡，要在 capture 階段才收得到元素內的捲動。
    document.addEventListener(name, onActivity, { capture: true, passive: true });
  });
  document.addEventListener("visibilitychange", check);
  global.setInterval(check, 15000);
})(window);
