# 前端串接指南：選單式登入 + 學生進度檢視

給前端組員（vanilla JS + Canvas）。這份文件是 **API 契約 + 畫面流程**，看這份就能開始
設計介面與寫串接，不需要讀後端程式碼。

- 對應後端設計：
  [`specs/2026-09-08-teacher-directory-login-design.md`](superpowers/specs/2026-09-08-teacher-directory-login-design.md)（登入／場域／老師）、
  [`specs/2026-09-08-single-vs-double-player-mode-design.md`](superpowers/specs/2026-09-08-single-vs-double-player-mode-design.md)（單／雙人模式）
- 狀態：契約**已定案**、後端**已實作**。少數整合測試待 DB 帳密才能跑綠，但**契約不會再變**。

---

## 0. 開始前必讀

### 0.1 Base URL

| 環境 | Base URL |
|---|---|
| 正式（Zeabur） | `https://attention-lesson-plan-transfer-data.zeabur.app` |
| 本機後端 | `http://127.0.0.1:5001` |

存活檢查：`GET {BASE_URL}/health` → `{"status":"ok"}`。
互動式 API 文件（Swagger UI）：`{BASE_URL}/docs`。

**參考用的簡易畫面**：`{BASE_URL}/demo` —— 後端組員做的驗收畫面，把「選場域→選老師／
學生→看報告」的流程用最陽春的方式畫出來，資料是真的。**這不是要你照抄的設計**，
只是讓你看 API 串起來長什麼樣、資料形狀對不對。原始碼在 `demo/index.html`（單一檔案，
vanilla JS，可當串接範例）。

### 0.2 沒有登入驗證

廠商定調：**登入 = 下拉選人，沒有帳號、沒有密碼、沒有 token**。
所有 API 都是公開的，不需要帶 `Authorization` header，不需要 cookie / session。
「登入」對前端而言就是「選完人之後把選到的識別碼記在前端狀態裡」。

> ⚠️ 這代表任何人連到網站都能看任一學生的完整遊玩資料。這是已知的安全債，已向廠商
> 提出，**不是前端要解的問題**，但別在 UI 上做出「已受保護」的錯誤暗示。

### 0.3 CORS（已設定，但你要告訴後端你的網址）

後端**已加上 CORS**。放行哪些來源由後端的環境變數 `CORS_ALLOW_ORIGINS` 決定：

| `CORS_ALLOW_ORIGINS` 的值 | 效果 |
|---|---|
| 留空（預設） | 放行常見的本機前端 dev server：`http://localhost` 與 `http://127.0.0.1` 的 `3000` / `5173` / `5500` / `8080` 埠 |
| `*` | 放行**所有**來源（早期開發最省事，正式環境不要用） |
| `http://localhost:5173,https://foo.example` | 只放行清單裡這幾個（逗號分隔） |

**你要做的事**：

1. **本機開發**：如果你的 dev server 是上表那 4 個常見埠之一（Vite 5173、CRA 3000、
   Live Server 5500…），**開箱即用，什麼都不用做**。用別的埠就把埠號告訴後端。
2. **用 `file://` 直接開 HTML**（沒有 dev server）：CORS 對 `file://` 沒用，請至少用
   `python -m http.server` 或 Live Server 起一個 `http://localhost:...`。
3. **要部署到正式網域**：把你的正式網址（例如 `https://xxx.pages.dev`）給後端，
   請他加進 Zeabur 的 `CORS_ALLOW_ORIGINS` 環境變數。

> API 沒有 cookie／session，所以 `fetch` **不要**帶 `credentials: 'include'`（帶了反而會被
> CORS 擋）。預設的 `fetch(url)` 就對了。

### 0.4 共通規則

| 規則 | 說明 |
|---|---|
| 編碼 | 一律 UTF-8，回應 `Content-Type: application/json` |
| 中文路徑參數 | `school` 出現在網址路徑時（端點 2）要 `encodeURIComponent()` |
| 時間字串 | 格式一律 `"YYYY-MM-DD HH:MM:SS"`（空格分隔、到秒）。**沒有時區**，當本地時間看即可 |
| 未結束的場次 | `endTime` 會是**空字串 `""`**（不是 `null`）。要判斷「未結束」用 `endTime === ""` |
| 零場次的欄位 | `lastPlayedAt` 是 `null`；`stats` 是 `null` |
| 空結果 | 集合端點回 `200` + 空陣列，**不是 404**（見各端點說明） |
| 錯誤 | 見 §5 |

