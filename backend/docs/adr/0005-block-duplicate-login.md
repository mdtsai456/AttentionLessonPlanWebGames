# 擋掉同帳號重複登入

日期：2026-10-20 · 狀態：accepted

## 脈絡

QA 回報：雙人模式沒有「同帳號防重複登入」保護，可以同時在兩個地方登入同一位
學生的帳號，無任何「已在別處登入」提示，兩邊可能各自寫回成績、造成資料覆蓋。

`login_session`（見 [ADR 0004](0004-teacher-student-password-login.md)）的
`PRIMARY KEY` 只有 `token`，`teacher_id`／`(grade, case_id, school)` 沒有唯一
限制，`insert_login_session` 永遠直接 `INSERT`，從未檢查同一身分是否已有有效
登入。

## 決策

1. **登入前先查有效登入紀錄，擋掉新登入**：`queries.fetch_login_sessions_for_teacher`
   / `fetch_login_sessions_for_student` 查出該身分**所有**的 `login_session` 紀錄
   （可能包含已過期但還沒被登出清掉的），`auth._has_active_session` 在 **Python**
   裡依 `expires_at` 逐筆判斷是否有未過期的，有的話回 `409`、訊息「此帳號已在
   別處登入中，請先登出」，不產生新 token、不影響原本的登入。不選擇「擠掉舊
   登入」，避免原本正在作答的那邊被無預警中斷。
   - **過期判斷刻意不寫在 SQL（不用 `WHERE expires_at > NOW()`）**：`expires_at`
     是用 Python 的 `datetime.now(timezone.utc)` 寫入，但 MariaDB 的 `NOW()`
     依連線的時區設定，不保證等於 UTC，比較結果可能因伺服器時區設定整批偏移。
     改成撈出全部紀錄、在 Python 用 `datetime.now(timezone.utc)` 比較，和
     `routers/identity.py` 的 `get_current_identity` 同一套慣例，也不受資料庫
     時區影響。
   - **撈全部紀錄、不加 `LIMIT 1`**：`login_session` 沒有清掉過期紀錄的排程，
     同一身分可能同時存在「已過期但還沒被登出刪除」與「真的還有效」的紀錄。
     `LIMIT 1` 不保證拿到仍有效的那筆，必須每筆都檢查過。
2. **不改資料表結構**：現有欄位（`teacher_id` 或 `grade/case_id/school` 搭配
   `expires_at`）已足夠查詢，不需要新增唯一索引或遷移既有資料。
3. **前端需要配合調整登入順序**：`Home/app.js` 原本是「新登入成功後，才登出這
   台瀏覽器自己的舊 token」。若不調整，使用者在**同一台瀏覽器**重新登入（例如
   重新整理頁面後再登入一次）會被自己原本的 session 擋下來。改成在嘗試新登入
   **之前**就先登出這台瀏覽器已存的舊 token，409 只會擋到「別的瀏覽器／裝置」
   的重複登入。
   - 取捨：若新登入的帳密輸入錯誤，這台瀏覽器原本的舊登入仍會被先登出（因為
     登出動作在嘗試登入之前，不知道新登入會不會成功）。影響範圍限於同一台瀏
     覽器、且使用者仍記得自己原本帳密，可重新登入，判斷為可接受的代價。
4. **這個機制與「同帳號雙分頁玩同一款遊戲」是兩個獨立問題**：擋的是「兩次登
   入」產生兩個 token；但同一瀏覽器把分頁複製出一份時，兩個分頁可能共用**同
   一個** token，不會被這裡擋到，需要另一套鎖定機制（見問題 #6 的 PR）。
