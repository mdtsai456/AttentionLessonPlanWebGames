// Home / Select / Back 共用的後端位址與登入、查詢。
(function (global) {
  const DEV_HOSTS = { localhost: true, "127.0.0.1": true };

  function resolveApiBase() {
    if (global.API_BASE_URL) return global.API_BASE_URL;
    const { hostname, protocol } = global.location;
    if (DEV_HOSTS[hostname]) {
      return `${protocol}//${hostname}:5001/api`;
    }
    return "https://attention-lesson-plan-transfer-data.zeabur.app/api";
  }

  async function postJson(path, body) {
    return fetch(`${resolveApiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function loginStudent(account, password) {
    const res = await postJson("/auth/student/login", { account, password });
    if (!res.ok) return null;
    return res.json();
  }

  async function loginTeacher(account, password) {
    const res = await postJson("/auth/teacher/login", { account, password });
    if (!res.ok) return null;
    return res.json();
  }

  async function authGet(path, token) {
    const res = await fetch(`${resolveApiBase()}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401 && global.WedGameSession) {
      global.WedGameSession.expireSession(true);
    }
    return res;
  }

  async function logout(token) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      await fetch(`${resolveApiBase()}/auth/logout`, { method: "POST", headers });
    } catch (_err) {
      // 本機狀態仍會清掉，後端失敗不擋登出。
    }
  }

  async function logoutAll() {
    const tokens = [
      sessionStorage.getItem("student1_token"),
      sessionStorage.getItem("student2_token"),
      sessionStorage.getItem("token"),
    ].filter((value, index, list) => value && list.indexOf(value) === index);

    await Promise.all(tokens.map((token) => logout(token)));
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

  global.WedGameApi = {
    resolveApiBase,
    loginStudent,
    loginTeacher,
    authGet,
    logout,
    logoutAll,
    fetchAttention,
    mapGameId,
    progressFromRecord,
  };
})(window);