### 0.5 場域字串（`school`）目前是佔位代碼

`school` 這個字串是整個系統的 join key。廠商的 8 個正式場域字串**還沒定案**，後端先用
佔位代碼（`KMU`、`NTHU-01`…`NTHU-07`）。

**前端的正確做法**：永遠從 `GET /api/schools` 拿清單，顯示 `displayName`，把 `school`
原樣存起來、後續 API 原樣帶回去。**絕對不要在前端寫死任何場域字串。**
字串定案後後端重灌資料，前端**完全不用改**。

---

## 1. 兩條使用流程

### 1.1 小朋友端

```
GET /api/schools
    → 顯示 displayName 下拉，選一個場域
GET /api/students?school={school}
    → 顯示學生清單（studentKey），選自己
GET /api/students/{studentKey}/report?school={school}
    → 進度頁：折線圖 / 各遊戲彙總 / 場次明細
```

### 1.2 老師端

```
GET /api/schools
    → 選場域
GET /api/schools/{school}/teachers
    → 顯示老師名字下拉，選自己
GET /api/teachers/{teacherId}/students
    → 老師檢視頁第一畫面：名下所有學生的概況表，點其中一位
GET /api/students/{studentKey}/report?school={school}
    → 該學生的進度頁（與小朋友端同一頁）
```

> 老師與小朋友看到的「進度頁」是**同一個** `/report` 端點、同一份資料。差別只在進入方式。

---

## 2. 端點詳規

### 2.1 `GET /api/schools`

場域清單，第一層下拉。

**Request**：無參數。

**Response 200**
```json
{
  "schools": [
    { "school": "KMU",     "displayName": "高雄醫學大學" },
    { "school": "NTHU-01", "displayName": "清華大學（第一場）" }
  ]
}
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `schools[].school` | string | 場域識別字串。**後續呼叫原樣帶回**，不要顯示給使用者 |
| `schools[].displayName` | string | 下拉顯示文字 |

- 已依後端排序好（`sort_order`），前端**照順序顯示即可**，不要再自己排。
- 沒有任何場域時 `schools` 為 `[]`（仍是 200）。

---

### 2.2 `GET /api/schools/{school}/teachers`

某場域的老師清單，老師端第二層下拉。

**Request**：`{school}` 是**路徑參數**，中文要 encode。

```js
const url = `${BASE}/api/schools/${encodeURIComponent(school)}/teachers`;
```

**Response 200**
```json
{
  "school": "KMU",
  "teachers": [
    { "teacherId": 1, "name": "吳老師" },
    { "teacherId": 2, "name": "林老師" }
  ]
}
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `school` | string | 回顯你傳的路徑參數 |
| `teachers[].teacherId` | int | 老師識別碼，下一步要用 |
| `teachers[].name` | string | 顯示名稱 |

- 已依 `teacherId`（＝建立順序）排序。
- **未知場域回 `200` + `teachers: []`**，不是 404。正常流程下你是從 `/api/schools`
  拿到的場域，不會走到這裡。

---

### 2.3 `GET /api/teachers/{teacherId}/students`

某老師名下的學生清單（＝該老師所屬場域的**全部**學生）。老師檢視頁的第一畫面。

**Request**：`{teacherId}` 是路徑參數（整數）。

