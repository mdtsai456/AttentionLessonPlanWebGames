# DCCS 接上遊戲大廳 — 交接說明

寫給中介平台（`backend/` + `frontend/` 的登入／DMS／大廳）的維護者。
DCCS 已經接上 `frontend/games.html` 的大廳，這份文件說明**怎麼接的**、
**動了你哪些東西**，以及**有一件事希望改由後端負責**。

## 1. 怎麼接的：同源 + sessionStorage，不經 URL

大廳（`frontend/games.html`）與遊戲（`frontend/dccs/index.html`）同源，
學生登入後 `frontend/js/app.js` 寫進 `sessionStorage` 的東西，遊戲直接讀得到。
所以大廳**不需要**把受試者資料透過 URL query 或 postMessage 傳給遊戲，
它只要把使用者導過去。

遊戲端讀的鍵（都是 `app.js` 既有的，沒有要求你新增）：

| 鍵 | 用途 |
|---|---|
| `student1_key` / `student2_key` | `G1_S03` 形式，遊戲切開取 `grade` / `caseId` |
| `student1_school` / `student2_school` | `school`（兩位可以不同校，遊戲各自帶各自的） |
| `student1_token` / `student2_token` / `token` | 查詢既有場次用的 Bearer token |
| `game_mode` | `double` 且第二位存在才走雙人版 |

對應程式碼：`frontend/dccs/js/lobby.js`。

## 2. 動了你哪些東西

### `backend/main.py`：前端改由你這支服務一併提供

原本我們另外有一支 `serve.py`（純標準函式庫的靜態伺服器），與你的 FastAPI
併存，造成兩個 server、兩個 port、需要 CORS。現已整併掉：

```python
if _FRONTEND_DIR.is_dir():
    app.mount("/app", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
```

- 掛在 `/app`，**不遮蔽** `/api/*`、`/health`、`/demo`、`GET /`，也不會跟
  日後新增的 API 路由相撞。入口是 `/app/`。
- **只掛 `frontend/` 一個目錄**，後端原始碼與 `.env` 不在其中。這比先前
  「伺服整個 repo 根、再用黑名單擋掉 `backend/`」安全。
- 前端與 `/api/*` 同源 → **瀏覽器端不再需要任何 CORS 放行**。
  `CORS_ALLOW_ORIGINS` 只在前端哪天獨立部署到別的網域時才需要。
- `backend/serve.py` 已刪除；原本的 `POST /api/results`（成績寫成 txt）
  一併移除——雲端部署上檔案是暫存性質，留著會讓人誤以為資料安全。送出
  失敗改由瀏覽器 `localStorage` 暫存、下次開場自動重送。
- 新增 `backend/tests/test_frontend_static.py`（4 項，不碰資料庫），涵蓋
  `/app/` 進入點、ES module 的 content-type、既有路由未被遮蔽、以及後端
  原始碼與 `.env` 透過各種 `..` 寫法都拿不到。

部署不需要改 `Procfile`：`uvicorn main:app` 照舊，只要 `frontend/` 跟
`backend/` 一起部署即可。目錄不存在時會跳過掛載，不會啟動失敗。

## 3. 動了你哪一行（前端）

只有 `frontend/games.html` 裡「開始挑戰」的 click handler。原本五款遊戲
一律跳 `alert()` 佔位；現在多一張 `GAME_PAGES` 對照表，**已接上的遊戲導向
實際頁面，沒接上的維持原本的 alert**：

```js
const GAME_PAGES = {
  DCCS: ["dccs/index.html", "dccs/double.html"],
};
```

DAT／EFT 之後接上時，在這張表加一行就好，不必再動 handler 邏輯。

## 4. 想請你接手的一件事：`currentDay`

### 現況（遊戲端的權宜做法）

`mountDCCS()` 需要 `currentDay`（第幾個施測日），但中介平台**目前沒有任何
端點會回答「這個學生今天是第幾天」**。`current_day` 只在兩個地方出現：
寫入時從 payload 帶進來、讀歷史場次時撈出來。

所以遊戲端目前自己推導（`lobby.js` 的 `resolveCurrentDay()`）：

1. 打 `GET /api/students/{studentKey}/sessions?school=...`（學生用自己的
   token 就讀得到自己的紀錄，見 `backend/routers/identity.py:98`）
2. 有今天的場次 → 沿用那一場的 `currentDay`
   （依 `backend/CONTEXT.md`：同一施測日的 5 款遊戲共用同一個值）
3. 沒有 → 歷史最大值 `+ 1`
4. 完全沒紀錄 → `1`

推導失敗（沒 token、API 不通、雙人兩位算出來不一致）時**一律退回手動表單**，
不會默默猜一個值 —— 猜錯會直接污染研究資料。

### 為什麼希望改由後端負責

- **五款遊戲都要同一個值。** 每一款各自在前端算，只要有一款邏輯寫得不一樣，
  同一個施測日就會被拆成兩天。這個值應該只有一份實作。
- **多一次往返。** 每次開遊戲都要先查一次歷史場次。
- **時區。** 後端存的是 UTC naive，而「施測日」是本地日曆上的一天。遊戲端
  目前是把時間戳轉回本地時區再比對日期；這個換算放在後端做比較妥當。

### 建議

在學生登入的回應（`POST /api/auth/student/login`）裡直接多帶一個
`currentDay`，或另開一支 `GET /api/students/{key}/current-day`。
任一種都行，遊戲端只要把 `resolveCurrentDay()` 換成讀那個值即可，
其餘不用動。

## 5. 順帶一提：`grade` / `caseId` 已經有了

`backend/routers/auth.py:85-87` 的登入回應其實就有回 `grade` 和 `caseId`，
只是 `frontend/js/app.js:162` 只存了 `studentKey`。遊戲端目前自己用 `_` 切
（只切第一個底線，所以 caseId 含底線也不會錯）。你若順手把這兩個也存進
sessionStorage，遊戲端可以少做一次字串處理，但**不改也完全能運作**。
