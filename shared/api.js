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
    return fetch(`${resolveApiBase()}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
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

  function mapGameId(gameType) {
    if (gameType === "IM" || gameType === "InstructionGame") {
      return "InstructionGame";
    }
    return gameType;
  }

  /** 中場返回：DCCS／EFT／TGame／指令出擊前 3 關、DAT 前 10 題為 50%；其他有場次即 100%。 */
  function progressFromRecord(gameId, record) {
    const stage = record && record.stats ? Number(record.stats.stage) : NaN;
    if (!Number.isFinite(stage)) return 100;
    if ((gameId === "DCCS" || gameId === "EFT" || gameId === "TGame" || gameId === "InstructionGame") && stage <= 3) return 50;
    if (gameId === "DAT" && stage <= 10) return 50;
    return 100;
  }

  global.WedGameApi = {
    resolveApiBase,
    loginStudent,
    loginTeacher,
    authGet,
    logout,
    logoutAll,
    mapGameId,
    progressFromRecord,
  };
})(window);
