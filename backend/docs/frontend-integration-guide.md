# 前端串接指南：帳密登入 + 學生進度檢視

給前端組員（vanilla JS + Canvas）。這份文件是 **API 契約 + 畫面流程**，看這份就能開始
設計介面與寫串接，不需要讀後端程式碼。

- 對應後端設計：
  [`specs/2026-09-08-teacher-directory-login-design.md`](superpowers/specs/2026-09-08-teacher-directory-login-design.md)（原始的選單式登入設計，**已被下面這份 ADR 推翻密碼相關的部分**）、
  [`specs/2026-09-08-single-vs-double-player-mode-design.md`](superpowers/specs/2026-09-08-single-vs-double-player-mode-design.md)（單／雙人模式，仍有效）、
  [`adr/0004-teacher-student-password-login.md`](adr/0004-teacher-student-password-login.md)（2026-09-11：廠商改口要帳密登入，這份文件已依此改寫）
- 狀態：契約**已定案**、後端**已實作**，`uv run pytest` 全綠（含帳密登入的授權測試）。

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

### 0.2 帳密登入（2026-09-11 起，取代原本的「選單式免密碼」）

> **這節整段改寫**：廠商從「下拉選人、無密碼」改口為「老師與學生都要帳號＋密碼」，
> 且老師只能看自己管轄場域的學生。見
> [`docs/adr/0004-teacher-student-password-login.md`](adr/0004-teacher-student-password-login.md)。

- 登入表單**只有「帳號＋密碼」兩欄**（跟你的 mockup 圖2～圖4 對齊），老師、學生
  皆同，**沒有選場域這一步**。
- 帳號是後端另外指派的**全域唯一**字串（老師 `T0001` 這種格式、學生 `S0001` 這種
  格式），**跟老師姓名／`studentKey`（`grade_caseId`）是兩回事**——姓名只在
  `school` 內唯一、`studentKey` 每個場域都會重複，都不能拿來當登入帳號，這是
  這次特地加 `account` 欄位的原因（見 ADR 0004）。姓名／`studentKey`/`school`
  是登入**成功後**回應裡的顯示資訊，不是登入時要輸入的東西。
- 密碼（和帳號）由後端/管理者預先指派，不是自助註冊。
- 登入成功會拿到一組 `token`（不透明字串，8 小時後過期）。**之後所有會回傳學生
  資料的 API，都要在 header 帶 `Authorization: Bearer <token>`**，否則回 `401`。
- 後端會**強制**做場域隔離，不是只有前端 UI 藏起來：老師 token 查別場域一律
  `403`；學生 token 只能查自己，查別人也是 `403`。就算你手動用 curl 帶著自己的
  token 打別人的資料也一樣會被擋。
- `GET /api/schools`、`GET /api/schools/{school}/teachers` 維持公開，但**不再是
  登入流程的一部分**——登入頁不用呼叫這兩支。

登入端點見 §2.0。前端狀態機（§6）也一併更新——`dms.html` 現在直接信任登入結果，
不再有「選場域→選老師」兩層下拉。

> ⚠️ `/demo`（後端組員自己的驗收頁）目前還沒跟著改，帳密登入上線後會壞掉。
> 這**不是正式前端的一部分**，壞了不影響你，忽略即可。

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

### 0.5 場域字串（`school`）

`school` 這個字串是整個系統的 join key。已定案為短代碼：`KMU`、`NTHU-01`…`NTHU-07`
（見 `docs/school-directory.md`）。顯示名稱（`displayName`，如「清華大學（第一場）」）
之後廠商可能微調。

登入後的回應（`TeacherLoginResponse.school`／`StudentLoginResponse.school`）給的是
**代碼**（例如 `KMU`），不是 `displayName`。目前的參考實作（`dms.html`）直接顯示代碼，
沒有另外轉成中文顯示名稱——如果你想顯示更友善的名稱，可以自己呼叫 `GET /api/schools`
（公開端點）把代碼對照成 `displayName`，**不要在前端寫死對照表**，場域字串之前就
翻過一次盤，別重演。

---

## 1. 兩條使用流程（2026-09-11 更新：都要先登入）

### 1.1 學生端

```
POST /api/auth/student/login {account, password}
    → 拿到 token + studentKey/grade/caseId/school（顯示用）
    → 雙人模式兩位都要各自成功登入才算完成
    → 進遊戲大廳（games.html），不再是進度頁
```

