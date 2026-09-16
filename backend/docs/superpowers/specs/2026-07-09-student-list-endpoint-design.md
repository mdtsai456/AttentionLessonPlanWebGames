# 學生名單端點設計

日期：2026-07-09

## 問題

目前 API 只能查詢「某一個已知學生」的場次與報告。使用者無法得知**系統裡有哪些學生、總共幾位**，也無法看出誰已註冊但尚未開始遊玩。

## 範圍

新增一個端點，回傳學生名單與總數，並帶上每位學生的遊玩概況。

同時進行兩項與此端點同層的既有程式調整：

1. 將 `main.py` 拆分為模組，讓「碰資料庫的程式」與「不碰資料庫的程式」有明確邊界。
2. 修正三個端點的 DB 錯誤回應，不再將原始例外訊息傳給呼叫端。

不在範圍內：分頁、認證授權、學生姓名、跨學生比較、資料寫入端點。

## 資料模型（既有）

```sql
student(grade, case_id, school)                    -- PK 為此三欄，無其他欄位
assessment_result(grade, case_id, school, uuid,    -- FK → student
                  start_time, game_type, current_day, end_time)
dccs_result / dat_result / eft_result /
im_result / tgame_result                           -- FK → assessment_result
```

三個事實決定了本設計：

- `student` 是真正的名冊表，因此「已註冊但零場次」的學生存在且可查詢。
- 名冊表沒有姓名欄位，名單只能提供 `grade` / `case_id` 代號。
- 學生的唯一鍵是三欄複合鍵。**同一個 `G1_S03` 在不同 `school` 是不同的學生。**
- `assessment_result.end_time` 可為 NULL（場次未完成）。

## API 契約

```
GET /api/students
GET /api/students?school=測試場域
```

`school` 為選填。未提供時回傳所有場域的學生。

### 回應（200）

```json
{
  "school": "測試場域",
  "studentCount": 24,
  "students": [
    {
      "studentKey": "G1_S03",
      "grade": "G1",
      "caseId": "S03",
      "school": "測試場域",
      "sessionCount": 12,
      "lastPlayedAt": "2026-07-08 14:30:00"
    },
    {
      "studentKey": "G1_S04",
      "grade": "G1",
      "caseId": "S04",
      "school": "測試場域",
      "sessionCount": 0,
      "lastPlayedAt": null
    }
  ]
}
```

未提供 `school` 時，頂層 `school` 為 `null`，名單涵蓋所有場域。

### 欄位語意

| 欄位 | 型別 | 說明 |
|---|---|---|
| `school`（頂層） | `string \| null` | 回顯查詢參數；未指定時為 `null` |
| `studentCount` | `int` | 等同 `students` 長度，於 Python 端計算 |
| `studentKey` | `string` | `f"{grade}_{case_id}"` |
| `school`（項目層） | `string` | 學生所屬場域 |
| `sessionCount` | `int` | 場次總數，**含未完成的場次**；零場次為 `0` |
| `lastPlayedAt` | `string \| null` | `MAX(start_time)`；零場次為 `null` |

### 契約決定與理由

**每位學生都帶 `school`，即使頂層已回顯。**
`school` 是主鍵的一部分。未指定 `school` 查詢時，名單可能同時出現兩個 `studentKey` 為 `G1_S03` 的項目，缺少此欄位便無法區分。為使兩種查詢模式的回應結構一致，指定 `school` 時亦一併帶上。

**`lastPlayedAt` 取 `MAX(start_time)`，而非 `end_time`。**
`end_time` 可為 NULL。若取 `MAX(end_time)`，所有未完成的場次會被忽略，導致「昨天玩到一半」的學生顯示為「上週玩過」。`start_time` 回答「最後一次開始遊玩」，此問題永遠有答案。

**`sessionCount` 包含未完成的場次。**
此數字回答「該學生是否有在進行」，而非「完成了幾場」。若日後需要區分，應新增 `completedSessionCount` 欄位，而非變更此欄位語意。

**`lastPlayedAt` 零場次時為 `null`，而非空字串。**
空字串會假裝有值。`null` 讓呼叫端能明確判斷「尚未開始」。

**排序固定為 `ORDER BY s.school, s.grade, s.case_id`。**
即使不分頁，穩定排序使回應可預測、測試可斷言，且未來加入分頁時不會漏失或重複資料。

**不分頁。**
現有規模為數十至數百位學生。分頁一旦進入 API 契約便難以移除，且會連帶引入排序穩定性、總數回傳、呼叫端翻頁等成本。待實際需要時再加入。

