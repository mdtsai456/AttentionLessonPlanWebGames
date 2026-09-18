# 單人版／雙人版（single / double）遊戲模式設計

日期：2026-09-08 · 狀態：accepted（廠商已定調五項，見下）

## 問題

廠商要為 **DAT、DCCS、EFT 三款遊戲**各做「單人版」與「雙人版」。DCCS/EFT/DAT 的
雙人版是**同一台裝置、兩個小孩一起玩**。系統目前完全沒有「模式」的概念：
`assessment_result` 一列就是一位學生的一場遊戲，沒有欄位能區分這場是單人還是雙人。

同時，報告頁（`GET /api/students/{studentKey}/report`）要能在**同一頁**呈現單人版
與雙人版的紀錄，但兩者要**分得出來**（不能把兩種模式的成績混在同一條趨勢線上，
因為難度不同、混畫會誤導）。

## 廠商定調（2026-09-08，五項皆已確認，不再更動）

| # | 問題 | 答案 |
|---|---|---|
| 1 | 雙人版是否每位學生各記一筆自己的成績？ | **是，每人各一筆**（正確率、反應時間等都各自記） |
| 2 | 需不需要把同一場的兩筆綁在一起（知道搭檔是誰）？ | **要綁**。雙人版是一台裝置兩個小孩，Unity 產生一個代碼即可，不複雜 |
| 3 | Unity 雙人版怎麼送資料？ | **每位學生各送一個 POST**（沿用現有 payload 格式） |
| 4 | 雙人版成績欄位跟單人版一樣嗎？有沒有合作／對戰類指標？ | **完全一樣**，沒有新指標 |
| 5 | 報告頁單雙人如何呈現？ | **同一頁、但要區分**。採本文件建議：凡標示遊戲之處都加 `mode`，分組改為 `(遊戲, 模式)` |

## 範圍

**在範圍內：**

- `assessment_result` 新增 `mode`、`pair_id` 兩欄（`ALTER TABLE`；`tests/schema.sql`
  同步）。
- `POST /api/sessions` payload 新增 `mode`（選填，預設 `single`）與 `pairId`（選填）。
- `GET /api/students/{studentKey}/report` 與 `.../sessions`：回應每筆帶 `mode`；
  `report` 的 `summaryByGame`、`trends` 分組改為 `(gameType, mode)`；兩端點新增
  選填的 `?mode=` 篩選參數。
- `queries.py`、`writes.py`、`models.py`、`routers/sessions.py`、`routers/students.py`
  `converters.py` 對應調整。
- `seed.py` 產生部分雙人版假資料，讓報告頁兩種模式都有東西可畫。
- 測試與文件更新。

**不在範圍內：**

- 五張遊戲結果表（`dat_result` 等）的任何結構變更 —— 廠商 Q4 明確「欄位一樣」。
- 合作／對戰類新指標。
- IM、TGame 的雙人版（廠商只要 DAT/DCCS/EFT 三款）。
- 「用 `pair_id` 反查搭檔的成績」這類跨學生查詢（欄位先存著，查詢日後要用再加）。
- 場域／老師／登入功能（見
  [`2026-09-08-teacher-directory-login-design.md`](2026-09-08-teacher-directory-login-design.md)）。
- 改用 `uv`（見該文件附錄 A）。

## 名詞

- **mode（模式）** — 一場遊戲是 `single`（單人版）或 `double`（雙人版）。存在
  `assessment_result.mode`。既有所有資料視為 `single`。
- **pair（雙人局）** — 一台裝置上兩個小孩一起玩的一場雙人遊戲。產生**兩筆**
  `assessment_result`（各一位學生），兩筆共用同一個 `pair_id`。
- **`pair_id`** — 一個雙人局的識別碼（UUID 字串）。由 Unity 在開局時產生一次，
  兩位學生的 POST 都帶同一個。`single` 模式時為 `NULL`。

## 既有資料模型

```sql
assessment_result(
  grade, case_id, school, uuid,      -- PK
  start_time, game_type, current_day, end_time
)
-- FK: (grade, case_id, school) → student
-- 被五張遊戲結果表以 (grade, case_id, school, uuid) 外鍵參照
```