小朋友端目前的落地頁是遊戲大廳，不是進度頁——後者仍然存在（`/report`），但這次
沒有 UI 入口去看，見 §2.6 的備註。

### 1.2 老師端

```
POST /api/auth/teacher/login {account, password}
    → 拿到 token + teacherId/teacherName/school（顯示用），存起來，之後每支 API 都要帶
GET  /api/me/students        （帶 Authorization）
    → 老師檢視頁第一畫面：名下所有學生的概況表，點其中一位
GET  /api/students/{studentKey}/report?school={school}  （帶 Authorization）
    → 該學生的進度頁
```

> 老師與學生看到的「進度頁」是**同一個** `/report` 端點、同一份資料。差別只在
> 進入方式，以及現在都要帶 token。

---

## 2. 端點詳規

### 2.0 登入（新增）

#### `POST /api/auth/teacher/login`

**Request body**（帳號是後端另外指派的字串，例如 `T0001`，不是老師姓名）
```json
{ "account": "T0001", "password": "..." }
```

**Response 200**
```json
{ "token": "…", "teacherId": 1, "teacherName": "吳老師", "school": "KMU" }
```

`teacherName`／`school` 是**顯示用**的資訊，登入成功才知道，不是登入輸入。

**Response 401**（帳號或密碼錯）
```json
{ "detail": "帳號或密碼錯誤" }
```

#### `POST /api/auth/student/login`

**Request body**（帳號是後端另外指派的字串，例如 `S0001`，不是 `studentKey`）
```json
{ "account": "S0001", "password": "..." }
```

**Response 200**
```json
{ "token": "…", "studentKey": "G1_S01", "grade": "G1", "caseId": "S01", "school": "KMU" }
```

`studentKey`／`school` 同樣是顯示用資訊。

**Response 401**：`{"detail":"帳號或密碼錯誤"}`（帳號不存在或密碼錯，不分辨）。

雙人模式呼叫兩次（兩位學生的帳密各自驗證），**兩次都成功才算登入完成**；哪一次
失敗就告訴使用者是「學生1」還是「學生2」的帳密有問題。

#### `POST /api/auth/logout`

帶 `Authorization: Bearer <token>`，登出當前 token。找不到 token 也回 `204`
（冪等，不算錯誤）。

#### 之後怎麼用 `token`

拿到 `token` 後，**除了 `/api/schools`、`/api/schools/{school}/teachers`、
`/api/auth/*`、`/api/games` 之外的所有端點都要帶**：

```js
fetch(url, { headers: { Authorization: `Bearer ${token}` } })
```

沒帶 → `401 {"detail":"請重新登入"}`；token 過期或無效 → 同樣 `401`，前端該清掉
本地存的登入狀態、導回登入頁。查到不屬於自己（場域不符/別的學生）的資料 →
`403 {"detail":"無權查看其他場域資料"}`，這不是「輸入打錯」，是後端主動擋下，UI
可以直接顯示「無權限」而不用猜。

---

### 2.1 `GET /api/schools`

場域清單。**不再是登入流程的一部分**（登入表單只有帳號＋密碼），留著給你需要把
`school` 代碼轉成中文顯示名稱時用（見 §0.5）。

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

某場域的老師清單。**不再是登入流程的一部分**——登入不用選老師姓名，直接輸入帳號
密碼即可。保留這支給其他可能用得到「某場域有哪些老師」的畫面。

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

### 2.3 `GET /api/me/students` ★ 登入後請改叫這支

老師登入後名下的學生清單（＝該老師所屬場域的**全部**學生）。老師檢視頁的第一畫面。
**身份完全來自 `token`**，不用（也不能）自己指定 `teacherId`。

**Request**：帶 `Authorization` header，無其他參數。

**Response 200**：形狀跟下面 2.3.1 的 `/api/teachers/{teacherId}/students` 完全一樣。

**Response 401**：沒帶 token / token 無效或過期。

---

### 2.3.1 `GET /api/teachers/{teacherId}/students`（舊端點，相容用）

跟 2.3 資料形狀相同，差別是路徑帶 `teacherId`。**新前端請直接用 2.3
的 `/api/me/students`**，不用查自己的 `teacherId` 再組這支 URL。保留這支只是
不讓舊呼叫端（`/demo`、既有測試）馬上壞掉。

**Request**：`{teacherId}` 是路徑參數（整數），**且必須帶 token、且 token 的
`teacherId` 要等於這個路徑參數**——查別人的 `teacherId` 會 `403`，不是查到別人資料。

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