**Response 200**
```json
{
  "teacherId": 1,
  "teacherName": "吳老師",
  "school": "KMU",
  "studentCount": 2,
  "students": [
    {
      "studentKey": "G1_S01",
      "grade": "G1",
      "caseId": "S01",
      "school": "KMU",
      "sessionCount": 12,
      "lastPlayedAt": "2026-09-05 14:30:00"
    },
    {
      "studentKey": "G1_S02",
      "grade": "G1",
      "caseId": "S02",
      "school": "KMU",
      "sessionCount": 0,
      "lastPlayedAt": null
    }
  ]
}
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `teacherName` | string | 顯示用 |
| `school` | string | 該老師的場域；點進學生時 `/report` 要帶這個 |
| `studentCount` | int | 等同 `students.length` |
| `students[].studentKey` | string | `grade_caseId`，例 `G1_S01`。查 `/report` 要用 |
| `students[].sessionCount` | int | **所有模式合計**的場次數（含未完成場次），不分單雙人 |
| `students[].lastPlayedAt` | string \| null | 最後遊玩時間；**零場次為 `null`** |

- **零場次的學生也會列出**（`sessionCount: 0`）—— 這是名冊，不是「玩過的人」。
- 排序：`school, grade, caseId`。
- **未知 `teacherId` 回 `404`**：`{"detail": "查無此老師"}`。（與端點 2.2 不同 —— 這裡指名一個特定實體）

---

### 2.4 `GET /api/students?school={school}`

某場域的學生清單。小朋友端第二步。

**Request**

| 參數 | 位置 | 必填 | 說明 |
|---|---|---|---|
| `school` | query | 否 | 不給會回**所有場域**的學生。小朋友端**一定要給** |

**Response 200**
```json
{
  "school": "KMU",
  "studentCount": 2,
  "students": [
    { "studentKey": "G1_S01", "grade": "G1", "caseId": "S01", "school": "KMU", "sessionCount": 12, "lastPlayedAt": "2026-09-05 14:30:00" },
    { "studentKey": "G1_S02", "grade": "G1", "caseId": "S02", "school": "KMU", "sessionCount": 0,  "lastPlayedAt": null }
  ]
}
```

`students[]` 的形狀與 2.3 完全相同。未知場域回 `200` + 空陣列。

> 名冊沒有「學生姓名」欄位，只有 `studentKey`（`G1_S01` 這種）。小朋友端下拉要怎麼讓
> 小孩認得自己，是 UI 設計問題（例如搭配班級 + 座號的說明文字），資料上就這些。

---

### 2.5 `GET /api/students/{studentKey}/sessions?school={school}`

單一學生的**場次清單**（輕量版，只有時間，沒有成績數字）。適合做「歷程時間軸」。

**Request**

| 參數 | 位置 | 必填 | 說明 |
|---|---|---|---|
| `studentKey` | path | ✅ | `grade_caseId`，例 `G1_S01` |
| `school` | query | ✅ | |
| `game_type` | query | 否 | `DAT` / `DCCS` / `EFT` / `IM` / `TGame`（大小寫不拘） |
| `mode` | query | 否 | `single` / `double` |

**Response 200**
```json
{
  "studentKey": "G1_S01",
  "grade": "G1",
  "caseId": "S01",
  "school": "KMU",
  "sessions": [
    { "sessionId": "6f1c…", "gameType": "DAT", "mode": "single", "currentDay": 5, "startTime": "2026-09-05 12:00:00", "endTime": "2026-09-05 12:06:00" },
    { "sessionId": "9a2b…", "gameType": "DAT", "mode": "double", "currentDay": 7, "startTime": "2026-09-08 14:00:00", "endTime": "2026-09-08 14:06:00" }
  ]
}
```

- `sessions` 依 `startTime` **由新到舊**。
- 未知學生回 `200` + `sessions: []`。

---

### 2.6 `GET /api/students/{studentKey}/report?school={school}` ★ 主要端點

單一學生的**完整進度報告**：場次明細 + 各遊戲彙總 + 趨勢序列。進度頁畫面全靠這支。

**Request**

| 參數 | 位置 | 必填 | 說明 |
|---|---|---|---|
| `studentKey` | path | ✅ | `grade_caseId` |
| `school` | query | ✅ | |
| `game_type` | query | 否 | 篩單一遊戲 |
| `mode` | query | 否 | `single` / `double`；不給則兩種都回 |

**Response 200**
```json
{
  "studentKey": "G1_S01",
  "grade": "G1",
  "caseId": "S01",
  "school": "KMU",
  "totalSessions": 4,
  "records": [
    {
      "sessionId": "6f1c…",
      "gameType": "DAT",
      "mode": "single",
      "currentDay": 5,
      "startTime": "2026-09-05 12:00:00",
      "endTime": "2026-09-05 12:06:00",
      "stats": {
        "correctCount": 18,
        "wrongCount": 3,
        "accuracy": 0.85,
        "duration": 175635,
        "stage": 8
      }
    },
    {
      "sessionId": "9a2b…",
      "gameType": "DAT",
      "mode": "double",
      "currentDay": 7,
      "startTime": "2026-09-08 14:00:00",
      "endTime": "2026-09-08 14:06:00",
      "stats": { "correctCount": 20, "wrongCount": 2, "accuracy": 0.90, "duration": 176000, "stage": 9 }
    }
  ],
  "summaryByGame": [
    { "gameType": "DAT", "mode": "single", "sessionCount": 1, "totalCorrect": 18, "totalWrong": 3, "avgAccuracy": 0.85, "totalDuration": 175635 },
    { "gameType": "DAT", "mode": "double", "sessionCount": 1, "totalCorrect": 20, "totalWrong": 2, "avgAccuracy": 0.90, "totalDuration": 176000 }
  ],
  "trends": [
    {
      "gameType": "DAT",
      "mode": "single",
      "items": [
        { "type": "correctCount", "stats": [ { "time": "2026-09-05 12:00:00", "value": 18 } ] },
        { "type": "wrongCount",   "stats": [ { "time": "2026-09-05 12:00:00", "value": 3 } ] },
        { "type": "accuracy",     "stats": [ { "time": "2026-09-05 12:00:00", "value": 0.85 } ] }
      ]
    },
    { "gameType": "DAT", "mode": "double", "items": [ "…同結構…" ] }
  ]
}
```

#### `records[]` — 每一場的明細

| 欄位 | 型別 | 說明 |
|---|---|---|
| `sessionId` | string | 場次 UUID |
| `gameType` | string | `DAT` / `DCCS` / `EFT` / `IM` / `TGame` |
| `mode` | string | `single` / `double` |
| `currentDay` | int | 第幾個施測日（1..24 之類） |
| `startTime` / `endTime` | string | 未結束時 `endTime` 為 `""` |
| `stats` | object \| **null** | 沒有對應成績列時為 `null`（例如場次剛開始就中斷） |
| `stats.accuracy` | float | **0–1 的小數**（0.85 = 85%）。要顯示百分比自己 `×100` |
| `stats.duration` | number | **毫秒** |
| `stats.stage` | int | 本場實際作答題數／關卡數 |

`records` 依 `startTime` 由新到舊。

#### `summaryByGame[]` — 各「遊戲 × 模式」彙總

- **分組鍵是 `(gameType, mode)`**，不是只有 `gameType`。同一款遊戲最多拆成
  `single` + `double` 兩列。
- 排序：先 `gameType`（字母序），再 `mode`（**`single` 一定排在 `double` 前面**）。
- 某遊戲只有單人版紀錄，就只有一列 `mode: "single"`，**不會硬生一列空的 double**。
- `IM`、`TGame` 永遠只有 `single`。
- `avgAccuracy` 是該組所有場次 accuracy 的平均（0–1，四捨五入到小數第 2 位）。
- 前端把 `(gameType, mode)` 當成**一個顯示單位**，例如卡片標題「DAT（雙人）」。

#### `trends[]` — 趨勢折線用的時間序列

- 同樣依 `(gameType, mode)` 分組、同樣排序規則。
- 每個 trend 群固定有 3 個 `items`，`type` 依序為 `correctCount`、`wrongCount`、`accuracy`。
- 每個 `item.stats` 是 `{time, value}` 陣列，**由舊到新**（可直接畫成 X=time、Y=value）。
- `stats` 為 `null` 的場次不會進 trends。
- **單人版與雙人版務必畫成兩條線**（難度不同，混在一條線上會誤導「進步」）。

#### `mode` 篩選

- `/report?school=KMU&mode=double` → 只回雙人版；`summaryByGame` / `trends` 只剩 double。
- 可與 `game_type` 併用：`/report?school=KMU&game_type=DAT&mode=single`。
- 傳非法值（如 `mode=foo`）→ **不報錯**，只是查不到、回空結果（跟 `game_type` 亂打行為一致）。

---

## 3. `mode`（單／雙人版）你需要知道的

- DAT / DCCS / EFT 各有「單人版」與「雙人版」（一台裝置兩個小孩一起玩）。
- 雙人版成績欄位與單人版**完全一樣**，沒有合作／對戰新指標。
- 每位學生記自己一筆，所以在「單一學生」的報告頁裡，一場雙人局也只看到這位學生那筆。
- 對前端的唯一影響：**凡是標示遊戲的地方都多一個 `mode`**，`summaryByGame` / `trends`
  的元素數量可能變多（同一遊戲拆 single/double 兩份）。
- `pair_id`（雙人局搭檔連結）**不會出現在任何回應裡**，前端用不到。

---

## 4. PDF 圖表 ↔ API 欄位對照

（依 `中介平台資料JennyLin.pdf` 第 4–9 頁）

| PDF 圖表 | 資料來源 |
|---|---|
| 平均正確率趨勢圖 | `trends[].items[type=="accuracy"]` |
| 答對／答錯數趨勢 | `trends[].items[type=="correctCount" / "wrongCount"]` |
| 五個遊戲平均表現比較 | `summaryByGame[].avgAccuracy`（按 gameType 聚合） |
| 各遊戲場次數 | `summaryByGame[].sessionCount` |
| 遊玩時長 | `summaryByGame[].totalDuration`（毫秒） |

> 第 4 頁「五個遊戲平均表現比較」圖：加入雙人版後最多會有 **8 條**（5 單人 + 3 雙人）。
> 版面請預留。

---

## 5. 錯誤處理

| 狀況 | HTTP | body | 前端該做的 |
|---|---|---|---|
| 正常 | `200` | 資料 | — |
| 建立場次成功（Unity 用，前端不會呼叫） | `201` | — | — |
| `studentKey` 格式錯（不是 `grade_caseId`） | `400` | `{"detail":"studentKey 格式應為 G1_S03（grade_caseId）"}` | 檢查自己組的字串 |
| 未知 `teacherId` | `404` | `{"detail":"查無此老師"}` | 回老師選擇頁 |
| 未知場域 / 未知學生 / 篩選後為空 | `200` | 空陣列或空 records | 顯示「查無資料」空狀態，**不是錯誤** |
| 後端 DB 掛掉 | `500` | `{"detail":"資料庫查詢失敗"}` | 顯示通用錯誤 + 重試按鈕。**訊息不含細節**，別想從 body 解析原因 |
| 少必填 query（如漏 `school`） | `422` | FastAPI 驗證錯誤結構 | 開發期修好即可 |

所有錯誤 body 都是 `{"detail": "..."}`（422 例外，是 FastAPI 的陣列結構）。

---

## 6. 前端狀態機（建議）

```
選場域    → state.school        (來自 /api/schools 的 school 欄，原樣)
選身分    → "student" | "teacher"
  teacher → state.teacherId     (來自 /api/schools/{school}/teachers)
