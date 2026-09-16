# 後端 API + 資料庫結構總覽

一站式參考文件：現在有哪些 API、每支要不要登入、資料庫長什麼樣子。給自己、前端、
Unity、廠商快速對照用。**精確定義以程式碼為準**——API 是 `routers/*.py`，
資料庫是 [`tests/schema.sql`](../tests/schema.sql)（正式庫與測試庫都照這份建）；
這份文件是兩者的濃縮整理，程式改了這份可能會晚一步更新。

- 前端要串接的詳細規格（含 request/response 完整 JSON 範例）：
  [`frontend-integration-guide.md`](frontend-integration-guide.md)
- 資料庫的完整 ER 圖與關係推演過程：[`database-schema.md`](database-schema.md)
- 帳密登入為什麼長這樣（決策脈絡）：
  [`adr/0004-teacher-student-password-login.md`](adr/0004-teacher-student-password-login.md)
- Unity 對接細節：[`unity-integration-guide.md`](unity-integration-guide.md)

最後更新：2026-09-12（帳密登入上線後）。

---

## 1. API 端點總覽

「驗證」欄的意思：

| 標示 | 意思 |
|---|---|
| 公開 | 不用帶 `Authorization`，誰都能打 |
| 老師 | 要帶 `Authorization: Bearer <token>`，且該 token 必須是老師登入拿到的；查別場域一律 `403` |
| 老師或學生 | 老師 token（限自己場域）或學生 token（限自己）都可以，403 規則同上 |
| 無 | 機對機端點，Unity 用，不走人的登入 |

### 1.1 系統

| 方法 | 路徑 | 驗證 | 說明 |
|---|---|---|---|
| GET | `/health` | 公開 | 存活檢查，回 `{"status":"ok"}` |
| GET | `/` | 公開 | 根路徑，回基本資訊 + `/docs` 連結 |
| GET | `/docs` | 公開 | Swagger UI 互動式文件 |
| GET | `/demo` | 公開 | 開發／驗收用簡易檢視頁（`demo/index.html`）。**帳密登入上線後這頁會壞**（還沒接登入態），非正式前端，不用管它 |

### 1.2 帳密登入（`routers/auth.py`）

| 方法 | 路徑 | 驗證 | 說明 |
|---|---|---|---|
| POST | `/api/auth/teacher/login` | 公開 | body `{account, password}`。成功回 `{token, teacherId, teacherName, school}`；失敗 `401` |
| POST | `/api/auth/student/login` | 公開 | body `{account, password}`。成功回 `{token, studentKey, grade, caseId, school}`；失敗 `401` |
| POST | `/api/auth/logout` | 公開（帶 token 才有作用） | 登出當前 token；找不到 token 也回 `204`（冪等） |

`account` 是後端另外指派的**全域唯一**帳號（老師 `T0001`、學生 `S0001` 這種格式），
**不是**老師姓名或 `studentKey`——兩者都只在單一 `school` 內唯一，撐不住不選場域、
單靠帳號查到唯一一個人的登入表單。帳號由管理者用 `seed_directory.py`／
`manage_passwords.py` 指派，見 §3.4。

### 1.3 場域／老師名錄（`routers/directory.py`）

| 方法 | 路徑 | 驗證 | 說明 |
|---|---|---|---|
| GET | `/api/schools` | 公開 | 場域清單（`school` 代碼 + `displayName`），依 `sort_order` 排序 |
| GET | `/api/schools/{school}/teachers` | 公開 | 某場域的老師清單（`teacherId` + `name`）。未知場域回 `200` + 空陣列，不是 `404` |
| GET | `/api/me/students` | 老師 | **登入後請用這支**：老師名下（＝其場域全部）學生概況，身份完全來自 token，不接受任何參數 |
| GET | `/api/teachers/{teacherId}/students` | 老師（限本人） | 同上，舊端點，保留給相容用途（`/demo`、舊測試）。`teacherId` 不是自己的 token → `403`；查無此老師 → `404`（理論上打不到，因為 token 一定對應存在的老師） |

### 1.4 學生資料（`routers/students.py`）

| 方法 | 路徑 | 驗證 | 說明 |
|---|---|---|---|
| GET | `/api/students` | 老師 | `?school=` 選填，不給預設自己的場域；帶了不同場域 → `403`（不是查全部場域） |
| GET | `/api/students/{studentKey}/sessions` | 老師或學生 | 場次清單（輕量版，無成績數字）。`?school=` 必填，`?game_type=`／`?mode=` 選填 |
| GET | `/api/students/{studentKey}/report` | 老師或學生 | ★主要端點：場次明細＋各遊戲彙總＋趨勢序列。參數同上 |