### 2.4 `GET /api/students?school={school}`（老師專用，須登入）

某場域的學生清單。**2026-09-11 起改為老師專用、只能查自己場域**——原本學生端
用這支查全場域名冊的用法已經不成立（學生現在直接登入進遊戲大廳，不會走這條路）。

**Request**：帶 `Authorization`（老師 token）。

| 參數 | 位置 | 必填 | 說明 |
|---|---|---|---|
| `school` | query | 否 | 不給預設為登入老師自己的場域。**帶了跟自己場域不同的值會 403**，不會回別人的資料，也不會回「所有場域」 |

**Response 200**：形狀與 2.3 相同。
**Response 403**：`school` 跟登入老師的場域不同。

> 名冊沒有「學生姓名」欄位，只有 `studentKey`（`G1_S01` 這種）。

---

### 2.5 `GET /api/students/{studentKey}/sessions?school={school}`

單一學生的**場次清單**（輕量版，只有時間，沒有成績數字）。適合做「歷程時間軸」。
**須登入**：老師 token 只能查自己場域的學生；學生 token 只能查自己。

**Request**：帶 `Authorization`。

| 參數 | 位置 | 必填 | 說明 |
|---|---|---|---|
| `studentKey` | path | ✅ | `grade_caseId`，例 `G1_S01` |
| `school` | query | ✅ | |
| `game_type` | query | 否 | `DAT` / `DCCS` / `EFT` / `IM` / `TGame`（大小寫不拘） |
| `mode` | query | 否 | `single` / `double` |

**Response 403**：老師查別場域的學生，或學生查別人。

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

單一學生的**完整進度報告**：場次明細 + 各遊戲彙總 + 趨勢序列。老師檢視頁靠這支。
**須登入**，授權規則同 2.5。

> 這次學生登入後的落地頁是遊戲大廳（§1.1），沒有 UI 入口叫這支——但端點本身沒拿掉，
> 學生 token 一樣能查自己的報告，之後如果要把進度頁加回學生端，直接照這份規格接即可。

**Request**：帶 `Authorization`。

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

### 2.7 `GET /api/games`（新增，遊戲大廳用）

靜態遊戲清單，公開端點，不用登入、不含任何學生資料。

**Response 200**
```json
{
  "games": [
    { "gameType": "DAT",   "doubleCapable": true },
    { "gameType": "DCCS",  "doubleCapable": true },
    { "gameType": "EFT",   "doubleCapable": true },
    { "gameType": "IM",    "doubleCapable": false },
    { "gameType": "TGame", "doubleCapable": false }
  ]
}
```

- 依 `gameType` 字母序排列，固定 5 項。
- `doubleCapable: false` 的遊戲（`IM`、`TGame`）在雙人模式下**不要顯示**卡片
  （目前沒有雙人版）。
- 用這支動態拿清單，**不要在前端另外寫死一份**——`school` 曾經被前端寫死、後端
  一改前端就跟著壞，這支就是為了不重演那次。

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
| 帳號或密碼錯（登入端點） | `401` | `{"detail":"帳號或密碼錯誤"}` | 顯示在登入表單上，**不要**指出是帳號還是密碼錯 |
| 沒帶 token / token 無效或過期（受保護端點） | `401` | `{"detail":"請重新登入"}` | 清掉本地登入狀態，導回登入頁 |
| 查到不屬於自己的資料（老師查別場域、學生查別人） | `403` | `{"detail":"無權查看其他場域資料"}` | 顯示「無權限」，不是「查無資料」 |
| `studentKey` 格式錯（不是 `grade_caseId`） | `400` | `{"detail":"studentKey 格式應為 G1_S03（grade_caseId）"}` | 檢查自己組的字串 |
| 未知 `teacherId`（2.3.1 舊端點，理論上不會發生） | `404` | `{"detail":"查無此老師"}` | 回登入頁 |
| 未知場域 / 未知學生 / 篩選後為空 | `200` | 空陣列或空 records | 顯示「查無資料」空狀態，**不是錯誤** |
| 後端 DB 掛掉 | `500` | `{"detail":"資料庫查詢失敗"}` | 顯示通用錯誤 + 重試按鈕。**訊息不含細節**，別想從 body 解析原因 |
| 少必填 query（如漏 `school`） | `422` | FastAPI 驗證錯誤結構 | 開發期修好即可 |

所有錯誤 body 都是 `{"detail": "..."}`（422 例外，是 FastAPI 的陣列結構）。

---

