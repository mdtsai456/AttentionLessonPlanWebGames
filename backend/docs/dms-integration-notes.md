# DMS / 前端串接說明（中介平台後端）

回答前端同學的六個問題：① DB Schema ② Student／Teacher／School 關係 ③ Session Table
④ Game／Mode ⑤ Progress 怎麼計算 ⑥ DMS 要透過哪些 FastAPI API 查 MariaDB。

> **最終依據**：正式 API 契約看 [`docs/frontend-integration-guide.md`](frontend-integration-guide.md)，
> 線上互動文件看 `{BASE_URL}/docs`（Swagger UI）。這份是重點整理。
>
> **前端 / DMS 不直接連 MariaDB**，一律走 FastAPI 的 `/api/*`。後端所有 SQL 集中在
> `queries.py` 一個模組、走唯讀連線；沒有登入驗證（廠商定調下拉選人，無帳密 token）。

---

## 0. 環境

| 環境 | Base URL | 狀態 |
|---|---|---|
| 本機後端 | `http://127.0.0.1:5001` | — |
| 正式（Zeabur） | `https://attention-lesson-plan-transfer-data.zeabur.app` | ⚠️ 目前仍是**舊版 code + 舊 DB**，新版尚未部署 |

- 存活檢查：`GET {BASE_URL}/health` → `{"status":"ok"}`
- API 文件：`{BASE_URL}/docs`
- 一律 UTF-8 JSON。沒有 cookie／session，`fetch` **不要**帶 `credentials: 'include'`。
- 時間字串格式一律 `"YYYY-MM-DD HH:MM:SS"`（空格分隔、到秒、**無時區**）。
- 未結束的場次：`endTime` 是**空字串 `""`**（不是 `null`）。
- 集合端點查無資料 → `200` + 空陣列（**不是 404**）。
- DB 掛掉 → `500 {"detail":"資料庫查詢失敗"}`（訊息不含細節）。
- **目前所有端點都沒有分頁。**

---

## ① DB Schema

MariaDB，**9 張表**。完整 DDL：[`tests/schema.sql`](../tests/schema.sql)；ER 圖：[`docs/database-schema.md`](database-schema.md)。

| 分類 | 表 | 重點欄位 |
|---|---|---|
| 參照資料 | `school` | `school`（代碼）、`display_name`、`sort_order` |
| 參照資料 | `teacher` | `teacher_id`、`name`、`school` |
| 名冊 | `student` | `grade` + `case_id` + `school`（三欄複合主鍵） |
| 場次索引 | `assessment_result` | 見 ③ |
| 遊戲細部成績 | `dccs_result` / `dat_result` / `eft_result` / `im_result` / `tgame_result` | 主鍵 `(grade, case_id, school, uuid)` |

---

## ② Student / Teacher / School 關係

大到小 `school → teacher → student`。資料庫外鍵：

```
school ──(fk_teacher_school)──▶ teacher
school ──(fk_student_school)──▶ student ──(fk_assessment_student)──▶ assessment_result ──▶ 5 張 *_result
```

- **一個場域有多位老師**（目前每場域 2 位）。
- **一個場域有多位學生**。學生唯一鍵是 `(grade, case_id, school)` 三欄 ——
  **不同場域的 `G1_S03` 是不同的人**。
- **老師 ↔ 學生沒有直接關聯鍵，也不需要**。「某老師的學生」＝「該老師所屬場域的
  **全部**學生」，用兩邊都有的 `school` 字串 join 出來。
  **同場域的 2 位老師看到同一批學生。**
- `school` 這個字串是整個系統的 join key。定案為短代碼（見
  [`docs/school-directory.md`](school-directory.md)）：

  | `school` | `displayName`（可微調） |
  |---|---|
  | `KMU` | 高雄醫學大學 |
  | `NTHU-01` … `NTHU-07` | 清華大學（第一場…第七場） |

  **前端不要寫死任何場域字串。** 一律 `GET /api/schools` 拿清單、顯示 `displayName`、
  把 `school` 原樣存起來、後續 API 原樣帶回。

---

## ③ Session Table（`assessment_result`）

一場遊戲 = 一列。

| 欄位 | API 對應 | 說明 |
|---|---|---|
| `uuid` | `sessionId` | 場次 ID（UUID） |
| `grade` / `case_id` / `school` | — | 屬於哪個學生 |
| `game_type` | `gameType` | `DAT` / `DCCS` / `EFT` / `IM` / `TGAME`（API 回 `TGame`） |
| `mode` | `mode` | `single` / `double` |
| `pair_id` | **不外露** | 雙人局搭檔連結，前端／DMS 用不到 |
| `current_day` | `currentDay` | 第幾個施測日（Unity 帶上來的，不是後端算的） |
| `start_time` / `end_time` | `startTime` / `endTime` | `end_time` NULL = 未完成，API 回 `""` |

