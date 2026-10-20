# DCCS 瀏覽器回歸測試

測試根目錄的 `DCCS_single/`，與 `zbpack.json` 的靜態部署路徑一致。需要 Node.js 18 以上及 Python 3。

```bash
cd DCCS_single/tests
npm ci
npx playwright install chromium
npm test
```

測試會自動啟動本機靜態伺服器，使用假的登入資料、攔截登入驗證（`/api/auth/me`）與成績 POST。測試不會寫入正式後端或資料庫。共用的登入設定與關卡推進工具在 `helpers.mjs`。

引擎單元測試（出題、整場關卡推進、按鍵計數）不需要瀏覽器，單人與雙人兩份引擎都會驗：

```bash
npm run test:unit
```

預設透過遊戲既有的 `?sessionSeconds=60` 除錯參數，將每關縮成 10 秒；正式關卡設定與素材維持原樣。

以正式長度（每關 60 秒）驗證雙人繼續操作及單／雙人整場流程：

```bash
npm run test:full -- --grep '共用遮罩關閉|打完全場'
```

若要讓所有流程都跑正式長度，使用 `npm run test:full`。

## 驗證內容

- 六關都能出題，`manifest.json` 與 `levels.json` 一致，整場打到第 6 關。
- 目標通過閥門那一幀才按的鍵不影響答案，也不計入 `slotsRotated`。
- 單／雙人第 3 關中場休息的滑鼠與空白鍵操作。
- 中場休息期間計時暫停，繼續後遮罩消失、離頁保護恢復。
- 單人 A/D 與方向鍵可作答；雙人各自操作，按鍵與反應時間確實記入第 4 關。
- 整場結束與提前返回大廳時的成績筆數、關卡範圍及雙人 pairId。
- 單／雙人「離開」先在頁面內確認：取消不送任何成績、遊戲照常，之後打完全場只送全場成績；確定後送一次檢查點（第 1 關則不送）再回大廳，且不跳瀏覽器的離開詢問。連點、存檔中再按、全場成績送出中再按都不重送。確定後存檔期間賽道不前進、轉動鍵不記也不排隊；後端不回應時仍在 15 秒後逾時、暫存並回大廳。單人整場結束、成績送出中確定離開，會等送完才導頁（不中斷請求）。
- 中場「返回遊戲大廳」不詢問，也不跳瀏覽器的離開詢問。
- 雙人左右面板各自顯示該側玩家的個案編號。
- 延遲送出、返回大廳連點、斷線與後端一直無回應；15 秒逾時後暫存成績。
- 成績本文讀取逾時、暫存重送成功後刪除、暫時性錯誤保留及永久拒絕保留供人工處理；遊戲暫停中送出仍會逾時；`submissionId` 來自 `WebGameApi.uuid()`（`client.spec.mjs` 先載入 `shared/api.js`）。
- 瀏覽器禁止本機儲存時，送出模組仍能回傳失敗結果。
- `DCCS_duration`（2026-10-20 起為遊戲時鐘的實際遊玩時間）：單／雙人沒中斷時 `endTime − startTime` 與 `duration` 相差不到 1 秒，中場檢查點算到第 3 關結束當下（`midway-save.spec.mjs`、`double-leave.spec.mjs`）。
- 當天已完成前半（`second-half.spec.mjs`，模擬學生報表 `/api/students/{key}/report`）：單／雙人一進場就是第 4 關、沒有中場，打完只送 stage 6（新的 `submissionId`、`levelsPlayed` 為 `4,5,6`、`levelAccuracy` 3 個值、題數與 `duration` 只算後半）；第 4、5 關離開什麼都不送；全場成績送出中離開照樣等送完；報表沒有紀錄、已有 stage 6、只有別的模式／課次／遊戲、雙人只有一位符合，都從第 1 關開始。`engine.test.mjs` 另測 Track 的 `startLevelIdx` 與 `levelAccuracy` 從第一個有玩的關卡起算。`helpers.mjs` 沒設 `student{n}_key`，其他測試不讀報表，照舊從第 1 關開始。

操作截圖存於根目錄的 `.context/`；失敗時的 trace 存於 `test-results/`。

## 測試範圍與既有問題

成績 API 使用攔截回應，因此不代表正式環境的登入、資料庫寫入或部署已通過驗證。瀏覽器停用本機儲存時，無法保證失敗成績可保存。

`DCCS_TEST_ROOT` 可指定修正前的程式根目錄，`DCCS_TEST_PORT` 可更換測試埠。用同一組測試驗證修正前版本時，「共用遮罩關閉」案例應失敗。