## 6. 前端狀態機（2026-09-11 更新：登入即身份確認）

```
選身分    → "student" | "teacher"
老師：
  填帳號+密碼 → POST /api/auth/teacher/login {account, password}
            → state.token / state.teacherId / state.teacherName / state.school
  進 dms.html → GET /api/me/students（帶 token）→ 選學生 → GET /report（帶 token）
學生（單人）：
  選模式=單人
  填帳號+密碼 → POST /api/auth/student/login {account, password}
            → state.token / state.studentKey / state.school
  進 games.html → GET /api/games → 點卡片（目前顯示「即將推出」）
學生（雙人）：
  選模式=雙人
  兩組帳號+密碼，各自 POST /api/auth/student/login（都要成功）
            → state.student1Token / state.student2Token（各自的 token/身份）
  進 games.html → 只顯示 doubleCapable 的遊戲
```

- `token` 是之後每支受保護 API 都要帶的東西，`sessionStorage` 存最合理——重新整理
  頁面後還在，關掉分頁/瀏覽器就消失，跟 8 小時的伺服器端過期時間搭配剛好。
- 收到 `401` → 清掉 `sessionStorage` 裡的登入狀態、導回 `index.html`（token 過期了）。
- 「登出」＝呼叫 `POST /api/auth/logout`（best-effort，失敗也沒關係）＋清掉
  `sessionStorage`＋導回登入頁。
- `dms.html` 不再需要「選場域→選老師」兩層下拉——登入那一刻身份就確定了。

---

## 7. 快速自測（curl）

後端本機跑起來（`uv run uvicorn main:app --port 5001`）+ 灌好參照資料
（`uv run python seed_directory.py`，會印出這次新指派的老師「場域/姓名/帳號/密碼」，
記下帳號+密碼）+ 灌好假學生（`uv run python seed.py`，假學生密碼統一是
`test1234`，帳號印出一個範例如 `S0001`，其餘依序 `S0002`…）後：

```bash
BASE=http://127.0.0.1:5001

# 公開端點，不用登入
curl "$BASE/api/games"

# 登入（把下面換成 seed_directory.py 印出來的帳號/密碼，不是姓名）
TOKEN=$(curl -s -X POST "$BASE/api/auth/teacher/login" \
  -H "Content-Type: application/json" \
  -d '{"account":"T0001","password":"<貼上印出來的密碼>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 帶 token 打受保護端點
curl "$BASE/api/me/students" -H "Authorization: Bearer $TOKEN"
curl "$BASE/api/students/G1_S01/report?school=KMU" -H "Authorization: Bearer $TOKEN"

# 沒帶 token 會被擋
curl -i "$BASE/api/me/students"   # 401

# 學生登入（帳號換成 seed.py 印出來的那個，例如 S0001）
curl -X POST "$BASE/api/auth/student/login" \
  -H "Content-Type: application/json" \
  -d '{"account":"S0001","password":"test1234"}'
```

（假資料的 `studentKey` 由 `seed.py` 產生，實際值以 `/api/me/students` 回應為準。
Windows PowerShell 環境用 curl 傳中文/JSON body 容易被殼層引號吃掉，建議寫到
檔案再用 `--data-binary @file.json`，這次除錯過程剛好踩過這個坑。）

---

## 8. 目前未定 / 等待中（不影響你開工）

| 項目 | 影響 | 現況 |
|---|---|---|
| 8 個場域正式字串 | 無 —— 前端從 `/api/schools` 動態取得 | 佔位代碼，後端重灌時前端不用改 |
| 16 位老師正式名單 | 無 —— 從 API 動態取得 | 佔位名字（吳老師…） |
| CORS 設定 | 本機常見埠開箱即用；正式網域要通知後端 | ✅ 已設定，見 §0.3 |
| 後端整合測試跑綠 | 低 —— 契約已固定 | ✅ 已跑綠（含帳密登入） |
| 登入頁 repo / 分支歸屬 | 專案管理 | 跟後端／PM 講定 |
| 學生密碼怎麼實際發放給小朋友 | 中 —— 影響學生端能不能真的開始用 | 後端能設密碼（`manage_passwords.py`），但「紙本？email？」這個流程還沒跟廠商定案 |
| 遊戲大廳點卡片後要導去哪 | 中 —— 目前只顯示「即將推出」 | 等 Unity 遊戲組的實際網址/整合方式 |
| `/demo` 驗收頁 | 低，非正式前端 | 帳密登入上線後會壞（沒登入態），暫不修 |