`game_type` 取值：`DCCS` / `DAT` / `EFT` / `IM` / `TGAME`（注意 DB 存 `TGAME`，
Unity 送 `TGame`，由 `converters.normalize_game_type_*` 轉換）。

## 資料模型變更

```sql
ALTER TABLE assessment_result
  ADD COLUMN mode    ENUM('single','double') NOT NULL DEFAULT 'single'
    AFTER game_type,
  ADD COLUMN pair_id varchar(36) DEFAULT NULL
    AFTER mode;
```

`tests/schema.sql` 的 `assessment_result` `CREATE TABLE` 同步加入這兩欄（給全新
`_test` 庫用）：

```sql
CREATE TABLE IF NOT EXISTS `assessment_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `start_time` datetime NOT NULL,
  `game_type` varchar(20) NOT NULL,
  `mode` enum('single','double') NOT NULL DEFAULT 'single',
  `pair_id` varchar(36) DEFAULT NULL,
  `current_day` int(11) NOT NULL,
  `end_time` datetime DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_assessment_student` FOREIGN KEY (`grade`, `case_id`, `school`)
    REFERENCES `student` (`grade`, `case_id`, `school`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 結構決定與理由

**用 `mode` 欄位區分，不在 `game_type` 加後綴。**
不做 `DAT_SINGLE` / `DAT_DOUBLE` 這種值。理由：(1) `queries.GAME_RESULT_TABLES`、
`routers/sessions.KNOWN_GAME_NAMES`、五張結果表、`converters` 的對照全都以純遊戲
代號為鍵，加後綴會逼這些全部跟著改。(2) 雙人版玩的還是「同一款 DAT」，結果也
寫進「同一張 `dat_result`」（Q4：欄位一樣），模式是遊戲的一個屬性，不是新遊戲。
`mode` 欄位是最小侵入的表達方式。

**`mode` 為 `NOT NULL DEFAULT 'single'`，既有資料不用回填。**
`ALTER TABLE` 執行時，現有每一列自動取得 `'single'`。這正確描述現況 —— 在雙人版
出現以前，所有場次都是單人。無需 `UPDATE`。

**`mode` 用 `ENUM`，不用 `varchar`。**
只有兩個合法值，且不會擴充（Q4 排除了其他模式）。`ENUM` 讓資料庫自己擋掉打錯的
值，也讓欄位語意在 schema 上一目了然。

**`pair_id` 為可空 `varchar(36)`，由 Unity 產生、後端只存不生。**
廠商 Q2 定調要綁，且雙人版是**一台裝置**，Unity 開局時 `Guid.NewGuid()` 產一個、
兩位學生的 payload 都帶著，沒有跨裝置握手問題 —— 對 Unity 是一行程式。後端完全
被動：收到就存，`single` 時是 `NULL`。不由後端產生的理由：後端一次只處理一個
POST（一位學生），沒有「這場雙人局」的概念，無從得知兩個 POST 屬於同一局。

**`pair_id` 不設外鍵、不自我參照、暫不建索引。**
它只是一個把兩筆標記為同一局的標籤。目前沒有任何查詢用它 join（報告頁是
「單一學生」視角）。日後若要做「雙人局搭檔對照」，再加
`INDEX (pair_id)`。現在加只是空成本。

**五張遊戲結果表完全不動。**
Q4 明確欄位一樣。雙人版的 `dat_result` 一列跟單人版長得一模一樣，差別只在它掛的
`assessment_result` 那列 `mode = 'double'`。

## `POST /api/sessions` 契約變更

### Payload

`data` 物件新增兩個**選填**欄位：

```json
{
  "lessonId": "1140908_DAT",
  "data": {
    "grade": "G1",
    "caseId": "S03",
    "school": "KMU",
    "currentDay": 5,
    "startTime": 1725000000000,
    "endTime":   1725000360000,
    "mode": "double",
    "pairId": "6f1c8e2a-3b7d-4e11-9a52-0c9d7f2b1e44",
    "stats": [ { "apiname": "DAT_correct", "value": 18 }, ... ]
  }
}
```

- `mode`：`"single"` | `"double"`。**未提供時預設 `"single"`** —— 現有 Unity
  （只有單人版）不改任何東西就能繼續運作。
- `pairId`：字串，`mode = "double"` 時應提供，`single` 時應省略或為 `null`。

### 驗證規則（`routers/sessions.py`）

| 情況 | 行為 |
|---|---|
| `mode` 缺 | 視為 `"single"` |
| `mode` 非 `single`/`double`（大小寫不拘，會 `.strip().lower()`） | `400`，`{"detail": "mode 必須是 single 或 double"}` |
| `mode = "double"` 但 `game_type` 不是 DAT/DCCS/EFT | `400`，`{"detail": "雙人版僅支援 DAT／DCCS／EFT"}`（防呆，廠商只做這三款） |
| `mode = "double"` 但缺 `pairId` | **接受**，`pair_id` 存 `NULL`，並 `logger.warning` 記一筆。理由：資料完整性不該擋在受試者資料的路上；缺 `pairId` 的雙人筆仍是有效成績，只是少了搭檔連結 |
| `mode = "single"` 但有 `pairId` | 忽略 `pairId`，存 `NULL` |
| `pairId` 提供但長度 > 36 | `400`，`{"detail": "pairId 格式錯誤"}` |

### 兩個 POST 各自獨立、各自原子

雙人局的兩位學生 = 兩個獨立的 `POST /api/sessions`。每個 POST 的寫入交易
（`writes.insert_session_with_stats`：`INSERT IGNORE student` → `INSERT
assessment_result` → `INSERT <game>_result`，全包在一個 transaction）**完全不變**。

一個 POST 失敗不影響另一個。若雙人局只有一筆寫成功，資料庫就是一筆
`mode='double'` 且 `pair_id` 有值、但找不到同 `pair_id` 另一筆的狀態 —— 這可接受
（Unity 可重送失敗那筆），且不需要任何跨 POST 的協調邏輯。**這是選擇「兩次獨立
POST」而非「一次包兩人」的主因**：後者要一個同時寫兩位學生、全有全無的交易，
以及部分失敗語意，複雜度高得多。

### `writes.py` 變更

`insert_session_with_stats` 簽章新增兩個參數：

```python
def insert_session_with_stats(
    grade: str,
    case_id: str,
    school: str,
    start_time: datetime,
    game_type: str,
    current_day: int,
    end_time: datetime | None,
    stats: dict[str, Any],
    mode: str = "single",              # 新增
    pair_id: str | None = None,        # 新增
) -> str:
```

`assessment_sql` 的欄位清單與 `VALUES` 佔位符各加 `mode`、`pair_id`；
`assessment_params` 對應加入 `mode`、`pair_id`。其餘不動。

### `routers/sessions.py` 變更

- `UnityGamePayload` 加：
  ```python
  mode: str = "single"
  pairId: str | None = None

  @field_validator("mode")
  @classmethod
  def normalize_mode(cls, value: str) -> str:
      normalized = (value or "single").strip().lower()
      if normalized not in {"single", "double"}:
          raise ValueError("mode 必須是 single 或 double")
      return normalized
  ```
- `persist_unity_session`：`game_name not in {"DAT","DCCS","EFT"}` 且
  `data.mode == "double"` → `raise ValueError("雙人版僅支援 DAT／DCCS／EFT")`。
- 呼叫 `writes.insert_session_with_stats(..., mode=data.mode, pair_id=data.pairId)`。
- `pairId` 存在但長度 > 36 → `ValueError`（走既有的 `except ValueError → 400`）。

## `GET /api/students/{studentKey}/report` 契約變更

### 回應

`records[]`、`summaryByGame[]`、`trends[]` 都加上 `mode`，且後兩者的**分組鍵由
`gameType` 改為 `(gameType, mode)`**。

```json
{
  "studentKey": "G1_S03",
  "grade": "G1", "caseId": "S03", "school": "KMU",
  "totalSessions": 4,
  "records": [
    {
      "sessionId": "…", "gameType": "DAT", "mode": "single",
      "currentDay": 5, "startTime": "2026-09-05 12:00:00", "endTime": "2026-09-05 12:06:00",
      "stats": { "correctCount": 18, "wrongCount": 3, "accuracy": 85, "duration": 175635, "stage": 8 }
    },
    {
      "sessionId": "…", "gameType": "DAT", "mode": "double",
      "currentDay": 7, "startTime": "2026-09-08 12:00:00", "endTime": "2026-09-08 12:06:00",
      "stats": { "correctCount": 20, "wrongCount": 2, "accuracy": 90, "duration": 176000, "stage": 9 }
    }
  ],
  "summaryByGame": [
    { "gameType": "DAT", "mode": "single", "sessionCount": 1, "totalCorrect": 18, "totalWrong": 3, "avgAccuracy": 85, "totalDuration": 175635 },
    { "gameType": "DAT", "mode": "double", "sessionCount": 1, "totalCorrect": 20, "totalWrong": 2, "avgAccuracy": 90, "totalDuration": 176000 }
  ],
  "trends": [
    { "gameType": "DAT", "mode": "single", "items": [ { "type": "correctCount", "stats": [ … ] }, … ] },
    { "gameType": "DAT", "mode": "double", "items": [ … ] }
  ]
}
```

### 欄位與排序

| 欄位 | 說明 |
|---|---|
| `records[].mode` | `"single"` \| `"double"`。取自 `assessment_result.mode` |
| `summaryByGame[].mode` | 該彙總列的模式。`(gameType, mode)` 為分組鍵 |
| `trends[].mode` | 該趨勢群的模式 |

- `summaryByGame` 排序：先 `gameType`、再 `mode`（`single` 在 `double` 前）。
- `trends` 排序：同上。
- 一位學生若某遊戲只有單人版紀錄，就只會有一列 `mode: "single"`，不會硬生出空的
  `double` 列。TGame、IM 永遠只有 `single`。

### 契約決定與理由

**`mode` 加在既有結構上，不改回應的頂層形狀。**
`records` / `summaryByGame` / `trends` 三個陣列還在，只是每個元素多一個 `mode` 欄，
且 `summaryByGame`／`trends` 的元素數量可能變多（同一遊戲最多拆成 single + double
兩列）。前端把 `(gameType, mode)` 當成一個顯示單位即可 —— 例如卡片標題「DAT（雙人）」。

**趨勢（trends）必須按 `mode` 分開。**
`中介平台資料JennyLin.pdf` 第 4 頁的「平均正確率趨勢圖」是要看「個案正確率是否進步」。
單人版和雙人版難度不同，畫在同一條線上會讓「進步」變成雜訊。分成兩條線各自看
才有意義。

**不新增 `modeSummary`（跨遊戲的模式彙總）這種東西。**
需要的話前端用 `summaryByGame` 自己加總即可。後端多一個結構就多一個要測、要維護的
契約面。

**`?mode=` 為選填篩選，不提供時回全部。**
與既有 `?game_type=` 同樣的角色與語意。

## `GET /api/students/{studentKey}/sessions` 契約變更

- `sessions[]` 每筆加 `mode`。
- 新增選填 `?mode=single|double` 篩選參數。
- 其餘不變。

## `?mode=` 篩選參數（report 與 sessions 共用）

- 路徑：query string，例：`/report?school=KMU&mode=double`、
  `/report?school=KMU&game_type=DAT&mode=double`（可與 `game_type` 併用）。
- 正規化（新增 `converters.normalize_mode_for_db`，鏡像 `normalize_game_type_for_db`）：

```python
def normalize_mode_for_db(mode: str | None) -> str | None:
    if not mode or not mode.strip():
        return None
    return mode.strip().lower()
