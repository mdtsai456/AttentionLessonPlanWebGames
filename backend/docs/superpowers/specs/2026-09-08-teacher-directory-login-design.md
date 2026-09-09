# 場域／老師／學生選單登入與老師檢視頁設計

日期：2026-09-08 · 狀態：draft（待廠商確認場域字串後定案）

## 問題

目前 API 只服務「Unity 寫入」與「已知某位學生的查詢」兩件事，系統裡沒有「人」與
「場域清單」的概念：

- `school`（場域）只是散落在每一列裡的自由字串，沒有一份正式名單。前端無從得知
  「有哪 8 個場域、每個場域顯示什麼名稱」。
- 沒有「老師」這個實體。廠商要讓每個場域的兩位老師登入後，看到自己場域所有學生
  的遊玩進度。
- 小朋友端也需要一個「選到自己 → 接回自己過往遊玩紀錄」的入口。

廠商已明確定調（2026-09-08）：

1. **登入 = 下拉選單選人，沒有帳號密碼、沒有驗證。**
2. 一個場域的兩位老師**共同管理該場域的全部學生**，不各自分組。
3. 小朋友端也用下拉選單選人，目的只是「連回他之前的遊玩紀錄」。
4. 8 個場域：高雄醫學大學 ×1、清華大學 ×7。實際名稱字串尚未提供。
5. 16 位老師（吳老師、林老師、王老師⋯）由後端**直接在資料庫手動建立**。

## 範圍

**在範圍內：**

- 新增 `school`、`teacher` 兩張資料表。
- 新增 3 支唯讀 API：場域清單、某場域的老師清單、某老師名下的學生清單。
- 一支冪等的參照資料灌注腳本 `seed_directory.py`（8 場域 + 16 老師）。
- `app_ro` 對兩張新表的 `SELECT` 授權。
- 對應的測試與文件更新。

**不在範圍內：**

- 帳號密碼、Session、JWT、任何形式的身分驗證與授權。
- 老師↔學生的指派對應表（廠商定調「兩位老師管全部」，用不到）。
- 學生姓名（名冊表沒有此欄位，維持現況）。
- 修改任何既有端點的輸入或輸出。
- 修改 `student` 及五張遊戲結果表的結構。
- 前端（由另一位組員負責）。
- 改用 `uv` 管理環境（獨立工作項目，另見附錄 A）。

## 名詞

- **場域（school）** — 施測地點，是學生身分的一部分（見 `CONTEXT.md`）。本設計把
  「目前散落在資料裡的 `school` 字串」正規化成一份清單。
- **老師（teacher）** — 隸屬於**單一**場域。同場域的老師看得到該場域的所有學生。
- **參照資料（reference data）** — `school`、`teacher` 這種「由人工維護、量少、
  變動極慢」的資料。相對於 `seed.py` 灌的「假成績（mock data）」，兩者用不同腳本、
  不同心態管理。

## 既有資料模型（不變更）

```sql
student(grade, case_id, school)                    -- PK 為此三欄複合鍵
assessment_result(grade, case_id, school, uuid, …) -- FK → student
dccs_result / dat_result / eft_result /
im_result / tgame_result                           -- FK → assessment_result
```

關鍵事實：

- 學生唯一鍵是 `(grade, case_id, school)`。**不同場域的 `G1_S03` 是不同的學生。**
- `school` 這個字串同時是：`student` 的主鍵欄位之一、`assessment_result` 與五張
  結果表的外鍵欄位、Unity `POST /api/sessions` 送上來的 `data.school`、所有查詢
  端點的 `school` 參數。**它是串起整個系統的 join key。**
- `student` 是真正的名冊表：「已註冊但零場次」的學生存在且應被查出。

## 新增資料模型

### `school`