分數細節在 5 張 `*_result` 表（每場對應一列，`game_type` 決定掛哪張）。
**目前 API 只吐 5 個共同欄位**：`correctCount`、`wrongCount`、`accuracy`、`duration`、`stage`。
各遊戲專屬欄位（`frameWrongCount`、`DAT_avgReactionTime`…）DB 裡有，**沒有端點回傳** ——
DMS 若要，需請後端加。

---

## ④ Game / Mode

- **5 款遊戲**：`DAT`、`DCCS`、`EFT`、`IM`、`TGame`
  （DB 存 `TGAME`，API 一律回 `TGame`；查詢參數大小寫不拘）。
- **mode**：`single` / `double`
  - 只有 **DAT / DCCS / EFT** 有雙人版；**IM / TGame 永遠 `single`**。
  - 雙人版 = 一台裝置兩個小孩，各記自己一筆，共用一個 `pair_id`。
  - **雙人版成績欄位與單人版完全一樣**，沒有合作／對戰新指標。
- 對前端影響：凡是「一款遊戲」的地方都要多帶一個 `mode`；`/report` 的
  `summaryByGame` / `trends` 依 `(gameType, mode)` 分組，同款遊戲最多拆成
  single + double 兩份。**單雙人請畫成兩條線**（難度不同，混一條會誤導）。
- `?mode=` 或 `?game_type=` 傳非法值 → **不報錯**，回空結果。

---

## ⑤ Progress 怎麼計算

**後端沒有「進度 %」或「完成度」這種單一數字。** 「進度」＝
`GET /api/students/{studentKey}/report` 回的三塊資料，前端自己畫：

### a. `records[]` — 每一場明細（依 `startTime` 新 → 舊）

| 欄位 | 說明 |
|---|---|
| `stats.accuracy` | **0–1 小數**（0.85 = 85%），要百分比自己 ×100 |
| `stats.duration` | **毫秒** |
| `stats.stage` | 本場實際作答題數／關卡數 |
| `stats` | 可能是 `null`（場次剛開始就中斷、沒有成績列） |

### b. `summaryByGame[]` — 依 `(gameType, mode)` 彙總

| 欄位 | 算法 |
|---|---|
| `sessionCount` | 該組場次數（**含 `stats` 為 null 的**） |
| `totalCorrect` / `totalWrong` | 該組**有成績**場次的加總 |
| `avgAccuracy` | 該組有成績場次 accuracy 的平均（0–1，四捨五入到小數第 2 位） |
| `totalDuration` | 毫秒加總 |

排序：先 `gameType`（字母序），再 `mode`（**`single` 一定在 `double` 前**）。
某組全部場次 `stats` 皆 null → 回一列 `sessionCount` 保留、其餘為 0。

### c. `trends[]` — 折線圖用時間序列

- 依 `(gameType, mode)` 分組；`stats` 為 null 的場次略過。
- 每組固定 3 條序列：`correctCount`、`wrongCount`、`accuracy`。
- 每條 `stats` 是 `{time, value}` 陣列，**由舊到新**，直接 X=time / Y=value。

### 其他

- 學生清單的 `sessionCount` = 該學生所有場次數（所有模式、含未完成）；
  `lastPlayedAt` = 最後一場的 `start_time`（零場次為 `null`）。
- `currentDay` 是施測日序號，Unity 帶的，不是後端算的。

---

## ⑥ DMS 要透過哪些 FastAPI API 查 MariaDB

**實際端點都有 `/api` 前綴。** 把前端同學設想的路徑對照如下：

