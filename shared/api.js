// Home / Select / Back 共用的登入、查詢與遊戲進度。後端位址見 api-base.js。
(function (global) {
  /** 五款遊戲的固定清單。id 對應資料夾與後端欄位，name 用於畫面顯示。 */
  const GAMES = [
    { id: "DCCS", name: "賽道攔截" },
    { id: "DAT", name: "瓢蟲追擊令" },
    { id: "EFT", name: "漂浮泡泡" },
    { id: "TGame", name: "勇闖迷宮" },
    { id: "InstructionGame", name: "指令出擊" },
  ];

  /** 進度只接受這三個值。 */
  const PROGRESS_STEPS = [0, 50, 100];

  async function postJson(path, body) {
    return fetch(`${global.resolveApiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * 401 回應表示帳號或密碼錯誤，回傳 null。其他失敗拋出 Error，供畫面顯示伺服器錯誤。
   * contact 指定非 5xx 錯誤時的聯絡對象。老師登入失敗時，不提示聯絡老師。
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
      // 讀取 body 時斷線會產生 TypeError。保留原錯誤，讓畫面顯示「後端連不上」。
      if (err && err.name === "TypeError") throw err;
      throw new Error(badFormat);
    }
    // 2xx 回應未包含 token 時，視為登入失敗。例如代理伺服器回傳 {}，或 API 位址錯誤。
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
    const res = await fetch(`${global.resolveApiBase()}${path}`, {
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
      // keepalive 讓登出請求在導向頁面或關閉分頁後，仍可送至後端。
      await fetch(`${global.resolveApiBase()}/auth/logout`, {
        method: "POST",
        headers,
        keepalive: true,
      });
    } catch (_err) {
      // 後端登出失敗時，仍清除本機登入狀態。
    }
  }

  /** 取得 sessionStorage 中的登入 token，移除空值與重複值。 */
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

  /** 手錶專心判定回傳 1 或 0。1 表示專心。失敗時回傳 0，不阻止畫面顯示。 */
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

  /** 中場返回時，六款遊戲完成前 3 關的進度皆為 50%，完成 6 關為 100%。 */
  function progressFromRecord(gameId, record) {
    const stage = record && record.stats ? Number(record.stats.stage) : NaN;
    if (!Number.isFinite(stage)) return 100;
    if (stage <= 3) return 50;
    return 100;
  }

  /** 某一天各遊戲的進度。沒玩過的遊戲為 0，同一款取最高的一筆。 */
  function dayProgress(records, day, games = GAMES) {
    const progress = Object.fromEntries(games.map((game) => [game.id, 0]));
    records.forEach((record) => {
      if (Number(record.currentDay) !== Number(day)) return;
      const gameId = mapGameId(record.gameType);
      if (!(gameId in progress)) return;
      progress[gameId] = Math.max(progress[gameId], progressFromRecord(gameId, record));
    });
    return progress;
  }

  /** 將數值轉換為最接近的 0、50 或 100。後端回傳其他數值時，畫面仍可顯示三格進度條。 */
  function normalizeProgress(value) {
    const number = Number(value) || 0;
    return PROGRESS_STEPS.reduce((closest, step) =>
      Math.abs(step - number) < Math.abs(closest - number) ? step : closest
    );
  }

  function sameStudent(identity, data) {
    return identity && data && identity.grade === data.grade && identity.caseId === data.caseId && identity.school === data.school;
  }

  function sessionPlayer(payload, player) {
    const auth = global.WebGameAuth;
    const session = auth && auth.session;
    // 待送佇列裡可能有損壞的資料（沒有 data）；回 -1 讓呼叫端略過，不要整批重送中斷。
    const data = payload && payload.data;
    if (!auth || !auth.active || !data || !session || session.bodies[0].role !== 'student') return -1;
    if (data.mode === 'double' && session.mode !== 'double') return -1;
    const index = player == null ? session.bodies.findIndex((body) => sameStudent(body, data)) : player - 1;
    return sameStudent(session.bodies[index], data) ? index : -1;
  }

  /** 雙人模式的每筆成績使用本人與搭檔的 token。payload 不包含 token。 */
  async function submitSession(payload, { player, url, signal } = {}) {
    const index = sessionPlayer(payload, player);
    if (index < 0) throw Object.assign(new Error('登入未驗證或成績身分不符'), { status: 401 });
    const session = global.WebGameAuth.session;
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.tokens[index] };
    if (payload.data.mode === 'double') headers['X-Partner-Authorization'] = 'Bearer ' + session.tokens[1 - index];
    const res = await fetch(url || `${global.resolveApiBase()}/sessions`, {
      method: 'POST', headers, body: JSON.stringify(payload), signal,
    });
    if (res.status === 401) global.WebGameAuth.invalidate();
    return res;
  }

  /** UUID v4（成績的 submissionId、雙人局的 pairId 共用）。非 https 的區網網址沒有 randomUUID，改用 getRandomValues。 */
  function uuid() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  global.WebGameApi = {
    uuid,
    submitSession,
    sessionPlayer,
    loginStudent,
    loginTeacher,
    authGet,
    logout,
    logoutAll,
    storedTokens,
    fetchAttention,
    mapGameId,
    progressFromRecord,
    GAMES,
    dayProgress,
    normalizeProgress,
  };
})(window);