`studentKey` 格式是 `grade_caseId`（例 `G1_S03`），格式錯回 `400`。

### 1.5 遊戲清單（`routers/sessions.py`）

| 方法 | 路徑 | 驗證 | 說明 |
|---|---|---|---|
| GET | `/api/games` | 公開 | 靜態遊戲清單 `{games:[{gameType, doubleCapable}]}`，固定 5 項（`DAT`/`DCCS`/`EFT`/`IM`/`TGame`），`doubleCapable` 標記是否有雙人版 |

### 1.6 Unity 寫入（`routers/sessions.py`）

| 方法 | 路徑 | 驗證 | 說明 |
|---|---|---|---|
| POST | `/api/sessions` | 無（機對機） | 接收 Unity GameData，寫入一場遊戲結果，成功回 `201 {sessionId}`。這支刻意不驗證使用者身份，也不是這次帳密登入的對象（見 ADR 0004「不在範圍」） |

### 1.7 通用錯誤

| 狀況 | HTTP | body |
|---|---|---|
| 帳號或密碼錯 | `401` | `{"detail":"帳號或密碼錯誤"}` |
| 沒帶 token／token 過期或無效 | `401` | `{"detail":"請重新登入"}` |
| 查到不屬於自己的資料 | `403` | `{"detail":"無權查看其他場域資料"}` |
| `studentKey` 格式錯 | `400` | `{"detail":"studentKey 格式應為 G1_S03（grade_caseId）"}` |
| 資料庫查詢／寫入失敗 | `500` | `{"detail":"資料庫查詢失敗"}`（不含細節，完整例外只寫進 server log） |
| 少必填 query | `422` | FastAPI 內建驗證錯誤結構 |

---

## 2. 資料庫結構總覽（MariaDB，10 張表）

完整 ER 圖見 [`database-schema.md`](database-schema.md)；這裡列出每張表現在的完整欄位。

### 2.1 參照資料（人工維護，量少）

**`school`** — 場域清單

| 欄位 | 型別 | 說明 |
|---|---|---|
| `school` PK | varchar(100) | 場域代碼，如 `KMU`、`NTHU-01` |
| `display_name` | varchar(100) | 顯示名稱 |
| `sort_order` | int | 下拉排序 |

**`teacher`** — 老師名錄

| 欄位 | 型別 | 說明 |
|---|---|---|
| `teacher_id` PK | int AUTO_INCREMENT | |
| `name` | varchar(50) | 老師姓名，`UNIQUE(school, name)`——只在場域內唯一 |
| `school` FK→`school` | varchar(100) | 所屬場域 |
| `password_hash` | varchar(255) | pbkdf2 雜湊，預設空字串（尚未指派） |
| `account` | varchar(20) NULL, UNIQUE | 登入帳號，全域唯一，格式 `T0001`（見 §1.2） |

**`student`** — 學生名冊

| 欄位 | 型別 | 說明 |
|---|---|---|
| `grade`,`case_id`,`school` PK | varchar | 複合主鍵；`(grade, case_id)` 每場域都會重複，故不能單獨當帳號 |
| `school` FK→`school` | varchar(100) | |
| `password_hash` | varchar(255) | 同上 |
| `student_id` | int AUTO_INCREMENT, UNIQUE | 純粹為登入帳號加的代理鍵，不影響原本複合主鍵/外鍵 |
| `account` | varchar(20) NULL, UNIQUE | 登入帳號，全域唯一，格式 `S0001` |

### 2.2 登入憑證

**`login_session`** — 帳密登入後發的 token（故意不叫 `session`，避免跟下面的「遊戲場次」搞混）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `token` PK | varchar(64) | 不透明字串，`Authorization: Bearer` 帶這個 |
| `subject_type` | enum('teacher','student') | |
| `teacher_id` FK→`teacher` | int NULL | 老師登入才填 |
| `grade`,`case_id`,`school` FK→`student` | varchar NULL | 學生登入才填 |
| `created_at`／`expires_at` | datetime | 8 小時後過期 |

### 2.3 遊戲資料

**`assessment_result`** — 場次索引（一場 = 一列）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `grade`,`case_id`,`school`,`uuid` PK | varchar | 前三欄 FK→`student` |
| `start_time`／`end_time` | datetime | 未結束時 `end_time` 為 NULL（API 回應轉成 `""`） |
| `game_type` | varchar(20) | `DAT`／`DCCS`／`EFT`／`IM`／`TGAME` |
| `mode` | enum('single','double') | 預設 `single` |
| `pair_id` | varchar(36) NULL | 雙人局的兩筆共用；後端只存不查 |
| `current_day` | int | 第幾個施測日 |

