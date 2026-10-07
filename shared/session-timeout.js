// 學生／老師登入滿 1 小時後清掉本機登入狀態，並回到 Home。
// 時間以登入回應的 expiresAt 為準；舊分頁沒有這個值時，從第一次打開頁面起算 1 小時。
(function (global) {
  const TTL_MS = 60 * 60 * 1000;
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

  function parseExpiry(value) {
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
    }, remaining);
  }

  function stampLoginExpiry(expiresAt) {
    const values = Array.isArray(expiresAt) ? expiresAt : [expiresAt];
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
    if (global.API_BASE_URL) return global.API_BASE_URL;
    if (global.WebGameApi && global.WebGameApi.resolveApiBase) {
      return global.WebGameApi.resolveApiBase();
    }
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
