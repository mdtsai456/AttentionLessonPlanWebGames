# shared

各頁面共用的腳本與樣式。遊戲頁用相對路徑引用這裡，不要把同一份邏輯再複製進遊戲資料夾。

功能頁在 `<head>` 先載入 `require-student.js`。驗證通過後，它才依序執行標成 `type="application/x-webgame-script"` 的腳本。驗證完成前頁面不可見、不可操作。

## 檔案

| 檔案 | 誰在用 | 做什麼 |
| --- | --- | --- |
| `require-student.js` | 功能頁 | 用 `GET /api/auth/me` 檢查角色、模式與學生欄位。不符回 `Select/` 或 `Home/`。雙人要兩個學生 token。返回 bfcache 時重新驗證，等待期間凍結輸入與計時。 |
| `api.js` | 登入、選關、成績 | 決定 API 位址（覆寫網址去掉結尾斜線）、登入、登出、查報告、送成績、把場次換成 0／50／100 進度。`uuid()` 產生成績的 `submissionId` 與雙人局的 `pairId`。 |
| `session-timeout.js` | 已登入頁面 | 依登入回傳的剩餘秒數 `expiresIn` 加上本機收到回應的時間計算到期（不受裝置時鐘快慢影響；舊後端沒有 `expiresIn` 時改用 `expiresAt`），到期後清掉本機登入並回 `Home/`。計時器分段等待，超過 24.8 天也不會溢位。 |
| `game-runtime.js` | 遊戲頁 | 驗證或離開期間暫停 `setTimeout` 與動畫幀，回來後扣掉這段時間。`pause(reason)`／`resume(reason)` 依原因計數，全部解除才恢復；`nativeSetTimeout` 給網路請求的逾時用，暫停時照常運作。 |
| `leave-confirm.js` | 遊戲頁 | 遊戲內的離開確認。「離開」按鈕先呼叫 `confirmLeave()` 顯示頁面內的確認框（開著時暫停遊戲、攔下按鍵、Esc 等於取消），按「離開」才存檔，再用 `leaveTo(url)` 導頁；按「繼續遊戲」什麼都不送，避免取消後檢查點和打完的成績各留一筆。直接關閉分頁或重新整理不經過這裡（DAT、DCCS 另有自己的提示）。 |
| `stage-clear.js`、`stage-clear.css` | 過關畫面 | 共用的關卡結束面板。 |
| `fireworks.js`、`fireworks.css` | `Select/` | 手錶判定專心時的煙火。 |
| `dat-assets.js` | 瓢蟲追擊令 | 向素材平台要 `DAT.assets.files`，失敗時用本機動物圖。跨來源圖片用 `crossOrigin="anonymous"` 載入（素材平台有回 CORS 標頭），失敗再不帶 CORS 重試一次。`isOnAnimal` 判斷準心是否在動物上：中央圓一律算，圓外照目前顯示的圖：本機兔子用 `rabbit-hit-mask.js`，其他圖讀圖片透明度；讀不到透明度時只算中央圓。 |
| `dat-save.js` | 瓢蟲追擊令 | 送出一局成績與畫面上的儲存狀態。每筆成績第一次送出時帶 `data.submissionId`（`WebGameApi.uuid()`），重送沿用同一個內容，後端回同一個 `sessionId`、不多寫一列。網路中斷或逾時（結果未確認）不會自己重送，但玩家按重試或離開時會重送同一筆；已送過較高關卡就不再送較低的檢查點（已儲存視為完成，未確認或失敗改重送那一筆）。請求逾時用 `WebGameRuntime.nativeSetTimeout`，確認離開後遊戲暫停時仍會逾時。 |
| `eft-game-logic.js` | 漂浮泡泡 | 出題、方向判定、`EFT_*` 成績欄位。 |
| `eft-player.js` | 漂浮泡泡 | 單一玩家的記憶、作答、計時與計分。單人一個，雙人兩個。每關結束留一份成績快照，送檢查點時只算到那一關。 |
| `eft-assets.js` | 漂浮泡泡 | 向素材平台要 `EFT.assets.files`，並預載箭頭與泡泡。API 或圖片超過 5 秒沒回應就改用本機箭頭，不會卡住開局。 |
| `tgame-support.js`、`tgame-support.css` | 勇闖迷宮 | 物品圖預載，以及視窗太窄時擋住遊玩。暫停畫面的「離開」同樣先跳出離開確認，按「繼續遊戲」後維持暫停、按鈕恢復可按。 |

## API 位址

`api.js` 與 `require-student.js` 用同一套規則：

1. 有 `window.API_BASE_URL` 就用它。
2. 網址在 `/app/` 底下時，用同一個 origin 的 `/api`。
3. 主機是 `localhost` 或 `127.0.0.1` 時，打到該主機的 `5001` port。
4. 其他情況打正式後端 `https://attention-lesson-plan-data.zeabur.app/api`。

## 成績怎麼送

`WebGameApi.submitSession` 把成績 `POST` 到 `/api/sessions`。本人 token 放 `Authorization`。雙人再把另一位的 token 放 `X-Partner-Authorization`，token 不放進成績本文。身份與目前登入不符就不會送。

`progressFromRecord`：六個遊戲都是打完前 3 關（`stage <= 3`）為 50%，其後為 100%。沒有 `stage` 的紀錄當成 100%。`IM` 會對成選單上的 `InstructionGame`。
