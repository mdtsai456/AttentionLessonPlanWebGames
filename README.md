# Attention Lesson Plan WebGames

## Zeabur 前端部署

前端服務使用專案根目錄的 `zbpack.json`，以靜態網站模式部署，輸出目錄為 `.`。
根目錄的 `index.html` 會自動導向 `Home/index.html`，因此直接開啟
`https://attention-webgames.zeabur.app/` 即可進入登入頁。

正式後端為 `https://attention-lesson-plan-data.zeabur.app`，前端 API 前綴為
`https://attention-lesson-plan-data.zeabur.app/api`；本機開發仍使用 `localhost` 或
`127.0.0.1` 的 5001 port。

後端 Zeabur 服務的環境變數需允許前端網域：

```text
CORS_ALLOW_ORIGINS=https://attention-webgames.zeabur.app
```

若已允許其他網域，將此前端網域加入逗號分隔的清單。設定後需重新部署或啟動後端。
此值只填網域 origin，不含 `/Home/index.html` 路徑或結尾斜線。

請保留整個專案的目錄結構，讓 `Home`、`shared` 與各遊戲頁面的相對路徑正常運作。
這項修正推送至 Zeabur 前端服務所追蹤的分支後，需重新部署前端服務才會生效。

## 登入保護與測試

現行 19 個學生頁與老師後台先呼叫 `GET /api/auth/me`，驗證角色、模式及學生欄位後才依序載入功能腳本。
雙人需要兩個學生 token。模式不符回 Select；DCCS 單人入口保留雙人轉址。
驗證失效清除本機登入；連線失敗或超過 5 秒回 Home 提示重試。
返回 bfcache 時重新驗證，等待期間禁止輸入、排程推進及成績提交；成功後恢復原狀態。
靜態 HTML、CSS 與素材仍公開可下載。舊版 `frontend/` HTML 統一轉至現行頁，跨網域須重新登入。

所有遊戲成績由 `WebGameApi.submitSession` 送出，本人學生 token 放 `Authorization`，雙人搭檔 token 放 `X-Partner-Authorization`。
後端核對成績年級／個案／場域；401 或 403 不寫入。DCCS 暫存只含成績，重送時僅送目前登入學生的紀錄。
Unity 須依 [串接指南](backend/docs/unity-integration-guide.md) 同步升級及驗收；本次不合併或部署。

```bash
cd tests/frontend
npm install
npx playwright install chromium
npm test
```

- `test:unit`：共用守門、遊戲排程與授權送出單元測試。
- `test:e2e`：獨立 Node HTTP 測試服務提供靜態頁與驗證 fixture；涵蓋學生／老師守門、模式、流程、存檔、舊網址及 bfcache。
- bfcache 測試不攔截請求，且明確斷言 `pageshow.persisted=true`。其他存檔 E2E 可攔截回模擬 201；真實寫入另外由後端測試驗證。
- `E2E_PORT` 可指定連接埠；已佔用時失敗。`SITE_ROOT` 可指定另一份 checkout。
- 真實 HTTP／MariaDB 瀏覽器驗收可執行 `LIVE_BASE_URL=http://127.0.0.1:19368 node live-check.mjs`。先在獨立測試庫建立 `browser-one`（G9/S99/TEST）、`browser-two`（G8/S88/T2），密碼 `browser-test-pw`，再啟動後端；此腳本只允許本機網址。涵蓋實際帳密登入、9 條教學路徑與各遊戲存檔函式；DCCS 使用 5 秒除錯場次，其他遊戲呼叫中場存檔函式，不代表人工完整遊玩。
- 後端完整測試必須指定獨立本機 MariaDB 的 `TEST_DB_NAME`（以 `_test` 結尾）與所有 DB credentials：見 [後端 README](backend/README.md)。不得連正式庫或把跳過 DB 測試當完整驗證。

## DAT

動物圖向素材平台抓取：

`https://attention-lesson-plan-assets.zeabur.app/api/students/{學生ID}/assets`

網址裡的學生 ID 用後端個案編號 `caseId` 補成三位數。例如登入的是 `S01`，實際打 `S001`。目前同一個個案編號只對應一種場域，所以網址不含年級與場域。成績存檔仍用原本的 `caseId`，不會改成三位數。沒有客製圖時用本機 `assets/animals/` 的預設圖。

`DAT.assets.files` 的陣列順序就是彩蛋升級順序：index 0 是第一張，連續答對 5 題升一張，答錯、漏答或未瞄準退一張；到最後一張後維持不變，不循環。素材平台如何決定這個順序，見 `mdtsai456/AttentionLessonPlan` 的 README。只有 1 張素材時，會在後面補上預設動物圖（`DAT_single/DAT_single.js`、`DAT_double/js/main.js`）。

### Single

- `DAT_single/DAT_single.js` 的 `assetStudentId()` 把 `caseId` 補成三位數後呼叫素材 API。

### Double

- `DAT_double/js/main.js` 的 `assetStudentId()` 分別把兩位玩家的個案編號補成三位數後呼叫素材 API。沒有客製圖的那位用預設圖。

## DCCS

### Single

- 

### Double

- 

## EFT

箭頭素材同樣向素材平台抓取，學生 ID 的補位規則與 DAT 相同（`shared/eft-assets.js`）。

箭頭清單是 `[箭頭00, ...EFT.assets.files]`：第一階固定是本機預設的 `箭頭00.png`，之後依 `EFT.assets.files` 的陣列順序升階。連續答對 5 題升一階，答錯或漏答降一階；到最後一階後維持不變，不循環（`shared/eft-player.js`）。有上傳素材時，預設的 `箭頭01–03` 不會出現在清單裡；只有某張上傳圖預載失敗時，該階才換成本機預設箭頭（依清單位置循環對應 `箭頭00–03`，例如第 2 階換成 `箭頭01.png`）。API 清單為空或請求失敗時，才使用 `箭頭00` 至 `箭頭03` 的完整預設序列。

### Single

- 細節見 `EFT_single/README.md`。

### Double

- 兩位玩家各自依自己的個案編號載入素材，連擊數與箭頭階數互相獨立。

## Login Page



## Data Management System Page


