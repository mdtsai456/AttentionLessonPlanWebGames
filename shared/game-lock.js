// 同帳號雙分頁玩同一款遊戲的鎖定：見 docs/adr/0006-game-lock.md。
// 每個遊戲頁載入後自動呼叫 start()（讀取 window.WEBGAME_GAME_ID），
// 之後每 10 秒送心跳；shared/leave-confirm.js 的 window.leaveTo 會呼叫 release()，
// 分頁直接關閉時靠心跳逾時（後端預設 30 秒）讓鎖自動換人，不依賴 release 一定送達。
(function (global) {
  const HEARTBEAT_MS = 10000;
  const holders = [];

  /** 後端位址統一由 shared/api-base.js 決定（各頁在 <head> 最先載入），不在這裡另寫一份。 */
  function apiBase() {
    return global.resolveApiBase();
  }

  /** sessionStorage 中正在使用的 token。雙人模式兩位玩家的 token 各自取鎖。 */
  function tokensInUse() {
    return [
      sessionStorage.getItem("student1_token"),
      sessionStorage.getItem("student2_token"),
      sessionStorage.getItem("token"),
    ].filter(function (value, index, list) {
      return value && list.indexOf(value) === index;
    });
  }

  function callLock(path, token, body) {
    return fetch(apiBase() + "/game-lock/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body),
    });
  }

  function ensureStyle() {
    if (document.getElementById("webgame-lock-blocked-style")) return;
    const style = document.createElement("style");
    style.id = "webgame-lock-blocked-style";
    style.textContent = `
.webgame-lock-blocked{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(30,20,10,.7);font-family:inherit}
.webgame-lock-blocked__card{max-width:min(26rem,86vw);padding:1.8rem 2rem;border-radius:1.2rem;background:#fffaf0;color:#4a3420;text-align:center;box-shadow:0 12px 32px rgba(0,0,0,.3)}
.webgame-lock-blocked__card h2{margin:0 0 .6rem;font-size:1.4rem}
.webgame-lock-blocked__card p{margin:0;font-size:1.05rem;line-height:1.5}`;
    document.head.appendChild(style);
  }

  /** 顯示無法繼續的提示並暫停遊戲。一次只顯示一個，不會疊出多個提示框。 */
  function showBlocked(message) {
    if (global.WebGameRuntime) global.WebGameRuntime.pause("game-lock");
    ensureStyle();
    let overlay = document.getElementById("webgame-lock-blocked");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "webgame-lock-blocked";
      overlay.className = "webgame-lock-blocked";
      overlay.innerHTML =
        '<div class="webgame-lock-blocked__card" role="alertdialog" aria-modal="true">' +
        "<h2>無法繼續</h2><p></p></div>";
      document.body.appendChild(overlay);
    }
    overlay.querySelector("p").textContent = message;
  }

  function scheduleHeartbeat(holder) {
    holder.timerId = global.setInterval(function () {
      callLock("heartbeat", holder.token, { gameId: holder.gameId, lockId: holder.lockId })
        .then(function (res) {
          if (res.status === 409) {
            global.clearInterval(holder.timerId);
            showBlocked("已在另一個分頁繼續這款遊戲。");
          }
        })
        .catch(function () {
          // 單次心跳失敗先不處理，下次再試；網路短暫斷線不該擋住正在玩的人。
        });
    }, HEARTBEAT_MS);
  }

  function acquireFor(token, gameId) {
    return callLock("acquire", token, { gameId })
      .then(function (res) {
        if (res.status === 409) {
          showBlocked("此遊戲已在另一個分頁進行中，請先關閉該分頁再繼續。");
          return null;
        }
        if (!res.ok) return null; // 其餘失敗（網路、伺服器錯誤）不擋遊戲，寧可漏抓也不要擋到正常遊玩。
        return res.json().then(function (body) {
          return body.lockId;
        });
      })
      .catch(function () {
        return null;
      });
  }

  /** 進入遊戲時呼叫一次。gameId 需與後端 KNOWN_GAME_NAMES 一致（DCCS/DAT/EFT/IM/TGame）。 */
  function start(gameId) {
    tokensInUse().forEach(function (token) {
      acquireFor(token, gameId).then(function (lockId) {
        if (!lockId) return;
        const holder = { token, gameId, lockId, timerId: 0 };
        holders.push(holder);
        scheduleHeartbeat(holder);
      });
    });
  }

  /** 離開或結算成功時呼叫；beforeunload/pagehide 時也會呼叫，用 keepalive 盡量送達。 */
  function release() {
    const releasing = holders.splice(0, holders.length);
    releasing.forEach(function (holder) {
      global.clearInterval(holder.timerId);
      fetch(apiBase() + "/game-lock/release", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + holder.token },
        body: JSON.stringify({ gameId: holder.gameId, lockId: holder.lockId }),
        keepalive: true,
      }).catch(function () {});
    });
  }

  // 離開頁面時放掉鎖；若是進了上一頁快取（bfcache），之後從快取返回時要再取一次，
  // 否則還原的遊戲畫面沒有鎖、也沒有心跳。已結算（release 過）的遊戲不再取。
  let resumeGameId = "";
  global.addEventListener("pagehide", function () {
    resumeGameId = holders.length ? holders[0].gameId : "";
    release();
  });
  global.addEventListener("pageshow", function (event) {
    if (!event.persisted || !resumeGameId) return;
    const gameId = resumeGameId;
    resumeGameId = "";
    start(gameId);
  });

  global.WebGameLock = { start, release };

  if (global.WEBGAME_GAME_ID) start(global.WEBGAME_GAME_ID);
})(window);
