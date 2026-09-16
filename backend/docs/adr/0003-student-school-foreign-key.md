# `student.school` 收緊為指向 `school` 的外鍵

日期：2026-09-09 · 狀態：accepted

## 脈絡

選單式登入（[spec](../superpowers/specs/2026-09-08-teacher-directory-login-design.md)）當初
**刻意不在 `student.school` 上加外鍵**，把 `school` 表當「軟性名單」，並把收緊成硬約束
列為「日後的獨立決定」。當時的兩個顧慮：

1. 正式庫有 `school = "測試場域"` 的舊資料，硬加外鍵會失敗。
2. `POST /api/sessions` 走 `INSERT IGNORE INTO student`；場域沒登記會讓整場遊戲結果丟失。

到 2026-09-09，情況變了：

- 場域字串**定案**為 `KMU` / `NTHU-01`…`NTHU-07`（[docs/school-directory.md](../school-directory.md)），
  三方共用的唯一真實來源。
- 正式庫 `AttentionLessonPlan` 重建過，`student` 目前 **0 筆**，沒有舊的 `"測試場域"` 資料。
- 測試庫 `_test` 的 18 筆學生，`school` 值全部落在已登記的 8 個場域內（查證無孤兒）。
- 需求方確認階層是「大到小 school → teacher → student」，且 Unity 只會送這 8 個字串。

沒有外鍵的實際壞處：`school`–`student` 在 ER 圖上沒有連線（看起來「沒關聯」）；
`student.school` 打錯一個字不會報錯，那位學生會從所有老師的清單裡靜默消失。

## 決策

加上外鍵：

```sql
ALTER TABLE student
  ADD CONSTRAINT fk_student_school FOREIGN KEY (school)
  REFERENCES school (school) ON UPDATE CASCADE;
```

- `ON UPDATE CASCADE`：日後修正某場域字串的拼法，學生（及其經 `fk_assessment_student`
  連動的場次）自動跟著改。
- 不設 `ON DELETE`（預設 `RESTRICT`）：還有學生掛著的場域不能被刪。
- 建表順序：`school` 必須在 `student` 之前（`tests/schema.sql` 已重排）。

配套：

- `POST /api/sessions` 收到未登記的 `school` → 回 **400「未知的場域（school 尚未登記）」**
  （`routers/sessions.py` 攔 MySQL errno 1452；原本落到 500）。這是刻意的：場域是廠商
  維護的參照資料，Unity 不該送表外的值，早失敗好過靜默錯置。
- `seed.py` 灌假學生前，先冪等把它用到的場域補進 `school`（不清空 `school`）。
- 測試輔助 `DbHelper.insert_student` 會先 `ensure_school`；直接呼叫寫入路徑的測試
  （`test_writes.py` / `test_sessions.py`）用 autouse fixture 先登記 `測試場域`。

## 效果

- `school → teacher → student` 三層在資料庫層級都有外鍵，ER 圖畫得出完整階層。
- `student.school` 打錯字當場被擋。
- 順帶：外鍵替 `student.school` 建了索引，`fetch_students(school)` 不再全表掃描。
- 代價：Unity 端若送出未登記的場域字串，該場結果會被拒（回 400）。上線前務必先
  `seed_directory.py --prod` 把 8 場域灌好，並跟 Unity 對齊場域字串清單。

## 遷移步驟（正式庫）

1. `DB_USER=root … python seed_directory.py --prod`（確認 8 場域都在）。
2. 對 `AttentionLessonPlan` 執行上面的 `ALTER TABLE`（`student` 為空，秒完成）。
3. `_test` 庫 DROP + 依新 `tests/schema.sql` 重建，或同樣跑一次 `ALTER`。
4. `uv run pytest` 全綠。
