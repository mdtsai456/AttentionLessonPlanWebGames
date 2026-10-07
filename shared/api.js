// Home / Select / Back 共用的後端位址與登入、查詢。
(function (global) {
  const DEV_HOSTS = { localhost: true, "127.0.0.1": true };

  function resolveApiBase() {
    if (global.API_BASE_URL) return global.API_BASE_URL;
    if (global.location.pathname.startsWith("/app/")) return global.location.origin + "/api";
    const { hostname, protocol } = global.location;
    if (DEV_HOSTS[hostname]) {
      return `${protocol}//${hostname}:5001/api`;
    }
    return "https://attention-lesson-plan-data.zeabur.app/api";
  }

  async function postJson(path, body) {
    return fetch(`${resolveApiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * 401 才是帳密錯誤（回 null）；其他失敗丟出 Error，讓畫面顯示伺服器錯誤。
   * contact：非 5xx 錯誤時提示該聯絡誰（老師登入失敗時不該提示去找老師）。
   */
  async function readLoginResponse(res, contact) {
    if (res.status === 401) return null;
    if (!res.ok) {
      throw new Error(
        res.status >= 500
          ? `登入伺服器發生錯誤（HTTP ${res.status}），請稍後再試`
          : `登入失敗（HTTP ${res.status}），請聯絡${contact}`
      );
    }
    const badFormat = "登入伺服器回應格式錯誤，請稍後再試";
    let data;
    try {
      data = await res.json();
    } catch (err) {
      // 讀 body 時斷線是 TypeError，原樣丟出讓畫面顯示「後端連不上」。
      if (err && err.name === "TypeError") throw err;
      throw new Error(badFormat);
    }
    // 2xx 但沒有 token（proxy 回 {}、API 位址設錯等）不能算登入成功。
    if (!data || typeof data.token !== "string" || !data.token) {
      throw new Error(badFormat);
    }
    return data;
  }

  async function loginStudent(account, password) {
    const res = await postJson("/auth/student/login", { account, password });
    return readLoginResponse(res, "老師或管理者");
  }

  async function loginTeacher(account, password) {
    const res = await postJson("/auth/teacher/login", { account, password });
    return readLoginResponse(res, "管理者");
  }

  async function authGet(path, token) {
    const res = await fetch(`${resolveApiBase()}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401 && global.WebGameSession) {
      global.WebGameSession.expireSession(true);
    }
    return res;
  }

  async function logout(token) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      // keepalive：登出後常馬上換頁或關分頁，請求仍要送到後端。
      await fetch(`${resolveApiBase()}/auth/logout`, {
        method: "POST",
        headers,
        keepalive: true,
      });
    } catch (_err) {
      // 本機狀態仍會清掉，後端失敗不擋登出。
    }
  }

  /** 目前 sessionStorage 裡登入中的 token（去掉空值與重複）。 */
  function storedTokens() {
    return [
      sessionStorage.getItem("student1_token"),
      sessionStorage.getItem("student2_token"),
      sessionStorage.getItem("token"),
    ].filter((value, index, list) => value && list.indexOf(value) === index);
  }

  async function logoutAll() {
    await Promise.all(storedTokens().map((token) => logout(token)));
  }

  /** 手錶專心判定：回傳 1（專心）或 0。任何失敗都當 0，不擋畫面。 */
  async function fetchAttention(token) {
    if (!token) return 0;
    try {
      const res = await authGet("/attention/me", token);
      if (!res.ok) return 0;
      const body = await res.json();
      return body && body.result === 1 ? 1 : 0;
    } catch (_err) {
      return 0;
    }
  }

  function mapGameId(gameType) {
    if (gameType === "IM" || gameType === "InstructionGame") {
      return "InstructionGame";
    }
    return gameType;
  }

  /** 中場返回：六個遊戲都是打完前 3 關為 50%，打完 6 關為 100%。 */
  function progressFromRecord(gameId, record) {
    const stage = record && record.stats ? Number(record.stats.stage) : NaN;
    if (!Number.isFinite(stage)) return 100;
    if (stage <= 3) return 50;
    return 100;
  }


  function sameStudent(identity, data) {
    return identity && data && identity.grade === data.grade && identity.caseId === data.caseId && identity.school === data.school;
  }

  function sessionPlayer(payload, player) {
    const auth = global.WebGameAuth;
    const session = auth && auth.session;
    if (!auth || !auth.active || !session || session.bodies[0].role !== 'student') return -1;
    if (payload.data.mode === 'double' && session.mode !== 'double') return -1;
    const index = player == null ? session.bodies.findIndex((body) => sameStudent(body, payload.data)) : player - 1;
    return sameStudent(session.bodies[index], payload.data) ? index : -1;
  }

  /** 雙人每筆使用本人 token 與另一位學生 token，不把 token 放入 payload。 */
  async function submitSession(payload, { player, url, signal } = {}) {
    const index = sessionPlayer(payload, player);
    if (index < 0) throw Object.assign(new Error('登入未驗證或成績身分不符'), { status: 401 });
    const session = global.WebGameAuth.session;
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.tokens[index] };
    if (payload.data.mode === 'double') headers['X-Partner-Authorization'] = 'Bearer ' + session.tokens[1 - index];
    const res = await fetch(url || `${resolveApiBase()}/sessions`, {
      method: 'POST', headers, body: JSON.stringify(payload), signal,
    });
    if (res.status === 401) global.WebGameAuth.invalidate();
    return res;
  }

  global.WebGameApi = {
    submitSession,
    sessionPlayer,
    resolveApiBase,
    loginStudent,
    loginTeacher,
    authGet,
    logout,
    logoutAll,
    storedTokens,
    fetchAttention,
    mapGameId,
    progressFromRecord,
  };
})(window);
