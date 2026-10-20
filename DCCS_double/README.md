# 賽道攔截・雙人

同一台裝置上的兩個玩家各玩一場賽道攔截。選單名稱是「賽道攔截」，成績代號是 `DCCS`。

玩法與單人相同：目標物沿賽道由遠而近，形狀閥往左、物件閥往右，兩道都對才算答對。關卡表在這個資料夾的 `levels.json`，目前也是 6 關。機制細節見 [`../DCCS_single/SPEC.md`](../DCCS_single/SPEC.md)。

## 和單人的差別

這個資料夾有自己的 `index.html`、`js/`、`css/`、`levels.json`、`manifest.json` 與 `assets/`。改雙人關卡或圖時改這裡，不要只改 `DCCS_single/`。

`tools/build_manifest.py` 會同時依這個資料夾的 `levels.json` 與 `assets/` 產生雙人的 `manifest.json`。

操作：

| 玩家 | 形狀閥（左） | 物件閥（右） |
| --- | --- | --- |
| 玩家 1 | `A` | `D` |
| 玩家 2 | `←` | `→` |

遊戲開始後，左右兩側面板左上方各標示該側玩家的個案編號。

兩人各送一筆成績，`mode` 為 `double`，並帶同一組搭檔 token。按「離開」會先在頁面內詢問「確定要離開嗎？」，詢問時遊戲暫停。按「繼續遊戲」或 Esc 什麼都不送，遊戲照常繼續，打完全場只送全場成績。按「離開」後，兩人都打完第 3 關的話各送一筆第 3 關（或第 6 關）成績再回選擇遊戲頁，不會再跳瀏覽器的離開詢問；同一個關卡檢查點每人只送一次，連點也不會重送。確定離開後遊戲維持暫停到導頁，存檔期間兩側賽道都不前進，按轉動鍵也不記。本局的 `pairId` 由 `WebGameApi.uuid()` 產生。全場成績送出中「離開」會停用。兩人都進中場休息時就先各送一筆第 3 關成績（之後直接關掉頁面前三關也保得住）；中場的「返回遊戲大廳」是明確的選擇，不再詢問，也不重送。同一局每人的第 3 關與全場成績共用一個 `submissionId`，後端以較高關卡更新同一列。暫存鍵名同樣是 `dccs_pending_`，規則與單人相同，見 [`../DCCS_single/README.md`](../DCCS_single/README.md)。

`DCCS_duration` 的定義與單人相同（2026-10-20 起）：每位玩家各自用 `WebGameRuntime` 的遊戲時鐘，從第一個關卡提示按下繼續起（一般是第 1 關，後半那一局是第 4 關），算到最後完成那一關結束，包含關卡提示與中場休息，只扣暫停；`startTime`／`endTime` 是同一段時間換回的真實時間，沒中斷時 `endTime − startTime ≈ duration`。中場先送的第 3 關算到第 3 關結束當下。在這之前是賽道的模擬時間 `min(track.elapsed, sessionSeconds)`，完整一場固定 360000；**改版前後的 `duration` 不能直接比較**，以 `start_time` 是否在 2026-10-20 之後分界。

## 同一個課次已完成前半

進遊戲時 `js/double.js` 的 `bootFromLobby` 先用 `WebGameSecondHalf.startStage('DCCS', { mode: 'double', slots: [1, 2] })` 讀兩位學生各自的報表（第 2 位用 `student2_token`）。**兩位**在各自的課次、雙人模式的 DCCS 紀錄都有 stage 3、而且沒有 stage 4 以上，才從第 4 關開始；只有一位符合、讀取失敗、逾時（最多等 5 秒）都從第 1 關開始。查詢和載入關卡資料、圖片同時進行，報表還沒回來時顯示共用的載入畫面，到關卡提示前才等結果。不檢查前半是和誰一起玩的；單人模式玩的前半不算。

從第 4 關開始的那一局規則與單人相同（見 [`../DCCS_single/README.md`](../DCCS_single/README.md) 的「同一個課次已完成前半」）：共用的關卡提示顯示第 4 關、沒有中場休息、統計只算第 4～6 關；兩人各用新的 `submissionId`，本局另產生新的 `pairId`。在第 4、5 關按「離開」並確定，兩人都不送任何成績，直接回選擇遊戲頁。打完第 6 關兩人各送一筆 stage 6，`levelAccuracy` 剛好 3 個值（第 4、5、6 關）。

## 怎麼開始

從 `Tutorial/DCCS_double_tutorial.html` 進入 `index.html`。頁面要求雙人登入。缺任一位學生資料時不會開局。
