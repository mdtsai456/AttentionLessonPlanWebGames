# 自動化測試

目前涵蓋「動物追擊令」（`DAT_double/`、`DAT_single/`）的彩蛋規則與出題邏輯。

## 執行

```bash
cd tests
npm install        # 只安裝 playwright-core，不會下載瀏覽器
npm test           # 單元測試 + E2E，約 30 秒（機器忙碌時會更久）
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
- 雙人版正式模式會出現數學題；練習模式為顏色、數學各 1 題。
- 頁面沒有 JavaScript 錯誤。

測試環境的做法：

- 內建靜態伺服器，不需要另外開 `python3 -m http.server`。
- 使用 Playwright 假時鐘快轉時間，每題 10 秒的流程不必真的等待。
- 攔截所有對外請求：素材 API 回傳測試指定的清單，成績 API 只記錄、不會送出，Google Fonts 回傳空內容。
- 準心判定改為永遠對準動物（「沒瞄準」情境則改為永遠沒對準），讓結果只取決於作答。