| 設想的路徑 | ✅ 實際端點 | 備註 |
|---|---|---|
| `GET /schools` | `GET /api/schools` | 場域清單，已依 `sort_order` 排好 |
| `GET /teachers` | `GET /api/schools/{school}/teachers` | **沒有「全部老師」端點** —— 老師一定隸屬某場域 |
| `GET /students` | `GET /api/students?school={school}` | `school` 選填（不給回所有場域） |
| （老師視角學生清單） | `GET /api/teachers/{teacherId}/students` | 回該老師場域的全部學生（含零場次）；未知 id → **404** |
| `GET /students/{caseId}/progress` | `GET /api/students/{studentKey}/report?school={school}` | ⚠️ key 是 **`grade_caseId`**（例 `G1_S03`）不是單純 caseId；**一定要帶 `school`**；端點名是 `report` |
| （場次時間軸，輕量） | `GET /api/students/{studentKey}/sessions?school={school}` | 只有時間、沒分數；可選 `?game_type=` `?mode=` |
| `GET /sessions` | ❌ **沒有**「全站所有場次」端點 | 場次一定掛在某學生底下查 |
| `GET /sessions/{sessionId}` | ❌ **沒有**「用 sessionId 查單場」端點 | 單場資料在 `/report` 的 `records[]` 裡（含每場 `stats`） |
| （Unity 寫入，DMS 不呼叫） | `POST /api/sessions` | — |

### 端點細節

#### `GET /api/schools`
```json
{ "schools": [ { "school": "KMU", "displayName": "高雄醫學大學" } ] }
```
沒有場域時 `schools: []`（仍 200）。

#### `GET /api/schools/{school}/teachers`
`{school}` 是路徑參數（代碼是純 ASCII，不用 encode）。
```json
{ "school": "KMU", "teachers": [ { "teacherId": 1, "name": "吳老師" } ] }
```
未知場域 → `200` + `teachers: []`。

#### `GET /api/teachers/{teacherId}/students`
```json
{
  "teacherId": 1, "teacherName": "吳老師", "school": "KMU",
  "studentCount": 2,
  "students": [
    { "studentKey": "G1_S01", "grade": "G1", "caseId": "S01", "school": "KMU",
      "sessionCount": 12, "lastPlayedAt": "2026-09-05 14:30:00" },
    { "studentKey": "G1_S02", "grade": "G1", "caseId": "S02", "school": "KMU",
      "sessionCount": 0, "lastPlayedAt": null }
  ]
}
```
- **零場次的學生也會列出**（這是名冊，不是「玩過的人」）。
- 排序：`school, grade, caseId`。
- **未知 `teacherId` → `404` `{"detail":"查無此老師"}`**。

#### `GET /api/students?school={school}`
`students[]` 形狀同上。`school` 不給 → 回所有場域的學生。未知場域 → `200` + 空陣列。
名冊**沒有「學生姓名」欄位**，只有 `studentKey`（`G1_S01` 這種）。

#### `GET /api/students/{studentKey}/sessions?school={school}`
輕量版場次清單（只有時間，沒有成績數字）。`studentKey` = `grade_caseId`。
可選 `?game_type=`（`DAT`/`DCCS`/`EFT`/`IM`/`TGame`，大小寫不拘）、`?mode=`（`single`/`double`）。
```json
{
  "studentKey": "G1_S01", "grade": "G1", "caseId": "S01", "school": "KMU",
  "sessions": [
    { "sessionId": "6f1c…", "gameType": "DAT", "mode": "single",
      "currentDay": 5, "startTime": "2026-09-05 12:00:00", "endTime": "2026-09-05 12:06:00" }
  ]
}
```
`sessions` 依 `startTime` 新 → 舊。未知學生 → `200` + `sessions: []`。

#### `GET /api/students/{studentKey}/report?school={school}` ★ 主要端點
`studentKey` = `grade_caseId`（**格式錯 → `400`**）。`school` 必填。
可選 `?game_type=`、`?mode=`（不給則單雙人都回）。
回 `records[]` + `summaryByGame[]` + `trends[]`，三塊的算法見 ⑤。完整範例見
[`frontend-integration-guide.md` §2.6](frontend-integration-guide.md)。

### 錯誤處理

| 狀況 | HTTP | body |
|---|---|---|
| `studentKey` 格式錯 | `400` | `{"detail":"studentKey 格式應為 G1_S03（grade_caseId）"}` |
| 未知 `teacherId` | `404` | `{"detail":"查無此老師"}` |
| 未知場域／學生／篩選後為空 | `200` | 空陣列 / 空 `records`（**不是錯誤**，顯示空狀態） |
| 少必填 query（如漏 `school`） | `422` | FastAPI 驗證錯誤結構 |
| DB 掛掉 | `500` | `{"detail":"資料庫查詢失敗"}` |

---

## DMS 可能需要、但目前沒有的（要的話提需求給後端）

1. `GET /api/sessions/{sessionId}` —— 用 ID 直查單場。
2. 各遊戲**專屬欄位**的輸出（目前只吐 5 個共同欄位）。
3. 整場域 / 全站的**資料匯出**（CSV / 大量 dump）、以及分頁。