## 查詢

```sql
SELECT s.grade, s.case_id, s.school,
       COUNT(a.uuid)     AS session_count,
       MAX(a.start_time) AS last_played_at
FROM student s
LEFT JOIN assessment_result a
       ON a.grade   = s.grade
      AND a.case_id = s.case_id
      AND a.school  = s.school
WHERE s.school = %s                    -- 僅在提供 school 時附加
GROUP BY s.grade, s.case_id, s.school
ORDER BY s.school, s.grade, s.case_id
```

### 三個會靜默產生錯誤結果的陷阱

這三者皆不會拋出例外，只會回傳錯誤的數字。每一項在測試中都有對應的案例。

**一、必須是 `COUNT(a.uuid)`，不可為 `COUNT(*)`。**
`LEFT JOIN` 對零場次學生產生一列，右側欄位皆為 NULL。`COUNT(*)` 計算列數，會將該列算為 1，使每位未遊玩的學生顯示為「1 場」。`COUNT(a.uuid)` 計算非 NULL 值，正確得到 0。

**二、`WHERE` 只能過濾 `s.school`，不可過濾 `a.school`。**
`WHERE a.school = %s` 在 join 之後套用，而零場次學生的 `a.school` 為 NULL，`NULL = '測試場域'` 為假，導致**所有零場次學生被濾除**，`LEFT JOIN` 退化為 `INNER JOIN`。這將摧毀本端點存在的理由。過濾 `s.school` 作用於驅動表，無此問題。

**三、`ON` 條件必須包含全部三個鍵欄位。**
若省略 `school`，不同場域中相同 `grade` / `case_id` 的學生會互相 join，使場次數被放大數倍。

### 其他

`MAX(a.start_time)` 在無任何場次時依 SQL 標準回傳 NULL，直接對應 `lastPlayedAt: null`，無須特別處理。

`school` 一律以 `%s` 參數化傳入。

`school` 非 `student` 主鍵的最左前綴，此查詢會全表掃描 `student`。在數百列規模下不需索引。若 `student` 成長至數萬列，再考慮加入 `INDEX(school)`。

## 錯誤處理

**空結果不是錯誤。**
`?school=不存在的場域` 回傳 `200`、`studentCount: 0`、空陣列，不回 404。理由有二：`/api/students` 資源本身存在，篩選後為空並非「找不到資源」；且在不額外查詢 `student` 表的前提下，無法分辨「場域不存在」與「場域存在但無學生」，而呼叫端可自行透過 `studentCount === 0` 判斷。

**`?school=` 為空字串或全為空白時，視同未提供。**
以 `school.strip()` 處理，若結果為空則視為 `None`，回傳所有場域。

**DB 錯誤回傳 500，且不洩漏內部資訊。**

現行三個端點皆為：

```python
raise HTTPException(status_code=500, detail=f"資料庫查詢失敗：{exc}")
```

此寫法將 PyMySQL 的原始例外訊息回傳給呼叫端，可能包含表名、欄位名，連線失敗時甚至包含主機位址與使用者名稱。本 API 部署於公開網路。

**三個端點一併改為**：回應固定訊息 `{"detail": "資料庫查詢失敗"}`，完整例外以 `logging.exception()` 寫入 server log。錯誤訊息內容不屬於 API 契約，此變更風險低。

## 模組結構

`main.py` 現為 366 行，混合了模型、工具函式、SQL 與路由。本次新增端點與測試會使其繼續成長，且現行結構無法在不碰資料庫的情況下測試組裝邏輯。

```
main.py              建立 app、掛載 router、/ 與 /health
db.py                連線設定（不變更）
models.py            所有 Pydantic 回應模型
converters.py        純轉換工具：format_datetime、to_int、to_float、game_type 對應表
queries.py           所有 SQL（唯一碰資料庫的模組）
routers/students.py  三個 /api/students 路由與 rows → models 的組裝
```

### 邊界上的兩個決定

**`parse_student_key` 留在 `routers/students.py`，不放入 `converters.py`。**
它會 `raise HTTPException(400)`，屬於 HTTP 層概念。放入 converters 會迫使該純工具模組匯入 FastAPI。

**`build_play_records` 拆為兩半。**
現行版本同時查詢遊戲細部表並合併結果，因此無法在不碰資料庫的情況下測試。

```python
# queries.py ── 碰資料庫
def fetch_stats_for_rows(rows) -> dict[str, dict]:   # uuid → stats row

# routers/students.py ── 純函式
def build_play_records(rows, stats_by_uuid) -> list[PlayRecord]:
```

