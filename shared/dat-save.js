// 單局的成績送出與畫面狀態。網路中斷可能已完成寫入，不能自動重送。
(function () {
  const messages = {
    idle: '',
    saving: '儲存中…',
    saved: '成績已儲存',
    failed: '成績儲存失敗，請重試',
    unknown: '存檔結果未確認，請先確認紀錄，避免重複送出',
  };

  async function request(url, body, timeoutMs, player) {
    const controller = new AbortController();
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
          timer = setTimeout(() => { resolve('unknown'); controller.abort(); }, timeoutMs);
        }),
      ]);
    } catch {
      return 'unknown';
    } finally {
      clearTimeout(timer);
    }
  }

  function create({ url, onChange = () => {}, timeoutMs = 10000 }) {
    const records = new Map();
    let latestStage = 0;
    let savedStage = 0;
    let status = 'idle';
    function publish(next) {
      status = next;
      onChange({ status, message: messages[status], retryable: status === 'failed' });
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
      save(stage, payload, player) {
        if (savedStage >= stage) return Promise.resolve(true);
        const existing = records.get(stage);
        if (existing) return existing.pending || Promise.resolve(existing.status === 'saved');
        // 序列化同局寫入，避免 checkpoint 與最終成績同時送出。
        const pending = [...records.values()].find((record) => record.pending);
        if (pending) return pending.pending.then(() => this.save(stage, payload, player));
        if ([...records.values()].some((record) => record.status === 'unknown')) return Promise.resolve(false);
        latestStage = stage;
        const record = { body: JSON.stringify(payload), player, status: 'idle', pending: null };
        records.set(stage, record);
        return send(stage, record);
      },
      retry() {
        const record = records.get(latestStage);
        if (!record) return Promise.resolve(false);
        if (record.pending) return record.pending;
        return record.status === 'failed' ? send(latestStage, record) : Promise.resolve(record.status === 'saved');
      },
    };
  }
  window.DatSave = { create };
})();
