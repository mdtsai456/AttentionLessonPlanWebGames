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

`DAT.assets.files` 的陣列順序就是彩蛋升級順序：index 0 是第一張，連續答對 5 題升一張，答錯、漏答或未瞄準退一張；到最後一張後維持不變，不循環。素材平台的順序規則見素材平台 README。只有 1 張素材時，會在後面補上預設動物圖（`DAT_single/DAT_single.js`、`DAT_double/js/main.js`）。

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

箭頭清單是 `[箭頭00, ...EFT.assets.files]`：第一階固定是本機預設的 `箭頭00.png`，之後依 `EFT.assets.files` 的陣列順序升階。連續答對 5 題升一階，答錯或漏答降一階；到最後一階後維持不變，不循環（`shared/eft-player.js`）。有上傳素材時，預設的 `箭頭01–03` 不會出現；API 清單為空或請求失敗時，才使用 `箭頭00` 至 `箭頭03` 的完整預設序列。

### Single

- 細節見 `EFT_single/README.md`。

### Double

- 兩位玩家各自依自己的個案編號載入素材，連擊數與箭頭階數互相獨立。

## Login Page



## Data Management System Page