```sql
CREATE TABLE IF NOT EXISTS `school` (
  `school`       varchar(100) NOT NULL,       -- 與 student.school 完全相同的字串
  `display_name` varchar(100) NOT NULL,       -- 前端下拉顯示用
  `sort_order`   int          NOT NULL DEFAULT 0,
  PRIMARY KEY (`school`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### `teacher`

```sql
CREATE TABLE IF NOT EXISTS `teacher` (
  `teacher_id` int          NOT NULL AUTO_INCREMENT,
  `name`       varchar(50)  NOT NULL,
  `school`     varchar(100) NOT NULL,
  PRIMARY KEY (`teacher_id`),
  UNIQUE KEY `uq_teacher_school_name` (`school`, `name`),
  CONSTRAINT `fk_teacher_school` FOREIGN KEY (`school`)
    REFERENCES `school` (`school`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 結構決定與理由

**`school` 表的主鍵就是那個既有的 `school` 字串，不另立代碼欄位。**
整個系統（含 Unity 契約與六張既有表）都已用 `school` 字串當識別。若改用新的
`school_id` / `school_code`，得同步遷移 `student`、`assessment_result`、五張結果表，
並要求 Unity 改送代碼 —— 牽動最大攻擊面，且沒有對應的效益。`school` 表因此定位為
一份「合法場域字串的登記處 + 顯示名稱對照」，不是重新設計識別方式。

**（2026-09-09 更新：此決定已推翻，外鍵已加 —— 見 [ADR 0003](../../adr/0003-student-school-foreign-key.md)。下段為當初的理由。）**

**不在 `student.school` 上加外鍵指向 `school.school`。**
兩個具體風險：(1) 正式庫已有 5 筆 `school = "測試場域"` 的舊資料，硬加外鍵會讓建立
外鍵失敗，或逼我們先把「測試場域」補進 `school` 表。(2) `POST /api/sessions` 會
`INSERT IGNORE INTO student`；若 `school` 尚未登記，寫入會被外鍵擋下、整場遊戲結果
丟失 —— 這是把「參照資料沒維護好」的後果轉嫁給受試者資料，代價不對等。
`school` 表先當「軟性名單」用，查詢端點以它為準；要收緊成硬約束是日後的獨立決定
（屆時需先確保所有既有 `student.school` 值都已登記，且 Unity 端不會送出表外的值）。

**`teacher.school` → `school.school` 的外鍵則要加。**
這條的兩端都由我們控制（人工建立），加外鍵能擋掉「把老師掛到不存在的場域字串」
這種手誤。`ON UPDATE CASCADE`：若日後修正某個場域字串的拼法，老師自動跟著改。
不設 `ON DELETE`（預設 `RESTRICT`）：還有老師掛著的場域不能被刪。

**不做老師↔學生對應表。**
廠商定調「同場域兩位老師管全部學生」。因此「某位老師能看的學生」=
`SELECT * FROM student WHERE school = (該老師的 school)`。多一張對應表只會多一個
要維護、要防呆、會不一致的東西。日後若真的要細分，再新增
`teacher_student(teacher_id, grade, case_id, school)` 對應表，不需要改動既有結構。

**`teacher` 沒有密碼欄位。**
廠商定調下拉選人。加一個現在不用、又會誘使人塞明文密碼的欄位，是負債。日後若要
真驗證，屆時新增 `password_hash` 等欄位並補驗證流程，是一個完整的獨立設計。

**`UNIQUE (school, name)`。**
同一場域不該有兩個「吳老師」（下拉會分不出來）。跨場域同名允許（高醫的吳老師和
清大的吳老師是兩個人），所以 unique 鍵帶上 `school`。

**`teacher_id` 用 `AUTO_INCREMENT` 整數，並直接出現在 URL。**
這是一個內部研究工具，老師 id 不是機密，遞增整數足夠。不用 UUID：徒增噪音。

## API 契約

所有新端點皆為 `GET`、唯讀、回應 `application/json`。

### 1. `GET /api/schools`

場域清單，供第一層下拉。

**回應 200：**

```json
{
  "schools": [
    { "school": "高雄醫學大學", "displayName": "高雄醫學大學" },
    { "school": "清華大學-01",  "displayName": "清華大學（第一場）" }
  ]
}
```

依 `sort_order`、再依 `school` 排序。永遠回 200；沒有任何場域時回空陣列。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `schools[].school` | `string` | 場域識別字串，等同 `student.school`。前端後續呼叫要原樣帶回 |
| `schools[].displayName` | `string` | 下拉顯示文字，可與 `school` 相同 |

### 2. `GET /api/schools/{school}/teachers`

某場域的老師清單，供老師端第二層下拉。`{school}` 為路徑參數，中文需 URL-encode。

**回應 200：**

```json
{
  "school": "高雄醫學大學",
  "teachers": [
    { "teacherId": 1, "name": "吳老師" },
    { "teacherId": 2, "name": "林老師" }
  ]
}
```

依 `teacher_id` 排序（等同建立順序）。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `school`（頂層） | `string` | 回顯路徑參數 |
| `teachers[].teacherId` | `int` | 老師識別碼 |
| `teachers[].name` | `string` | 老師顯示名稱 |

**未知場域回 200 + 空陣列，不回 404。**
與既有 `GET /api/students?school=不存在` 的處理一致（見
`2026-07-09-student-list-endpoint-design.md`）：`teachers` 這個集合資源存在，篩選後
為空不是「找不到資源」。前端從 `/api/schools` 拿到的場域必定合法，不會走到這條。

### 3. `GET /api/teachers/{teacherId}/students`

某位老師名下的學生清單（= 該老師所屬場域的全部學生），供老師檢視頁的第一畫面。

**回應 200：**

```json
{
  "teacherId": 1,
  "teacherName": "吳老師",
  "school": "高雄醫學大學",
  "studentCount": 6,
  "students": [
    {
      "studentKey": "G1_S01",
      "grade": "G1",
      "caseId": "S01",
      "school": "高雄醫學大學",
      "sessionCount": 12,
      "lastPlayedAt": "2026-09-05 14:30:00"
    },
    {
      "studentKey": "G1_S02",
      "grade": "G1",
      "caseId": "S02",
      "school": "高雄醫學大學",
      "sessionCount": 0,
      "lastPlayedAt": null
    }
  ]
}
```

`students[]` 的形狀與欄位語意**完全沿用**既有 `GET /api/students` 的 `StudentListItem`
（`sessionCount` 含未完成場次、零場次學生也會列出、`lastPlayedAt` 取
`MAX(start_time)` 且零場次為 `null`）。排序沿用既有的 `school, grade, case_id`。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `teacherId` | `int` | 回顯路徑參數 |
| `teacherName` | `string` | 該老師名稱 |
| `school` | `string` | 該老師所屬場域 |
| `studentCount` | `int` | 等同 `students` 長度，Python 端計算 |
| `students[]` | `StudentListItem` | 同 `GET /api/students` |

**未知 `teacherId` 回 404。**
與端點 2 不同：`/api/teachers/{teacherId}` 指名一個**特定實體**，該實體不存在就是
「找不到資源」。回應 `{"detail": "查無此老師"}`。

### 沿用既有端點（本設計不修改）

登入後看單一學生的進度、趨勢圖、各遊戲彙總，全部走既有端點：

```
GET /api/students/{studentKey}/report?school={school}     ← 主要，含 records / summaryByGame / trends
GET /api/students/{studentKey}/sessions?school={school}   ← 較輕量，只有場次時間
```

`中介平台資料JennyLin.pdf` 第 4–9 頁列出的所有圖表所需欄位（`accuracy`、
`correct_count`、`wrong_count`、`duration`、`stage`、趨勢用的 `start_time`），現有
`/report` 已全數提供。

> **注意**：這兩支端點會被另一份設計
> [`2026-09-08-single-vs-double-player-mode-design.md`](2026-09-08-single-vs-double-player-mode-design.md)
> 修改（每筆回應加 `mode` 欄位、`summaryByGame`／`trends` 改依 `(gameType, mode)`
> 分組、新增 `?mode=` 篩選）。本登入設計不碰它們，兩份設計互不阻塞。

### 兩條前端流程

```
小朋友端：
  GET /api/schools
      → 選場域
  GET /api/students?school={school}            （既有）
      → 選自己
  GET /api/students/{studentKey}/report?school={school}   （既有）

老師端：
  GET /api/schools
      → 選場域
  GET /api/schools/{school}/teachers
      → 選老師
  GET /api/teachers/{teacherId}/students
      → 看名下所有學生的概況，點其中一位
  GET /api/students/{studentKey}/report?school={school}   （既有）
```

## 查詢

新增在 `queries.py`（唯一碰資料庫的模組）。所有值一律 `%s` 參數化。

### `fetch_schools()`

```sql
SELECT school, display_name, sort_order
FROM school
ORDER BY sort_order, school
```

### `fetch_teachers(school)`

```sql
SELECT teacher_id, name
FROM teacher
WHERE school = %s
ORDER BY teacher_id
```

### `fetch_teacher(teacher_id)` → `dict | None`

```sql
SELECT teacher_id, name, school
FROM teacher
WHERE teacher_id = %s
```

`None` 表示查無此老師 → router 轉 404。

### 某老師名下的學生

**不寫新 SQL。** 先 `fetch_teacher(teacher_id)` 取得 `school`，再呼叫既有的
`fetch_students(school)`。既有那支查詢已處理好三個 LEFT JOIN 陷阱（見
`2026-07-09-student-list-endpoint-design.md` 的「三個會靜默產生錯誤結果的陷阱」），
沒有理由複製一份。

## 錯誤處理

- **DB 例外 → 500，訊息固定為 `{"detail": "資料庫查詢失敗"}`。** 沿用
  `routers/students.py` 既有的 `db_error()`：完整例外進 server log，不外洩表名／
  欄位名／連線資訊。
- **端點 1、2 的空結果不是錯誤**：回 200 + 空陣列。
- **端點 3 的未知 `teacherId` 是錯誤**：回 404。
- **`{school}` 為空白**：`school.strip()` 後為空時，端點 2 回 200 + 空 `teachers`
  （不特別處理，交由「查無資料」自然涵蓋）。

## 模組結構

| 檔案 | 動作 | 內容 |
|---|---|---|
| `tests/schema.sql` | 修改 | 追加 `school`、`teacher` 兩段 `CREATE TABLE IF NOT EXISTS`。`school` 在 `teacher` 之前（外鍵） |
| `queries.py` | 修改 | 新增 `fetch_schools()`、`fetch_teachers(school)`、`fetch_teacher(teacher_id)` |
| `models.py` | 修改 | 新增 `SchoolItem`、`SchoolListResponse`、`TeacherItem`、`TeacherListResponse`、`TeacherStudentsResponse` |
| `routers/directory.py` | 新增 | 三支端點 + rows→models 組裝。命名 `directory`（場域／老師的「通訊錄」），不叫 `auth`（沒有驗證） |
| `main.py` | 修改 | `app.include_router(directory.router)` |
| `seed_directory.py` | 新增 | 冪等灌入 8 場域 + 16 老師的參照資料腳本 |
| `tests/conftest.py` | 修改 | `_schema` 建表清單、`TABLES_CHILD_FIRST` 清空清單各加兩張表（清空時 `teacher` 在 `school` 之前） |
| `tests/test_directory.py` | 新增 | 端點層與查詢層測試 |
| `tests/test_seed_directory.py` | 新增 | 灌注腳本的冪等性與內容測試 |
| `README.md` | 修改 | 端點表補 3 列；新增「參照資料」一節 |
| `CONTEXT.md` | 修改 | 名詞表補「老師」「參照資料」 |
| `docs/adr/0001-…​.md` | 修改 | 「後續實施」補一條：`app_ro` 加 `school`、`teacher` 的 `SELECT` |

### 命名決定

**router 檔名是 `directory.py`，不是 `auth.py` 或 `login.py`。**
這支 router 不驗證任何身分、不發任何憑證，只是回傳場域與老師的清單。叫 `auth`
會讓後續維護者以為這裡有安全邊界。`directory`（通訊錄／名錄）如實描述它做的事。

**`seed_directory.py` 與 `seed.py` 分開。**
`seed.py` 灌的是「可重現的假成績」，心態是「先清空再灌、隨時可丟」。`school` 與
`teacher` 是要跟著正式庫走的真參照資料，心態是「冪等補齊、絕不清空」。兩者混在一起
遲早出事。

## 參照資料灌注：`seed_directory.py`

```
python seed_directory.py           # 灌 TEST_DB_NAME 的 _test 庫（守衛拒非 _test）
DB_USER=root DB_PASSWORD=… python seed_directory.py --prod   # 灌正式庫，走 root 閘門
```

- **冪等**：以 `INSERT ... ON DUPLICATE KEY UPDATE`（或先 `SELECT` 再決定）補齊，
  **不 `DELETE`**。重跑不會產生重複，也不會清掉既有資料。
- **沿用 `seed.py` 的安全閘**：預設只碰 `TEST_DB_NAME` 且名稱須以 `_test` 結尾；
  `--prod` 才讀 `DB_NAME`，且依 ADR-0001「正式庫寫入走 root」。
- 資料內容放在腳本頂端的常數區，一眼可改：

```python
SCHOOLS = [
    # (school 字串, 顯示名稱, 排序)   ← 字串待廠商確認，先放佔位
    ("KMU",     "高雄醫學大學",       0),
    ("NTHU-01", "清華大學（第一場）", 1),
    # … NTHU-02 … NTHU-07
]
TEACHERS = [
    # (場域 school 字串, 老師名稱)
    ("KMU", "吳老師"), ("KMU", "林老師"),
    ("NTHU-01", "王老師"), ("NTHU-01", "陳老師"),
    # … 每場域 2 位，共 16 位
]
```

## 場域字串的對齊（廠商 Q4：影響大嗎？）

**不擋你現在開工，但正式資料開始寫入前必須定案。**

`school` 這個字串是六張既有表的 join key、是 Unity `POST` 的 payload 欄位、是所有
查詢的參數。一旦某個場域在 Unity 端送的是 `"清華大學01"`、在 `school` 表登記的是
`"清華大學-01"`，兩邊就永遠對不起來，而且**不會報錯**，只會查出空結果。

必須三方講好同一份字串：

1. **Unity 團隊** —— 每個場域的遊戲 build 會帶一個固定的 `school` 值。
2. **前端** —— 顯示 `displayName`、送回 `school`。
3. **本專案** —— `school` 表即為這份字串的唯一真實來源（source of truth）。

**建議**：`school` 存**短的、無空白、無標點的 ASCII 代碼**（`KMU`、`NTHU01`…
`NTHU07`），中文放 `display_name`。理由：避免全形／半形、空白、破折號變體造成的
隱性不一致；URL 裡當路徑參數也乾淨。代價：Unity 端要改成送代碼、既有的
`"測試場域"` 資料要一併處理 —— 這需要 Unity 團隊點頭。

**若 Unity 無法改**：就沿用中文場域名當 `school` 字串，但務必逐字凍結一份清單，
`display_name` 可與 `school` 相同。

**現階段**：`seed_directory.py` 先放佔位代碼，3 支端點、前端、查詢全部照結構做完。
字串定案後只改 `seed_directory.py` 的 `SCHOOLS`／`TEACHERS` 常數、重跑腳本即可，
不動任何邏輯。

## 資料庫帳號與權限（對齊 ADR-0001）

| 帳號 | 對新表需要 | 動作 |
|---|---|---|
| `app_ro` | 正式庫 `school`、`teacher` 的 `SELECT` | **需新增 GRANT**（由 root 執行） |
| `seeder` | `_test` 庫兩張新表的 `SELECT/INSERT/DELETE` | 已涵蓋（ADR-0001 給的是 `_test` 庫級權限） |
| `game_writer` | 無（不碰場域／老師） | 不變 |
| `root` | 建立正式庫兩張表、灌 8+16 筆參照資料 | 人工執行 |

```sql
-- 由 root 執行，正式庫：
GRANT SELECT ON AttentionLessonPlan.school  TO 'app_ro'@'%';
GRANT SELECT ON AttentionLessonPlan.teacher TO 'app_ro'@'%';
FLUSH PRIVILEGES;
```

## 測試

沿用既有測試基礎建設（`tests/conftest.py` 的 `_test` 守衛、每個測試前後清空、
`TEST_DB_NAME` 未設時 skip 需要 DB 的測試）。

### conftest 調整

- `_schema_statements()` 會自動吃到 `schema.sql` 新增的兩段 `CREATE TABLE`。
- `TABLES_CHILD_FIRST` 追加 `"teacher"`、`"school"`，且 **`teacher` 要排在
  `school` 之前**（先刪子表）。放在既有七張表之後即可（彼此無外鍵牽連）。

### 不碰資料庫的測試（`test_directory.py` 一部分）

- `SchoolListResponse` / `TeacherListResponse` / `TeacherStudentsResponse` 的
  欄位名與型別（Pydantic 驗證）。
- 組裝函式：rows → models，`studentCount` 等於 `students` 長度。

### 碰測試資料庫的測試（`test_directory.py` 其餘）

| 測試 | 驗證 |
|---|---|
| 灌 3 個場域、`sort_order` 交錯 | `/api/schools` 依 `sort_order` 排序，非插入序或字母序 |
| 場域 A 有吳老師、場域 B 也有吳老師 | `/api/schools/A/teachers` 只回 A 的吳老師；兩人 `teacherId` 不同、不合併 |
| 老師所屬場域有 1 位零場次學生 | `/api/teachers/{id}/students` 列出該學生，`sessionCount` 為 `0` |
| 兩場域各有一位 `G1_S03`，老師在其中一場 | `/api/teachers/{id}/students` 只含該場域那位，不含另一場的同代號學生 |
| 不存在的 `teacherId` | `/api/teachers/99999/students` 回 404 |
| 不存在的場域 | `/api/schools/不存在/teachers` 回 200 + 空陣列 |
| `INSERT INTO teacher` 帶不存在的 `school` | 外鍵擋下，拋 `IntegrityError` |
| 同場域插入兩個同名老師 | `UNIQUE (school, name)` 擋下 |

### `test_seed_directory.py`

- 對空的 `_test` 庫跑一次 → `school` 有 8 列、`teacher` 有 16 列。
- **再跑一次** → 筆數不變（冪等），不拋重複鍵例外。
- 守衛：`TEST_DB_NAME` 非 `_test` 結尾時 `SystemExit`。

## 實作順序

1. **schema + conftest**：`tests/schema.sql` 加兩張表；`conftest.py` 更新建表與
   清空清單；跑既有測試確認全綠（新表不影響既有行為）。
2. **`seed_directory.py` + `test_seed_directory.py`**：先能把參照資料灌進 `_test`。
3. **`queries.py`**：三個 fetch 函式 + `test_directory.py` 的查詢層測試。
4. **`models.py`**：五個回應模型。
5. **`routers/directory.py` + `main.py` 掛載**：三支端點 + `test_directory.py` 的
   端點層測試（TestClient）。
6. **文件**：`README.md`、`CONTEXT.md`、`docs/adr/0001` 後續實施補一條。
7. **（維運，人工）**：正式庫建兩張表、`GRANT` 給 `app_ro`、以 root 跑
   `seed_directory.py --prod`。**待場域字串定案後才做這步。**

每個步驟結束時 commit。

## 已知債務／後續

**沒有任何存取控制。**
「下拉選人、無密碼」意味著任何人只要連到網站，就能選任一場域、任一學生，看到
完整遊玩資料。這是廠商的決定，也與現況一致（既有 `/api/students`、`/report` 本來
就無驗證）。研究資料涉及兒童，建議至少擇一補上：整站共用密碼、來源 IP 白名單、
或不可猜的網址。**列為獨立工作項目，不在本次範圍**，但應向廠商正式提出。

**`student.school` 無外鍵。**
`school` 表目前是軟性名單。要升級成硬約束，需先確保所有既有 `student.school` 值
都已登記、且 Unity 端不會送出表外的值，再一次性加上外鍵。獨立決定。

**`teacher_id` 直接暴露於 URL。**
內部工具可接受。若日後平台對外，再考慮換不可枚舉的識別碼。

**老師檢視頁與 `mode` 的關係。**
`GET /api/teachers/{teacherId}/students` 回的 `students[].sessionCount` 是**所有
模式合計**的場次數，不分單雙人。老師點進某位學生後，走
`GET /api/students/{studentKey}/report`，那支端點才會把單／雙人分開（見
[單／雙人模式設計](2026-09-08-single-vs-double-player-mode-design.md)）。若日後要
讓老師名單頁也能只看某模式，在 `/api/teachers/{teacherId}/students` 加一個
`?mode=` 參數即可 —— 不在本次範圍。

---

## 兩份設計的分工

| | 這份（登入／場域／老師） | [單／雙人模式](2026-09-08-single-vs-double-player-mode-design.md) |
|---|---|---|
| 新資料表 | `school`、`teacher` | 無 |
| 改資料表 | 無 | `assessment_result` 加 `mode`、`pair_id` |
| 新端點 | `/api/schools`、`/api/schools/{s}/teachers`、`/api/teachers/{id}/students` | 無 |
| 改端點 | 無 | `POST /api/sessions`、`GET .../report`、`GET .../sessions` |
| 依賴關係 | **互不阻塞**，可任一順序、甚至平行實作 | 同左 |
| 建議先做 | 這份較單純，適合先暖身；但兩者皆可先開工 | — |

---

## 附錄 A：改用 `uv` 管理環境（獨立工作項目）

廠商指定用 [`uv`](https://docs.astral.sh/uv/)。這與本設計無耦合，可獨立進行，
但建議儘早做，因為它**順帶修掉一個現存問題**：`requirements.txt` 未鎖版本，
`pip install` 會抓到最新的 `starlette` / `anyio`，兩者新版的 deprecation 會讓
`pytest.ini` 的 `filterwarnings = error` 直接把測試收集階段打成 error。

建議做法：

1. 新增 `pyproject.toml`，`[project].dependencies` 放 `requirements.txt` 的四項、
   `[dependency-groups].dev`（或 `[project.optional-dependencies].dev`）放
   `pytest`、`httpx`。`requires-python = ">=3.10"`（`X | None` 型別語法所需，
   見 README）。
2. `uv lock` 產生 `uv.lock` 並**進版控** —— 版本從此鎖定，CI 與本機一致。
3. 日常指令改為 `uv run uvicorn main:app --reload --port 5001`、`uv run pytest`。
4. Zeabur 部署：`uv` 有原生支援；或以 `uv export --no-hashes -o requirements.txt`
   保留一份給現有部署流程。`Procfile` 不變（`uvicorn main:app …`）。
5. `requirements.txt` / `requirements-dev.txt` 可保留為 `uv export` 的產物，或
   直接刪除、README 改指向 `uv`。

此附錄之後可獨立成 `docs/adr/0002-use-uv-for-env.md`。
