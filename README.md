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

## 前端測試

`tests/frontend/` 是學生頁登入守門與單人遊戲存檔的測試。需要 Node 與 `python3`。

```bash
cd tests/frontend
npm install
npx playwright install chromium   # 第一次才需要
npm test                          # 單元測試 + E2E
```

- `npm run test:unit`：`shared/require-student.js` 的單元測試（`node --test`，不需瀏覽器）。
- `npm run test:e2e`：Playwright 用 `python3 -m http.server` 提供 repo 根目錄，在 Chromium 裡開真的頁面。預設 port 是 18931，被佔用時會直接失敗，可用 `E2E_PORT` 換。
- 設 `SITE_ROOT=<另一份 checkout>` 可以拿同一套測試去跑別的版本，例如確認修正前的程式碼會失敗。

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


