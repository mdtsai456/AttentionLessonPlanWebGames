# shared

各頁面共用的腳本與樣式。遊戲頁用相對路徑引用這裡，不要把同一份邏輯再複製進遊戲資料夾。

功能頁在 `<head>` 先載入 `require-student.js`。驗證通過後，它才依序執行標成 `type="application/x-webgame-script"` 的腳本。驗證完成前頁面不可見、不可操作。

## 檔案

| 檔案 | 誰在用 | 做什麼 |
| --- | --- | --- |
| `require-student.js` | 功能頁 | 用 `GET /api/auth/me` 檢查角色、模式與學生欄位。不符回 `Select/` 或 `Home/`。雙人要兩個學生 token。返回 bfcache 時重新驗證，等待期間凍結輸入與計時。 |
| `api.js` | 登入、選關、成績 | 決定 API 位址、登入、登出、查報告、送成績、把場次換成 0／50／100 進度。 |
| `session-timeout.js` | 已登入頁面 | 依登入回傳的到期時間，滿 1 小時清掉本機登入並回 `Home/`。 |
| `game-runtime.js` | 遊戲頁 | 驗證或離開期間暫停 `setTimeout` 與動畫幀，回來後扣掉這段時間。 |
| `leave-confirm.js` | 遊戲頁 | 遊戲中關閉分頁時詢問是否離開。 |
| `stage-clear.js`、`stage-clear.css` | 過關畫面 | 共用的關卡結束面板。 |
| `fireworks.js`、`fireworks.css` | `Select/` | 手錶判定專心時的煙火。 |
| `dat-assets.js` | 瓢蟲追擊令 | 向素材平台要 `DAT.assets.files`，失敗時用本機動物圖。 |
| `dat-save.js` | 瓢蟲追擊令 | 送出一局成績與畫面上的儲存狀態。網路中斷不自動重送。 |
| `eft-game-logic.js` | 漂浮泡泡 | 出題、方向判定、`EFT_*` 成績欄位。 |
| `eft-player.js` | 漂浮泡泡 | 單一玩家的記憶、作答、計時與計分。單人一個，雙人兩個。 |
| `eft-assets.js` | 漂浮泡泡 | 向素材平台要 `EFT.assets.files`，並預載箭頭與泡泡。 |
| `tgame-support.js`、`tgame-support.css` | 勇闖迷宮 | 物品圖預載，以及視窗太窄時擋住遊玩。 |

## API 位址

`api.js` 與 `require-student.js` 用同一套規則：

1. 有 `window.API_BASE_URL` 就用它。
2. 網址在 `/app/` 底下時，用同一個 origin 的 `/api`。
3. 主機是 `localhost` 或 `127.0.0.1` 時，打到該主機的 `5001` port。
4. 其他情況打正式後端 `https://attention-lesson-plan-data.zeabur.app/api`。

## 成績怎麼送

`WebGameApi.submitSession` 把成績 `POST` 到 `/api/sessions`。本人 token 放 `Authorization`。雙人再把另一位的 token 放 `X-Partner-Authorization`，token 不放進成績本文。身份與目前登入不符就不會送。

`progressFromRecord`：六個遊戲都是打完前 3 關（`stage <= 3`）為 50%，其後為 100%。沒有 `stage` 的紀錄當成 100%。`IM` 會對成選單上的 `InstructionGame`。