```

- 傳入 `None` → 不加 `mode` 條件。
- 傳入 `"single"` / `"double"` → SQL 加 `AND mode = %s`。
- 傳入其他值（如 `"foo"`）→ 加 `AND mode = 'foo'`，自然查不到任何列，回空結果，
  **不報錯**。與 `?game_type=亂打` 的既有行為一致。

## 查詢變更（`queries.py`）

### `fetch_assessment_rows`

```python
def fetch_assessment_rows(
    grade: str,
    case_id: str,
    school: str,
    game_type: str | None = None,
    mode: str | None = None,          # 新增
) -> list[dict[str, Any]]:
    sql = """
        SELECT uuid, game_type, mode, pair_id, current_day, start_time, end_time
        FROM assessment_result
        WHERE grade = %s AND case_id = %s AND school = %s
    """
    params: list[Any] = [grade, case_id, school]

    if game_type is not None:
        sql += " AND game_type = %s"
        params.append(game_type)

    if mode is not None:                # 新增
        sql += " AND mode = %s"
        params.append(mode)

    sql += " ORDER BY start_time DESC"
    ...
```

`SELECT` 多取 `mode`、`pair_id`（`pair_id` 目前組裝時可先不外露，但取出來成本為零，
留著給日後）。

`fetch_game_stats_by_uuids` / `fetch_stats_for_rows` / `fetch_students` **不變** ——
`mode` 是 `assessment_result` 的欄位，遊戲結果表與學生名冊不受影響。

## 組裝變更（`routers/students.py`，皆為純函式）

### `session_fields_from_row`

```python
return {
    "sessionId": row["uuid"],
    "gameType": normalize_game_type_from_db(row["game_type"]),
    "mode": row["mode"],                       # 新增
    "currentDay": to_int(row["current_day"]),
    "startTime": format_datetime(row["start_time"]),
    "endTime": format_datetime(row["end_time"]),
}
```

### `build_summary_by_game`

分組鍵 `record.gameType` → `(record.gameType, record.mode)`；產生的每個
`GameSummary` 帶 `mode`；排序 `key=lambda s: (s.gameType, s.mode)`。

### `build_trends`

分組鍵 `record.gameType` → `(record.gameType, record.mode)`；`sorted(grouped)` 對
tuple 排序天然正確；每個 `GameTrend` 帶 `mode`。

### 兩個路由函式

`list_student_sessions`、`get_student_report` 各多讀一個 `mode` query 參數，經
`normalize_mode_for_db` 後傳給 `queries.fetch_assessment_rows`。

## 模型變更（`models.py`）

```python
class SessionItem(BaseModel):
    sessionId: str
    gameType: str
    mode: str                    # 新增："single" | "double"
    currentDay: int
    startTime: str
    endTime: str

