# Home

登入頁。根目錄 `index.html` 與後端 `/app/` 都會進到 `Home/index.html`。

## 做什麼

1. 選身份：學生或老師。
2. 學生再選單人或雙人。雙人在同一頁填兩組帳密。
3. 學生要填第幾天（1～24）。年級與場域用後端登入結果，畫面上不填。
4. 呼叫 `shared/api.js` 的登入。成功後學生去 `Select/`，老師去 `Teacher_platform/`。

帳號或密碼錯誤留在這一頁。後端連不上時，本機提示先啟動 `http://127.0.0.1:5001`。登到一半失敗會把已經拿到的 token 登出，避免留在伺服器上。

從別的頁被送回來時，網址可以帶 `?auth=retry`（驗證連不上）或 `?auth=expired`（登入失效）。

## 寫進 sessionStorage 的內容

登入成功會先清掉舊的 session，再寫入：

| 誰 | 主要欄位 |
| --- | --- |
| 老師 | `user_role=teacher`、`token`、`teacher_id`、`teacher_name`、`teacher_school` |
| 學生 | `user_role=student`、`game_mode`（`single` 或 `double`）、`token` |
| 每位學生 | `student1_*`、`student2_*`：token、studentKey、case、grade、school、day |

學生 1 另外寫一份不帶編號的 `grade`、`caseId`、`school`、`current_day`、`currentDay`，給舊的讀法使用。登入到期時間由 `shared/session-timeout.js` 記錄。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 登入畫面 |
| `app.js` | 選身份、送登入、寫 session、換頁 |
| `style.css` | 版面 |
| `fonts/`、`img/` | 字型與圖 |

這一頁自己沒有再做一次登入守門。後面的功能頁由 `shared/require-student.js` 檢查這裡寫下的 token。
