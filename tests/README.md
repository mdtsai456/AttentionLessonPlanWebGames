# 自動化測試

這個資料夾有兩套前端測試。

- 這裡的 `unit/`、`e2e/`：瓢蟲追擊令（`DAT_single/`、`DAT_double/`）的彩蛋、六關流程、鍵鼠、素材與存檔。
- [`frontend/`](frontend/)：全站登入守門、選遊戲、存檔、舊網址與 bfcache。執行方式見下方「全站流程」。

## 全站流程

```bash
cd tests/frontend
npm install
npx playwright install chromium
npm test
```

- `test:unit`：共用守門、遊戲排程與授權送出。
- `test:e2e`：用獨立的 Node 測試服務提供靜態頁與驗證資料。
- `E2E_PORT` 可指定連接埠，已被佔用就失敗。`SITE_ROOT` 可改測另一份程式。
- 真實後端與 MariaDB 的瀏覽器檢查是 `LIVE_BASE_URL=http://127.0.0.1:19368 node live-check.mjs`。腳本只接受本機網址。先備好測試帳號再啟動後端，做法見專案根目錄 README 的測試表，以及 [`../backend/README.md`](../backend/README.md)。

## 瓢蟲追擊令

`unit/` 與 `e2e/` 涵蓋彩蛋規則、完整六關、桌面鍵鼠、素材容錯與存檔狀態。

```bash
cd tests
npm install        # 只安裝 playwright-core，不會下載瀏覽器
npm test           # 單元測試 + E2E，約 3 分鐘（機器忙碌時會更久）
npm run test:unit  # 只跑單元測試（不需要瀏覽器）
npm run test:e2e   # 只跑 E2E
```

E2E 預設使用 macOS 的 Google Chrome（`/Applications/Google Chrome.app`）。其他環境請用 `CHROME_PATH` 指定 Chrome / Chromium 執行檔：

```bash
CHROME_PATH=/usr/bin/chromium npm run test:e2e
```

其他環境變數：

| 變數 | 用途 |
| --- | --- |
| `SITE_ROOT` | 要測試的網站根目錄，預設為 repo 根目錄。可指向舊版程式碼的副本做回歸比對。 |
| `HEADED=1` | 顯示瀏覽器視窗。 |
| `FRAME_MS` | 測試時的畫格間隔（毫秒），預設 100。遊戲以時間差計算，放寬畫格能縮短測試時間。 |

## 測試內容

### `unit/dat-double-questions.test.js`

直接 import `DAT_double/js/questions.js`：

- 練習模式 2 題固定為顏色、數學各 1 題。
- 正式模式每題隨機出題，遊戲實際的呼叫方式 `generateQuestionSet(1, false)` 兩種題型都會出現（修正 `795a7ad` 以來只出顏色題的問題）。
- 顏色題、數學題的 `answer` 與題目內容一致。

### `e2e/dat-double.test.js`、`e2e/dat-single.test.js`

用 Playwright 開啟真正的遊戲頁面，逐題控制「答對 / 答錯 / 沒瞄準」，並檢查回饋文字、動物圖片與紅光：

- 連續 5 題升級；答錯、漏答、沒瞄準只歸零連擊，**動物不降級**。
- 回饋提示「（再連續答對 N 題變身）」與「（連擊歸零）」；沒有連擊時失敗不顯示「連擊歸零」。
- 達最高級後不再提示「再 N 題」，每 5 題顯示「維持最高級動物狀態」。
- 跨關卡時保留動物等級；雙人版兩位玩家互不影響。
- 單人版正確等待與漏答後，下一題以「上一題：」保留判定訊息，並確認計分與連擊只更新一次。
- 雙人版的判定訊息會真的顯示在畫面上（作答中直接顯示，逾時後以「上一題：」顯示）。
- 每題剛好設定一次紅光或綠光。
- 雙人版正式模式會出現數學題；單人與雙人練習模式都是顏色、數學各 1 題（單人另以固定亂數確認不受亂數影響）。
- 頁面沒有 JavaScript 錯誤。

測試環境的做法：

- 內建靜態伺服器，不需要另外開 `python3 -m http.server`。
- 使用 Playwright 假時鐘快轉時間，每題 10 秒的流程不必真的等待。
- 攔截所有對外請求：素材 API 回傳測試指定的清單，成績 API 只記錄、不會送出，報表 API 預設沒有紀錄（照舊從第 1 關開始），Google Fonts 回傳空內容。
- 準心判定改為永遠對準動物（「沒瞄準」情境則改為永遠沒對準），讓結果只取決於作答。


### 完整流程與穩定性

