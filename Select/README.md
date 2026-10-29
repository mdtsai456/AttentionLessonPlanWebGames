# Select

學生選遊戲的頁面。登入成功後從 `Home/` 進來。

## 做什麼

單人顯示五個遊戲。雙人左右各一份選單，沒有「指令出擊」；兩人都按確認，而且選的是同一個遊戲，才進入說明頁。

雙人按確認後，該側蓋上等待遮罩，顯示「已選：遊戲名（點此取消）」，點一下取消。選不一樣會清掉兩邊的確認，並列出兩人各選了什麼。兩人選同一個時，遮罩改成「準備進入遊戲…」且不能取消，直到說明頁開啟；從說明頁按上一頁回來時遮罩收起，重新選。

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

進度來自 `shared/api.js` 的 `dayProgress`（與 `Teacher_platform/` 共用）：成績裡的關卡 `stage` 在 3 以內是 50%，超過是 100%。沒有 `stage` 的紀錄當成 100%。畫面只顯示 0、50、100 三格。查不到或連不上時，該生進度顯示 0，不阻擋選遊戲。

50% 代表這個課次已完成前半；在同一個模式再進遊戲會從第 4 關開始（`shared/second-half.js`），打完第 6 關變 100%。這裡的進度不分單人、雙人，所以雙人玩過前半時，單人這頁也顯示 50%，但單人進遊戲仍從第 1 關開始。

後端若把指令出擊記成 `IM`，`mapGameId` 會對回 `InstructionGame`。

## 專心煙火

進頁時向 `GET /api/attention/me` 查手錶專心判定。結果是 1 就放一次煙火（`shared/fireworks.js`）。同一次登入只放一次。雙人任一位達標就放，文案用「你們」，不寫是哪一位。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 選遊戲畫面 |
| `app.js` | 進度、選遊戲、雙人對選、煙火 |
| `style.css` | 版面 |
| `img/` | 圖 |

標題下顯示登入帳號與第幾天（`student{n}_account`、`student{n}_day`）。舊的登入沒有存帳號時，改顯示個案編號。

按登出會先跳確認框（`shared/leave-confirm.js`），雙人會提醒兩位學生都會一起登出。按「登出」才登出 token 並回到 `Home/`。
