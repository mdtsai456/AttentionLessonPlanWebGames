# Select

學生選遊戲的頁面。登入成功後從 `Home/` 進來。

## 做什麼

單人顯示五個遊戲。雙人左右各一份選單，沒有「指令出擊」；兩人都按確認，而且選的是同一個遊戲，才進入說明頁。選不一樣會清掉確認，請兩邊重選。

遊戲與下一個頁面：

| 代號 | 畫面 | 單人說明頁 | 雙人說明頁 |
| --- | --- | --- | --- |
| `DCCS` | 賽道攔截 | `Tutorial/DCCS_tutorial.html` | `Tutorial/DCCS_double_tutorial.html` |
| `DAT` | 瓢蟲追擊令 | `Tutorial/DAT_tutorial.html` | `Tutorial/DAT_double_tutorial.html` |
| `EFT` | 漂浮泡泡 | `Tutorial/EFT_tutorial.html` | `Tutorial/EFT_double_tutorial.html` |
| `TGame` | 勇闖迷宮 | `Tutorial/TGame_tutorial.html` | `Tutorial/TGame_double_tutorial.html` |
| `InstructionGame` | 指令出擊 | `Tutorial/InstructionGame_tutorial.html` | 雙人沒有這個遊戲 |

模式看 `sessionStorage` 的 `game_mode`。`double` 與 `dual` 都當雙人。

## 當天進度

進頁時用該生 token 查 `GET /students/{studentKey}/report`。只算登入時填的那一天。

進度來自 `shared/api.js` 的 `progressFromRecord`：成績裡的關卡 `stage` 在 3 以內是 50%，超過是 100%。沒有 `stage` 的紀錄當成 100%。畫面只顯示 0、50、100 三格。查不到或連不上時，該生進度顯示 0，不阻擋選遊戲。

後端若把指令出擊記成 `IM`，`mapGameId` 會對回 `InstructionGame`。

## 專心煙火

進頁時向 `GET /api/attention/me` 查手錶專心判定。結果是 1 就放一次煙火（`shared/fireworks.js`）。同一次登入只放一次。雙人任一位達標就放，文案用「你們」，不寫是哪一位。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 選遊戲畫面 |
| `app.js` | 進度、選遊戲、雙人對選、煙火 |
| `style.css` | 版面 |
| `fonts/`、`img/` | 字型與圖 |

離開這個頁面用登出按鈕時，會登出 token 並回到 `Home/`。