**`dat_result`／`dccs_result`／`eft_result`／`im_result`／`tgame_result`** — 各遊戲細部成績

五張表結構相同的核心 5 欄 + 各自專屬欄位：

| 共同欄位 | 型別 | 說明 |
|---|---|---|
| `grade`,`case_id`,`school`,`uuid` PK | varchar | FK→`assessment_result`，`ON DELETE CASCADE` |
| `correct_count`／`wrong_count` | int | |
| `accuracy` | double | 0–1 |
| `duration` | double | 毫秒 |
| `stage` | int | 實際作答題數／關卡數 |

專屬欄位數：`dat_result` +12、`dccs_result` +7、`eft_result` +9、`im_result` +10、
`tgame_result` +1（`TGame_obstacleHitCount`）。目前 API 不回傳這些專屬欄位，只回
共同 5 欄（見 `models.GameStats`）。

### 2.4 關係一句話版

```
school ──┬── teacher（同場域老師看同場域全部學生，靠 school 字串推導，無中介表）
         └── student ── assessment_result ── 五張 *_result（依 game_type 分流）
teacher ──┐
          ├── login_session（老師/學生登入後各自的 token，互斥：一筆只填其中一組 FK）
student ──┘
```

完整 ER 圖（含每個外鍵的行為說明）見 [`database-schema.md`](database-schema.md)。

---

## 3. 快速對照

### 3.1 模組 → 檔案

| 檔案 | 職責 |
|---|---|
| `main.py` | 建立 app、掛載所有 router、CORS 設定、`/`、`/health`、`/demo` |
| `db.py` | MariaDB 連線設定（read/write 兩組帳密） |
| `auth.py` | 密碼雜湊（`hash_password`/`verify_password`）、token 產生，純函式 |
| `errors.py` | 共用的 `db_error()`（DB 例外轉成不洩漏細節的 500） |
| `converters.py` | 純轉換工具（型別正規化、時間格式） |
| `models.py` | 所有 Pydantic 回應/請求模型 |
| `queries.py` | 讀取用 SQL |
| `writes.py` | 寫入用 SQL（Unity 場次、登入 token） |
| `routers/sessions.py` | `POST /api/sessions`（Unity）、`GET /api/games` |
| `routers/students.py` | `/api/students`、`/sessions`、`/report` |
| `routers/directory.py` | `/api/schools`、`/api/me/students`、`/api/teachers/{id}/students` |
| `routers/auth.py` | 登入／登出端點 |
| `routers/identity.py` | 「每次 API 呼叫都驗身份」的 dependency（`Identity`/`get_current_identity`/`require_teacher`/授權檢查），獨立成模組是為了避免 `routers/auth.py` 和 `routers/students.py` 互相 import 造成循環匯入 |
| `seed.py` | 灌假成績到 `_test`（`--prod` 才碰正式庫），假學生密碼固定 `test1234` |
| `seed_directory.py` | 冪等灌注 `school`／`teacher`，順便幫還沒帳號的老師指派 `account`+密碼並印出 |
| `manage_passwords.py` | CLI，手動重設單一老師/學生的密碼（帳號缺的話順便補一個） |

### 3.2 五個 `game_type` 對應表

| Unity 送的 / API 回的 | DB 存的 | 細部表 | 有雙人版？ |
|---|---|---|---|
| `DAT` | `DAT` | `dat_result` | 有 |
| `DCCS` | `DCCS` | `dccs_result` | 有 |
| `EFT` | `EFT` | `eft_result` | 有 |
| `IM` | `IM` | `im_result` | 沒有 |
| `TGame` | `TGAME`（DB 全大寫） | `tgame_result` | 沒有 |

### 3.3 資料庫帳號

依最小權限拆分（見 [ADR-0001](adr/0001-least-privilege-db-accounts.md)）：`app_ro`（讀，正式庫）、
`game_writer`（寫 7 張表，正式庫）、`seeder`（全權，只能 `_test`）、`root`（全權，人工維運用）。

### 3.4 怎麼幫一個人設密碼／查帳號

```bash
# 批次：幫還沒帳號的老師指派帳號+密碼（印出一次，冪等，不覆蓋既有的）
uv run python seed_directory.py

# 單一：重設某位老師/學生的密碼（帳號缺的話順便補一個）
uv run python manage_passwords.py teacher <school> <老師姓名> <新密碼>
uv run python manage_passwords.py student <school> <studentKey> <新密碼>
```

帳號本身不會出現在任何 API 回應裡（避免順手洩漏登入憑證的一半），要查只能看 DB
的 `teacher.account` / `student.account` 欄位，或上面兩支腳本的輸出。
