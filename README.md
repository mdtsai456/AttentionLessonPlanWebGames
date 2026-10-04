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

## DAT

動物圖向素材平台抓取：

`https://attention-lesson-plan-assets.zeabur.app/api/students/{學生ID}/assets`

網址裡的學生 ID 用後端個案編號 `caseId` 補成三位數。例如登入的是 `S01`，實際打 `S001`。目前同一個個案編號只對應一種場域，所以網址不含年級與場域。成績存檔仍用原本的 `caseId`，不會改成三位數。沒有客製圖時用本機 `assets/animals/` 的預設圖。

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

### Single

- 

### Double

- 

## Login Page



## Data Management System Page



## 瀏覽器測試（e2e）

`e2e/` 用 Playwright 在 Chromium、Firefox、WebKit 實際開遊戲頁面測試，目前涵蓋 DAT 雙人版的鍵盤／畫面按鈕瞄準與作答、離開與存檔流程、正式與練習題型，以及返回按鈕的 Space／Enter／數字鍵盤 Enter 操作。測試會自己用 `python3 -m http.server` 提供 repo 根目錄、攔下存檔 API（不會寫進資料庫）。練習遊玩測試保留每題 10 秒計時，存檔流程測試則快轉 `Date.now` 跳過每關 60 秒。

```bash
cd e2e
npm install
npx playwright install chromium firefox webkit   # 第一次才需要
npm test
# 只跑其中一種瀏覽器：npm test -- --project=chromium
```

預設使用 port 18431、2 個 worker，可用 `E2E_PORT`、`E2E_WORKERS` 調整。`E2E_ROOT` 可指向另一份程式碼（例如舊版）來比較。

相關檔案的 PR 與推送至 `main` 會由 GitHub Actions 自動執行三種瀏覽器的測試，並保留報告與失敗追蹤 7 天。測試攔截 API 與素材服務，因此通過代表前端流程通過驗證，實際後端存檔與正式環境素材仍需部署後確認。
