# Teacher_platform

老師看學生進度的頁面。`Home/` 以老師身份登入後會進到這裡。

## 做什麼

1. 確認 session 裡是老師 token。不是老師就回 `Home/`。
2. 顯示老師姓名與場域，並拉這位老師名下的學生名單。
3. 選一位學生，再選第 1～24 天。
4. 展開當天五個遊戲的進度與場次明細。

五個遊戲與 `Select/` 相同：賽道攔截、瓢蟲追擊令、漂浮泡泡、勇闖迷宮、指令出擊。進度算法也相同，使用 `shared/api.js` 的 `progressFromRecord`：`stage` 在 3 以內是 50%，其後是 100%。

名單與場次都從後端來。老師只能看自己場域的學生，範圍由後端限制。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 後台畫面 |
| `app.js` | 讀名單、選天、畫進度與明細、登出 |
| `style.css` | 版面 |
| `fonts/`、`img/` | 字型與圖 |

頁首的登入守門是 `shared/require-student.js`，這頁要求 `data-role="teacher"`。登出會清掉 session 並回到 `Home/`。
