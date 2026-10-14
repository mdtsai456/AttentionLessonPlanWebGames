// 學生或老師登入滿 1 小時後，清除本機登入狀態，並返回 Home。
// 到期時間使用登入回應的 expiresIn（剩餘秒數）加上本機現在時間，不受裝置時鐘快慢影響。
// 舊後端只有 expiresAt 時沿用它。舊分頁兩者都沒有時，從首次開啟頁面起算 1 小時。
(function (global) {
  const TTL_MS = 60 * 60 * 1000;
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
      expireSession(false);
      return;
    }
    timerId = global.setTimeout(function () {
      expireSession(false);
    }, Math.min(remaining, MAX_TIMEOUT));
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

  function apiBase() {
    // 與 shared/api.js 相同：覆寫網址去掉結尾斜線，避免 //auth/...
    if (global.API_BASE_URL) return String(global.API_BASE_URL).replace(/\/+$/, "");
    if (global.WebGameApi && global.WebGameApi.resolveApiBase) {
      return global.WebGameApi.resolveApiBase();
    }
    if (global.location.pathname.startsWith("/app/")) return global.location.origin + "/api";
    const hostname = global.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return global.location.protocol + "//" + hostname + ":5001/api";
    }
    return "https://attention-lesson-plan-data.zeabur.app/api";
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
    const base = apiBase();
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
      expireSession(false);
    }
  }

  global.WebGameSession = {
    ttlMs: TTL_MS,
    stampLoginExpiry: stampLoginExpiry,
    expireSession: expireSession,
  };

  arm();
  document.addEventListener("visibilitychange", check);
  global.setInterval(check, 15000);
})(window);