# PlayRecord(SessionItem) 自動繼承 mode

class GameSummary(BaseModel):
    gameType: str
    mode: str                    # 新增
    sessionCount: int
    totalCorrect: int
    totalWrong: int
    avgAccuracy: float
    totalDuration: float

class GameTrend(BaseModel):
    gameType: str
    mode: str                    # 新增
    items: list[TrendItem] = Field(default_factory=list)
```

`SessionsResponse`、`StudentReportResponse` 的頂層形狀不變。

## `converters.py` 變更

新增 `normalize_mode_for_db`（見上）。既有函式不動。

## `seed.py` 變更

目前 `seed.py` 灌的每一場都是單人。為了讓報告頁「單／雙人並陳」的畫面有資料可看：

- `GAMES` 迴圈維持不變（5 款各一場）。
- **額外**：在部分施測日，為 DAT/DCCS/EFT 各多灌一場 `mode='double'` 的紀錄，
  同一施測日同一遊戲的雙人場，`pair_id` = `uuid5(NAMESPACE_DNS,
  f"{school}|{grade}|{case_id}|{game}|{current_day}|double")`（確定性、可重現）。
  數量不用多 —— 每位學生每款遊戲在每個 Round 各 2～3 場雙人即可。
- `assessment_result` 的 `executemany` 欄位清單加 `mode`、`pair_id`。
- 產生的雙人場 accuracy 略高於同學生同遊戲的單人場（雙人版通常較簡單），讓
  「單人 vs 雙人」在圖上看得出差異。

`schema.sql` 已含新欄位，`seed.py` 建表段落自動涵蓋。

## DB 帳號與權限

- `game_writer`（正式庫）：已有 `assessment_result` 的 `INSERT`。加了欄位不需要
  重新授權（`INSERT` 是表級權限）。
- `app_ro`：已有 `SELECT`，涵蓋新欄位。
- 正式庫 `ALTER TABLE assessment_result ...` 由 **root** 執行（對齊
  [ADR-0001](../adr/0001-least-privilege-db-accounts.md) 的「正式庫結構變更走 root」）。

## 測試

沿用既有測試基礎建設。`tests/conftest.py` 的 `DbHelper.insert_session` 加
`mode="single"`、`pair_id=None` 兩個預設參數（現有測試呼叫不用改）。

### 不碰資料庫

- `normalize_mode_for_db`：`None` / `""` / `"  "` → `None`；`"Single"` → `"single"`；
  `"DOUBLE"` → `"double"`；`"foo"` → `"foo"`。
- `build_summary_by_game`：同一 `gameType` 的 single 與 double 記錄 → 產生**兩列**
  `GameSummary`，各自加總正確；排序 single 在前。
- `build_trends`：同上，同 `gameType` 拆成兩個 `GameTrend`。
- `UnityGamePayload` 驗證：`mode` 缺 → `"single"`；`mode="Double"` → `"double"`；
  `mode="x"` → `ValidationError`。

### 碰測試資料庫

| 測試 | 驗證 |
|---|---|
| POST `mode="double"` + `pairId` 的 DAT 場 | `assessment_result` 該列 `mode='double'`、`pair_id` 正確存入 |
| POST 不帶 `mode` | 存成 `mode='single'`、`pair_id` 為 `NULL` |
| POST `mode="double"` 的 TGame 場 | `400`，訊息含「雙人版僅支援」 |
| POST `mode="double"` 但不帶 `pairId` | `201`（接受），`pair_id` 為 `NULL` |
| 一位學生有 DAT 單人 3 場、DAT 雙人 2 場 | `/report` 的 `summaryByGame` 有兩列（DAT/single sessionCount=3、DAT/double sessionCount=2）；`records` 每筆帶正確 `mode` |
| 同上 | `/report` 的 `trends` 有兩個 DAT 群，各自的點只含該模式的場次 |
| `/report?mode=double` | 只回雙人場；`summaryByGame` 只剩 double 列 |
| `/report?game_type=DAT&mode=single` | 兩個條件同時生效 |
| `/sessions?mode=double` | `sessions[]` 只含雙人場，每筆 `mode='double'` |
| 既有測試（不帶 mode 的 POST 與查詢） | 全數維持綠燈（`mode` 預設 single 保證向後相容） |

### 特性測試回歸

`tests/test_api.py` 既有的 `test_report_includes_stats_and_summary` 等，回應會多出
`mode` 欄位 —— 這些斷言要更新為包含 `"mode": "single"`。這是**預期中的契約變更**，
更新斷言即可，但要逐一確認沒有其他非預期差異。

## 實作順序

1. **schema**：`tests/schema.sql` 的 `assessment_result` 加 `mode`、`pair_id`；
   `tests/conftest.py` 的 `DbHelper.insert_session` 加預設參數。跑既有測試 →
   應仍全綠（新欄位有預設值）。
2. **models**：`SessionItem`、`GameSummary`、`GameTrend` 加 `mode`。
3. **converters**：`normalize_mode_for_db` + 其純函式測試。
4. **queries**：`fetch_assessment_rows` 加 `mode` 篩選、`SELECT` 加 `mode`/`pair_id`。
5. **routers/students.py**：`session_fields_from_row`、`build_summary_by_game`、
   `build_trends` 三處分組加 `mode`；兩個路由讀 `?mode=`。更新 `test_api.py` 既有
   斷言 + 新增 mode 相關測試。
6. **writes.py + routers/sessions.py**：POST 端支援 `mode`、`pairId`；驗證規則；
   新增 POST 相關測試。
7. **seed.py**：灌雙人版假資料。手動跑一次 `python seed.py` 到 `_test`，用瀏覽器
   開 `/docs` 或直接打 `/report` 肉眼確認單雙人並陳。
8. **文件**：`README.md` 端點表與說明、`CONTEXT.md` 名詞表加「mode／pair」。
9. **（維運，人工）**：正式庫 `ALTER TABLE assessment_result ...`（root 執行）。
   在雙人版 Unity build 上線前完成即可。

每個步驟結束時 commit。

## 已知債務／後續

- **`pair_id` 目前只存不查。** 「看這位學生某雙人局的搭檔表現」需要跨學生查詢與
  一個 `INDEX (pair_id)`，等有需求再做。
- **缺 `pairId` 的雙人筆。** 驗證規則刻意放行（記 warning）。若日後要嚴格要求，
  改成 `mode="double"` 必須有 `pairId`，並先清查歷史資料。
- **IM／TGame 若日後也要雙人版**，`persist_unity_session` 的白名單放寬即可，資料
  模型不用再動。
