// 當天已完成前半（第 1～3 關）時，下次進遊戲從第 4 關開始。看後端當天的成績，換裝置也成立。
(function (global) {
  const TIMEOUT_MS = 5000;

  /** sessionStorage 的 key 與 fallback 同 Select/app.js 的 fetchStudentProgress。 */
  function slotLogin(slot) {
    return {
      token: sessionStorage.getItem(`student${slot}_token`)
        || (slot === 1 ? sessionStorage.getItem("token") : ""),
      studentKey: sessionStorage.getItem(`student${slot}_key`),
      school: sessionStorage.getItem(`student${slot}_school`)
        || (slot === 1 ? sessionStorage.getItem("school") : ""),
      day: sessionStorage.getItem(`student${slot}_day`)
        || (slot === 1 ? sessionStorage.getItem("current_day") || sessionStorage.getItem("currentDay") : "")
        || "1",
    };
  }

  /**
   * 當天、同遊戲、同模式的紀錄裡有 stage 3，而且沒有 stage 4 以上。
   * 沒有 stage 的紀錄和選遊戲頁一樣當成已完成（progressFromRecord 算 100%）。
   */
  function onlyFirstHalf(records, gameId, day, mode) {
    let firstHalf = false;
    for (const record of records) {
      if (global.WebGameApi.mapGameId(record.gameType) !== gameId) continue;
      if (Number(record.currentDay) !== Number(day) || record.mode !== mode) continue;
      const stage = record.stats ? Number(record.stats.stage) : NaN;
      if (!Number.isFinite(stage) || stage >= 4) return false;
      if (stage === 3) firstHalf = true;
    }
    return firstHalf;
  }

  async function slotOnlyFirstHalf(slot, gameId, mode) {
    const { token, studentKey, school, day } = slotLogin(slot);
    if (!token || !studentKey || !school) return false;
    try {
      const res = await global.WebGameApi.authGet(
        `/students/${encodeURIComponent(studentKey)}/report?school=${encodeURIComponent(school)}`,
        token
      );
      if (!res.ok) return false;
      const body = await res.json();
      return Array.isArray(body && body.records) && onlyFirstHalf(body.records, gameId, day, mode);
    } catch (_err) {
      return false;
    }
  }

  /**
   * 回傳這一局的起始關：每個 slot 都只完成前半時回 4，否則回 1。不會 reject。
   * 超過 5 秒沒結果也回 1，不讓學生卡在載入畫面。逾時用不受遊戲暫停影響的計時器。
   */
  function startStage(gameId, { mode, slots }) {
    const checks = Promise.all(slots.map((slot) => slotOnlyFirstHalf(slot, gameId, mode)))
      .then((results) => (results.every(Boolean) ? 4 : 1));
    const setTimer = (global.WebGameRuntime && global.WebGameRuntime.nativeSetTimeout) || global.setTimeout;
    const timeout = new Promise((resolve) => setTimer(() => resolve(1), TIMEOUT_MS));
    return Promise.race([checks, timeout]);
  }

  global.WebGameSecondHalf = { startStage };
})(window);