拆分後，「合併邏輯是否正確」與「SQL 是否正確」成為兩個可分別回答的問題。

### 搬移不改變行為

既有兩個端點的輸入與輸出完全不變。唯一的行為變更是上述的 DB 錯誤訊息。

`fetch_game_stats_by_uuids` 以 f-string 將表名拼入 SQL，表名取自 `GAME_RESULT_TABLES` 白名單。此寫法安全，搬移時維持原樣並補上說明註解。

## 測試

### 測試資料庫

在既有 MariaDB 伺服器上建立 `AttentionLessonPlan_test`，結構取自正式庫 DDL，存於 `tests/schema.sql`。

不使用正式資料庫執行測試：測試會依賴正式資料的內容而變得不穩定，且任何寫入操作都會影響正式資料。

**安全閥。** `conftest.py` 在任何寫入之前斷言資料庫名稱：

```python
assert db_name.endswith("_test"), f"拒絕在非測試資料庫上執行：{db_name}"
```

此檢查防止一種具體的意外：未設定 `TEST_DB_NAME` 時，測試靜默連上正式庫並 `TRUNCATE` 掉 `student`。

測試資料庫連線資訊由環境變數提供（`TEST_DB_NAME` 等）。若未設定，需要資料庫的測試以 `pytest.skip` 跳過，不需要資料庫的測試仍然執行。

### 檔案結構

```
tests/
  schema.sql          建表 DDL
  conftest.py         連線、建表、每個測試前清空、插入 fixture
  test_converters.py  純函式
  test_assembly.py    rows → models（不碰資料庫）
  test_queries.py     SQL（碰測試資料庫）
  test_api.py         端點層（FastAPI TestClient）
```

新增測試相依：`pytest`、`httpx`（TestClient 需要）。

### 不碰資料庫的測試

- `format_datetime` 對 `None`、`datetime`、字串的行為
- `to_int` / `to_float` 對 `None` 的行為
- `normalize_game_type_for_db` / `_from_db` 的 `TGame` ↔ `TGAME` 對應
- `build_play_records` 的合併邏輯，包含 stats 缺漏時 `stats` 為 `None`
- `build_summary_by_game` 的加總與平均值計算，包含全無 stats 的分組
- `parse_student_key` 對 `G1`、`_S03`、`G1_`、`G1_S0_3` 的反應

### 碰測試資料庫的測試

每個測試對應一個 SQL 陷阱：

1. 插入一位零場次學生 → `sessionCount` 為 `0`，非 `1`
2. 指定 `school` 篩選 → 零場次學生仍出現在名單中
3. 兩個場域各有一位 `G1_S03`，其中一位有 3 場 → 兩者分別為 3 場與 0 場，而非各 3 場

另外驗證：`lastPlayedAt` 取 `MAX(start_time)` 且忽略 `end_time` 為 NULL 的影響；排序符合 `school, grade, case_id`。

`test_api.py` 以 TestClient 驗證端點層行為：`school` 未提供、提供、提供空白字串三種情形的回應結構；`studentCount` 等於 `students` 長度；DB 例外時回傳 500 且訊息不含例外內容。此層以測試資料庫為資料來源。

這三個陷阱若僅以假資料撰寫測試，將**全數通過但未驗證任何事**，因為錯誤存在於 SQL 之中，而假資料測試不執行 SQL。

### 實作順序

1. 建立測試資料庫與 `tests/` 骨架
2. 為既有兩個端點補上測試（在搬移之前）
3. 拆分模組，確認測試維持綠燈
4. 統一 DB 錯誤處理
5. 新增 `GET /api/students` 端點與其測試

搬移前先有測試，是為了讓搬移錯誤在 code review 之前就被發現。

## 已知債務

**既有端點的空字串日期。**
`format_datetime()` 對 `None` 回傳 `""`，因此既有端點在未完成場次的 `endTime` 為空字串。新端點的 `lastPlayedAt` 使用 `null`。此不一致不在本次修正，因為變更既有欄位型別可能破壞已依賴 `endTime === ""` 的呼叫端。

**資料庫安全性（不在本次範圍，建議另立工作項目）。**
MariaDB 的 `root` 帳號直接暴露於公開 IP，單一密碼為唯一防線。建議限制來源 IP，並為應用程式建立僅具 `SELECT` 權限的專用帳號，而非以 `root` 連線。此外，開發過程中曾以明文傳遞 root 密碼，建議輪換。
