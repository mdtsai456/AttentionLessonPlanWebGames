# 同帳號雙分頁玩同一款遊戲的鎖定

日期：2026-10-20 · 狀態：accepted

## 脈絡

QA 回報：同一帳號可以同時在兩個分頁各自進入同一款遊戲，兩邊皆正常運作，沒有
任何鎖定或提示機制，兩邊可能各自寫回成績、造成資料覆蓋。

這跟 [ADR 0005](0005-block-duplicate-login.md)（擋重複登入）是兩個獨立問題：
0005 擋的是「兩次登入」產生兩個 token；但同一瀏覽器把分頁「複製」出一份時
（例如 Chrome 的「重複分頁」），新分頁會沿用同一份 `sessionStorage`，兩個分頁
可能共用**同一個** token，各自進同一款遊戲——0005 的機制完全擋不到這個情況，
需要另一套鎖定機制，鎖的對象是「分頁」，不是「登入」。

## 決策

1. **新資料表 `game_lock`**，以 `(grade, case_id, school, game_id)` 為主鍵：
   同一位學生、同一款遊戲，整張表只會有一列，天生保證「一次只有一個持有者」，
   不需要額外的唯一索引。欄位：
   - `lock_id`：這次佔用的隨機識別碼，分頁靠它確認「我是不是目前的持有者」。
   - `acquired_at` / `heartbeat_at`：取得時間、最後一次心跳時間。
2. **三個端點**（`routers/game_lock.py`，皆須學生 token）：
   - `POST /api/game-lock/acquire`：沒人持有，或持有者心跳已逾時（預設 30
     秒）→ 用 `INSERT ... ON DUPLICATE KEY UPDATE` 換成這次的 `lock_id`，回
     傳給前端；否則回 `409`「此遊戲已在另一個分頁進行中」。用一筆 SQL 完成
     「檢查＋換人」，避免兩個分頁的 acquire 交錯、都以為自己拿到鎖。
   - `POST /api/game-lock/heartbeat`：持有者定期（前端每 10 秒）刷新
     `heartbeat_at`；`lock_id` 不符（鎖已被別人拿走）回 `409`，前端據此中止
     遊戲並提示。
   - `POST /api/game-lock/release`：離開或結算成功時刪除這筆鎖，`lock_id`
     不符也視為成功（冪等，和 `delete_login_session` 的慣例一致）。
3. **過期判斷一律在 Python 用 `datetime.now(timezone.utc)` 算好再傳進 SQL
   當參數**（`acquire_game_lock` 的 `now`/`stale_before`），不在 SQL 用
   `NOW()`：原因與 [ADR 0005](0005-block-duplicate-login.md#決策) 相同——
   `NOW()` 依資料庫連線的時區設定，不保證等於 UTC。
4. **分頁關閉或當掉的情況，靠心跳逾時自動釋放**，不依賴分頁主動呼叫
   `release`（`beforeunload` 不保證執行完非同步請求）。遊戲前端（新模組
   `shared/game-lock.js`）進頁時 `acquire`，之後每 10 秒 `heartbeat`，離開
   或結算成功時呼叫 `release`；30 秒的逾時時間讓一次沒送到的心跳不會立刻
   被判定逾時，又不會讓真的關閉分頁的使用者等太久才能在另一邊重新進入。

## 風險與範圍

這是目前所有 QA 回報項目裡，牽涉面最廣、風險最高的一項：新資料表、新
API、所有遊戲都要掛上心跳模組。實際測試需要同時開兩個分頁操作；本機沒有
可連線的 MariaDB 測試環境時，後端整合測試只能略過，見
`backend/tests/test_game_lock.py` 與 PR 說明。
