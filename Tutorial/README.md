# Tutorial

各遊戲開始前的說明頁。`Select/` 選完遊戲後先到這裡，玩家按開始才進入遊戲本體。

說明頁會先經過 `shared/require-student.js`。單人頁要求單人登入，雙人頁要求雙人登入。

## 頁面

| 檔案 | 遊戲 | 接著前往 |
| --- | --- | --- |
| `DCCS_tutorial.html` | 賽道攔截・單人 | `DCCS_single/index.html` |
| `DCCS_double_tutorial.html` | 賽道攔截・雙人 | `DCCS_double/index.html` |
| `DAT_tutorial.html` | 瓢蟲追擊令・單人 | `DAT_single/DAT_single.html` |
| `DAT_double_tutorial.html` | 瓢蟲追擊令・雙人 | `DAT_double/DAT_double.html` |
| `EFT_tutorial.html` | 漂浮泡泡・單人 | `EFT_single/EFT_single.html` |
| `EFT_double_tutorial.html` | 漂浮泡泡・雙人 | `EFT_double/EFT_double.html` |
| `TGame_tutorial.html` | 勇闖迷宮・單人 | `TGame_single/index.html` |
| `TGame_double_tutorial.html` | 勇闖迷宮・雙人 | `TGame_double/index.html` |
| `InstructionGame_tutorial.html` | 指令出擊 | `IM_single/index.html` |

瓢蟲追擊令的兩個說明頁可以選「進入練習模式」（`?mode=practice`）或「不練習，直接挑戰」（`?mode=game`）。其餘遊戲從說明頁直接開始。

`tutorial.css` 是這些說明頁共用的版面。遊戲規則的完整行為寫在各遊戲資料夾的 README，這一頁只放給玩家看的操作與規則摘要。