選學生    → state.studentKey    (來自 /students 或 /teachers/{id}/students)
進度頁    → GET /report?school={state.school}   用 studentKey
```

- `school` 從頭到尾用同一個字串，別重組。
- 重新整理頁面後這些 state 會丟失（沒有 session）。要不要用 `sessionStorage` 記住
  「上次選到哪」是前端自己決定，後端不管。
- 「登出」＝清掉這些 state、回到選場域畫面。

---

## 7. 快速自測（curl）

後端本機跑起來（`uv run uvicorn main:app --port 5001`）+ 灌好參照資料
（`uv run python seed_directory.py`）後：

```bash
BASE=http://127.0.0.1:5001

curl "$BASE/api/schools"
curl "$BASE/api/schools/KMU/teachers"
curl "$BASE/api/teachers/1/students"
curl "$BASE/api/students?school=KMU"
curl "$BASE/api/students/G1_S01/sessions?school=KMU"
curl "$BASE/api/students/G1_S01/report?school=KMU"
curl "$BASE/api/students/G1_S01/report?school=KMU&mode=double"
```

（假資料的 `studentKey` 由 `seed.py` 產生，實際值以 `/api/students?school=...` 回應為準。）

---

## 8. 目前未定 / 等待中（不影響你開工）

| 項目 | 影響 | 現況 |
|---|---|---|
| 8 個場域正式字串 | 無 —— 前端從 `/api/schools` 動態取得 | 佔位代碼，後端重灌時前端不用改 |
| 16 位老師正式名單 | 無 —— 從 API 動態取得 | 佔位名字（吳老師…） |
| CORS 設定 | 本機常見埠開箱即用；正式網域要通知後端 | ✅ 已設定，見 §0.3 |
| 後端整合測試跑綠 | 低 —— 契約已固定 | 待 DB 帳密 |
| 登入頁 repo / 分支歸屬 | 專案管理 | 跟後端／PM 講定 |
