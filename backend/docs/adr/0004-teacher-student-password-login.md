# 老師／學生改為帳密登入，取代選單式免密碼登入

日期：2026-09-11 · 狀態：accepted

## 脈絡

[spec B](../superpowers/specs/2026-09-08-teacher-directory-login-design.md)（2026-09-08）
的定案是「選單式登入：下拉選場域→選人，無密碼、無 token，所有 API 公開」。
`routers/directory.py` 當時的檔案說明直接寫著：「這支 router 不驗證任何身分…廠商
定調下拉選人、無密碼」。

2026-09-11，廠商改口：老師與學生都要帳號＋密碼登入，且**老師只能查看自己管轄
場域的學生資料**，看不到其他場域。這推翻了 spec B 的核心假設——原本的信任模型是
「前端說自己是誰，後端就信」（`/api/teachers/{teacherId}/students` 直接信任 URL
裡的 `teacherId`；`/api/students/{studentKey}/report?school=` 對任何呼叫者開放）。

密碼由誰發、怎麼發也一併定案：**後端/管理者預先指派密碼**（不是老師/學生自助
註冊）。前端組員給的 login 頁 mockup（`圖2`～`圖4`）確認登入表單**只有「帳號＋
密碼」兩欄，沒有選場域這一步**——一開始考慮過拿老師姓名／`studentKey`
（`grade_caseId`）直接當帳號，但兩者都只在 `school` 內唯一（同名老師、同一個
`G1_S01` 在不同場域都會重複），撐不住「不選場域、單靠帳號查到唯一一個人」這個
mockup 隱含的需求，所以改成另外發一組**全域唯一**的帳號。

## 決策

1. **`teacher` / `student` 各加 `password_hash` 欄位**，密碼用 stdlib
   `hashlib.pbkdf2_hmac`（`auth.py`）雜湊，不存明碼、不用外部套件。
2. **`teacher` / `student` 各加 `account` 欄位（全域唯一，`UNIQUE` 索引）**，
   跟原本的姓名／`studentKey` 脫鉤：
   - `teacher.account` 格式 `T0001`，由 `teacher_id` 推導。
   - `student` 另外加一個代理鍵 `student_id`（`AUTO_INCREMENT`、`UNIQUE`，
     不動原本 `(grade, case_id, school)` 複合主鍵，其他表的外鍵不受影響），
     `student.account` 格式 `S0001`，由 `student_id` 推導。
   - 兩者都是 `DEFAULT NULL`（不是空字串）——同一時間多筆都還沒指派帳號時，
     `UNIQUE` 索引才不會因為「多個空字串重複」而炸掉（MySQL 對 `NULL` 不視為
     重複，對空字串會）。
3. **登入 request body 只有 `{account, password}`**，不帶 `school`、不帶姓名／
   `studentKey`。老師姓名、學生 `studentKey`/`school` 是登入**成功後**回應裡的
   資訊，不是登入輸入。
4. **登入發不透明 token**，存進新表 `login_session`（刻意不叫 `session`——這個
   系統的 `session` 已經是「遊戲場次」的代稱），8 小時過期。前端後續呼叫帶
   `Authorization: Bearer <token>`。
5. **每一支會回傳學生資料的端點都要驗 token**，且**後端強制場域隔離**，不是只在
   前端 UI 上藏起別的場域——老師 token 查別場域一律 403，學生 token 只能查自己。
   這是決策裡最貴的部分，但使用者明確要求要做到這個強度：「不是只在登入門口
   擋一次」。
6. **`GET /api/schools`、`GET /api/schools/{school}/teachers` 維持公開**，但**不
   再是登入流程的一部分**——前端登入頁不用呼叫這兩支。它們留著給之後別的用途
   （例如管理後台要顯示場域清單）。
7. **新增 `GET /api/me/students`**，身份完全來自 token，取代前端自己組
   `teacherId` 呼叫 `/api/teachers/{teacherId}/students`（舊端點保留相容，但加上
   「token 的 teacherId 必須等於路徑參數」的檢查）。
8. **`POST /api/sessions`（Unity 用）不動**：這是遊戲用機對機介面，不是人的登入，
   也不是廠商這次改口的對象。

## 考慮過的替代方案

- **只在登入門口驗一次密碼，後面維持無 token（前端自己記身份）**：實作量小很多，
  但無法真正擋住「老師手動改 API 請求查別場域」——只是 UI 上看不到，不是後端
  真的擋。使用者明確要求要擋到 API 層級，故不採用。
- **沿用姓名／`studentKey` 當帳號，登入加一個選場域步驟**：跟現有資料模型最
  貼合、改動最小，但跟前端已經畫好的 mockup（只有帳號＋密碼兩欄）不符，故
  改為發全域唯一帳號，登入頁維持兩欄。
- **`student.student_id` 用 `UUID` 而非 `AUTO_INCREMENT` 整數**：帳號會變長、
  不好手動抄給小朋友，且這個代理鍵只在後端內部用來推導 `account`，不會對外
  暴露，不需要 UUID 的不可預測性，故用簡單的整數。

## 效果

- 前端登入頁只有帳號＋密碼兩欄（老師、學生皆同），雙人模式兩組。
- `dms.html` 拿掉「選場域→選老師」與「學生自查模式」——登入時已經決定身份。
- `/demo`（`main.py` 的驗收頁）失去對開放端點的存取，會壞掉；這次不修，見
  `docs/frontend-integration-guide.md` 的說明。
- 正式庫要手動補 `password_hash`／`account`／`student_id` 欄位、`login_session`
  表，並用 `seed_directory.py`／`manage_passwords.py` 指派帳密，才能讓帳密登入
  真的可用。
- 老師姓名、學生 `studentKey` 現在只是**顯示用**資訊，不再是任何 API 的查詢鍵，
  帳號才是；管理者要查「某場域某位老師的帳號是什麼」得查 DB 或
  `seed_directory.py`／`manage_passwords.py` 的輸出，目前沒有 API 或畫面會列出
  帳號本身（帳號不出現在任何 GET 回應裡，避免順手洩漏登入憑證的一半）。

## 遷移步驟（正式庫）

1. 對 `AttentionLessonPlan` 執行：
   ```sql
   ALTER TABLE teacher ADD COLUMN password_hash varchar(255) NOT NULL DEFAULT '';
   ALTER TABLE teacher ADD COLUMN account varchar(20) DEFAULT NULL,
     ADD CONSTRAINT uq_teacher_account UNIQUE (account);
   ALTER TABLE student ADD COLUMN password_hash varchar(255) NOT NULL DEFAULT '';
   ALTER TABLE student ADD COLUMN student_id int NOT NULL AUTO_INCREMENT,
     ADD CONSTRAINT uq_student_id UNIQUE (student_id);
   ALTER TABLE student ADD COLUMN account varchar(20) DEFAULT NULL,
     ADD CONSTRAINT uq_student_account UNIQUE (account);
   -- login_session 的 CREATE TABLE 見 tests/schema.sql
   ```
2. `DB_USER=root … uv run python seed_directory.py --prod`（幫還沒有帳號的老師
   指派 `account` + 密碼，印出明碼一次，自行轉交給對應老師）。
3. 學生帳密視廠商決定的發放流程，逐位用 `manage_passwords.py --prod` 設定
   （沒有 account 的學生會順便補一個）。
4. `uv run pytest` 全綠。
