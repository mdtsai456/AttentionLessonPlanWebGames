// 單局的成績送出與畫面狀態。網路中斷可能已完成寫入，不會自己重送。
// 每筆成績在第一次送出時產生 submissionId（data.submissionId），之後重送沿用同一個 body；
// 後端用「學生身分 + submissionId」決定場次編號，重複收到同一筆會回同一個 sessionId，
// 所以結果不明（逾時、斷線）的成績可以由玩家重試或離開時再送一次，不會多一列。
(function () {
  const messages = {
    idle: '',
    saving: '儲存中…',
    saved: '成績已儲存',
    failed: '成績儲存失敗，請重試',
    unknown: '存檔結果未確認，請先確認紀錄，避免重複送出',
    // 有 submissionId：重送不會多一筆
    unknownRetryable: '存檔結果未確認，請按重試（不會重複記錄）',
  };

  // 有 submissionId 才能安全重送結果不明的成績；沒有 WebGameApi.uuid 時維持舊行為（不重送）。
  function withSubmissionId(payload) {
    const submissionId = window.WebGameApi?.uuid?.();
    if (!submissionId || !payload?.data || typeof payload.data !== 'object') return { body: payload, submissionId: null };
    return { body: { ...payload, data: { ...payload.data, submissionId } }, submissionId };
  }

  function resendable(record) {
    return record.status === 'failed' || (record.status === 'unknown' && Boolean(record.submissionId));
  }

  // 確認離開後遊戲時鐘維持暫停，被包裝的 setTimeout 不會觸發；逾時改用原生計時器。
  function timers() {
    const runtime = window.WebGameRuntime;
    return runtime?.nativeSetTimeout
      ? { set: runtime.nativeSetTimeout, clear: runtime.nativeClearTimeout }
      : { set: setTimeout, clear: clearTimeout };
  }

  async function request(url, body, timeoutMs, player) {
    const controller = new AbortController();
    const clock = timers();
    let timer;
    const payload = JSON.parse(body);
    try {
      return await Promise.race([
        (async () => {
          const response = window.WebGameApi?.submitSession
            ? await window.WebGameApi.submitSession(payload, { url, player, signal: controller.signal })
            : await fetch(url, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body, signal: controller.signal,
            });
          if (!response.ok) {
            // 代理層可能在後端完成寫入後才回傳錯誤。
            if (response.status === 408 || response.status >= 502) return 'unknown';
            return 'failed';
          }
          const data = await response.json();
          return data?.sessionId ? 'saved' : 'unknown';
        })(),
        new Promise((resolve) => {
          timer = clock.set(() => { resolve('unknown'); controller.abort(); }, timeoutMs);
        }),
      ]);
    } catch {
      return 'unknown';
    } finally {
      clock.clear(timer);
    }
  }

  function create({ url, onChange = () => {}, timeoutMs = 10000 }) {
    const records = new Map();
    let latestStage = 0;
    let savedStage = 0;
    let status = 'idle';
    function publish(next) {
      status = next;
      const record = records.get(latestStage);
      const retryable = Boolean(record) && record.status === status && resendable(record);
      const message = status === 'unknown' && retryable ? messages.unknownRetryable : messages[status];
      onChange({ status, message, retryable });
    }
    function send(stage, record) {
      record.status = 'saving';
      publish('saving');
      record.pending = request(url, record.body, timeoutMs, record.player).then((result) => {
        record.status = result;
        record.pending = null;
        if (result === 'saved') savedStage = Math.max(savedStage, stage);
        if (stage === latestStage) publish(result);
        return result === 'saved';
      });
      return record.pending;
    }
    return {
      get status() { return status; },
      get savedStage() { return savedStage; },
      canRestart: () => status === 'idle' || status === 'saved',
      get retryable() {
        const record = records.get(latestStage);
        return Boolean(record) && !record.pending && resendable(record);
      },
      // waited：排隊等過的那一筆。剛拿到結果（例如逾時）就不立刻再送一次，等玩家下一個動作。
      save(stage, payload, player, waited = null) {
        if (savedStage >= stage) return Promise.resolve(true);
        const existing = records.get(stage);
        if (existing?.pending) return existing.pending;
        // 序列化同局寫入，避免 checkpoint 與最終成績同時送出。
        const pending = [...records.values()].find((record) => record.pending);
        if (pending) return pending.pending.then(() => this.save(stage, payload, player, pending));
        // 這一關或更高關卡已經有紀錄（例如第 6 關最終成績）：不再送較低的檢查點，
        // 改處理最高那一筆。明確失敗或結果不明（有 submissionId）就用原本的 body 重送，
        // 成功即算完成；不能重送（沒有 submissionId 的未知結果）就維持那一筆的狀態。
        const [targetStage, target] = [...records.entries()].filter(([other]) => other >= stage)
          .sort(([a], [b]) => b - a)[0] || [];
        if (target) {
          latestStage = targetStage;
          if (target.status === 'saved') return Promise.resolve(true);
          if (target !== waited && resendable(target)) return send(targetStage, target);
          publish(target.status);
          return Promise.resolve(false);
        }
        // 不同關卡是另一筆紀錄（新的 submissionId）：先前的中場紀錄結果不明時，
        // 最終成績仍照常送出，畫面改顯示最新這筆的狀態。
        latestStage = stage;
        const { body, submissionId } = withSubmissionId(payload);
        const record = { body: JSON.stringify(body), submissionId, player, status: 'idle', pending: null };
        records.set(stage, record);
        return send(stage, record);
      },
      retry() {
        const record = records.get(latestStage);
        if (!record) return Promise.resolve(false);
        if (record.pending) return record.pending;
        return resendable(record) ? send(latestStage, record) : Promise.resolve(record.status === 'saved');
      },
    };
  }
  window.DatSave = { create };
})();