- `unit/dat-assets.test.js`：素材 URL 篩選、API/body/圖片逾時回退及取消舊圖片請求；跨來源圖片先設 `crossOrigin` 再設 `src`、畫面元素用同樣的 CORS 模式、CORS 失敗改用一般載入。
- `unit/dat-save.test.js`：同關卡去重、成功才標記、人工重試保留原始成績；成績帶 UUID v4 的 `data.submissionId`，重送沿用同一個 body，不同紀錄、新的一局是新的 id；有 submissionId 時未知結果可由重試或再存一次（離開）重送，沒有時維持不重送；剛等到逾時結果的排隊存檔不立刻重送；中場紀錄未知時六關成績仍送出、可重試；較高關卡已送過時不再送較低的檢查點（已儲存視為完成，未知或失敗改重送較高那筆）；逾時用 `WebGameRuntime.nativeSetTimeout`。
- `e2e/dat-lifecycle.test.js`：單／雙人練習轉正式、完整六關及第二局、雙人共同編號更新、已存成績離開不重送、HTTP 500 人工重試、網路中斷與逾時（不自動重送；可按重試或打完後按離開，用同一個 submissionId 重送後回選遊戲頁）；每筆成績帶 UUID v4 的 submissionId，第二局換新的。
- `e2e/dat-checkpoint.test.js`：第三關回大廳存檔失敗時保留中場；重試成功後離開不重送已存成績。
- `e2e/dat-assets.test.js`：素材 API 懸置／錯誤／壞 JSON、首張及變身圖片 404、圖片懸置、重玩取消舊動畫。確認備援圖片可見且有實際尺寸。
- `e2e/dat-double-image-retention.test.js`：兔子升級為貓後，下一張圖片404／逾時與之後誤按紅光都保留貓；使用實際貓圖片並確認可見及自然尺寸。
- `e2e/dat-single-image-retention.test.js`：單人版同上情境，升級圖片失敗保留貓。
- `e2e/dat-stats.test.js`：平均反應時間只算有按鍵的題目；第 4 關離開時第 3 關檢查點只含前三關 18 題、時長停在第 3 關結束。
- `e2e/dat-second-half.test.js`：用 `routeOverride` 模擬報表。這個課次只完成前半時從第 4 關開始、進度 50%、不出現中場，打完每人只送一筆 stage 6（`levelAccuracy` 3 個值、18 題、新的 submissionId，雙人共用新的 pairId）；第 4、5 關離開什麼都不送；stage 6 送失敗後離開照舊重送；「再玩一次」從第 1 關、不再查報表；已有 stage 6、沒有紀錄、雙人只有一人完成前半都從第 1 關；練習不查報表，雙人練習完按「進入正式遊戲」才查。
- `e2e/dat-double-save-retry.test.js`：雙人六關成績第一次 500、重試成功後，「離開」與「返回遊戲大廳」都能回選遊戲頁。
- `e2e/dat-leave-confirm.test.js`：按「離開」先出現頁面內確認框；按「繼續遊戲」或 Esc 不送成績、遊戲繼續、焦點離開「離開」鈕；確定後才送第 3 關檢查點並回選遊戲頁。
- 所有 E2E 都記錄瀏覽器原生對話框（`session.dialogs`）並一律取消；離開、回大廳的測試要求沒有任何原生的離開詢問。
- `e2e/dat-hit-mask.test.js`：命中遮罩跟著目前的動物圖（鳥圖透明處不算命中），本機兔子維持原遮罩；跨來源有 `Access-Control-Allow-Origin: *` 的上傳圖照遮罩判定；沒有 CORS 的跨來源圖（另一個埠號的本機伺服器，因為 `route.fulfill` 會自動補 CORS 標頭）仍顯示原圖、只算中央圓。
- `e2e/dat-leave-save.test.js`：確定離開後遊戲維持暫停：存檔慢（1.5 秒）時不往下打、不多送，存好才導頁；存檔沒回應時暫停中仍會在 10 秒逾時、顯示未確認並恢復遊戲；逾時後再按離開用同一個 submissionId 重送、重送 500 留在頁面、再按一次成功才導頁；存檔期間按作答鍵、點作答鈕、方向鍵都不改變分數與準心；存檔失敗留在頁面並恢復遊戲。
- `e2e/dat-controls.test.js`：**不修改命中幾何**，驗證實際鍵盤瞄準、滑鼠方向鈕按住／放開、失焦清鍵與同題連按只判定一次；另有單人真實時鐘與 requestAnimationFrame 測試。

完整流程為可重現性使用假時鐘與固定命中；實際鍵鼠測試保留真實命中幾何。所有外部請求被攔截，不會把測試成績寫到正式庫。這些測試不代表已完成正式 API 或實體手柄驗收。

後端無資料庫契約驗證：

```bash
cd backend
env -u TEST_DB_NAME uv run pytest tests/test_dat_webgame_contract.py -q
```

兩個案例透過 FastAPI TestClient 執行真實路由，把資料寫入函式替換為記錄器，驗證六關 `DAT_*` 統計及雙人 pairId。瓢蟲追擊令的 `lessonId` 是 `1140908_DAT`。

`DAT_double/local_sqlite_server.py`（本機 SQLite 成績後端）的測試：

```bash
uv run --with fastapi --with httpx --with pytest pytest tests/unit/test_dat_local_sqlite_server.py
```

涵蓋 `levelAccuracy` 字串、同源 `/app/` 前端、轉送登入，以及 `submissionId` 冪等（同一位學生重送回同一個 sessionId、不同學生各一列、格式錯誤 422）。

評估依據及未驗證範圍見 [EVALUATION.md](EVALUATION.md)。
