# Unity 串接指南：把遊戲結果送到中介平台（含雙人版）

給負責 **DAT / DCCS / EFT** 遊戲的六位開發者。單人版與雙人版的成績都是透過同一支
API（`POST /api/sessions`）送回中介平台。

- 對應設計：[`specs/2026-09-08-single-vs-double-player-mode-design.md`](superpowers/specs/2026-09-08-single-vs-double-player-mode-design.md)
- 契約狀態：**已定案、已實作、已用真資料庫測過**。

---

## 0. 要改的內容

| 你負責的 | 要不要改 Unity 送資料的程式？ |
|---|---|
| **單人版**（DAT / DCCS / EFT 任一款） | **不用改**。現有 payload 照送，中介平台會當成 `mode = "single"` 處理 |
| **雙人版**（DAT / DCCS / EFT 任一款） | **要改**：在 `data` 裡多送兩個欄位 `mode: "double"` 和 `pairId`（見 §3） |

IM、TGame 沒有雙人版，不受影響。

---

## 1. Endpoint

```
POST  https://attention-lesson-plan-transfer-data.zeabur.app/api/sessions
Content-Type: application/json
```

- 成功回 `201`，body：`{ "sessionId": "<uuid>", "message": "已接收" }`
- 一位學生玩完一場 → 送一個 POST。**雙人版是兩位學生 → 兩個各自獨立的 POST**（見 §3）。
- 沒有驗證、不用帶 token。

---

## 2. 現有 payload（單人版，維持不變）

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
    "stats": [
      { "apiname": "DAT_correct",  "value": 18 },
      { "apiname": "DAT_wrong",    "value": 3  },
      { "apiname": "DAT_accuracy", "value": 0.85 },
      { "apiname": "DAT_duration", "value": 175635 },
      { "apiname": "DAT_stage",    "value": 8 }
    ]
  }
}
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `lessonId` | string | 最後一個 `_` 後面那段是遊戲代號。`1140908_DAT` → `DAT`。**大小寫要對**：`DAT` / `DCCS` / `EFT` / `IM` / `TGame` |
| `data.grade` | string | 年級，例 `G1` |
| `data.caseId` | string | 個案編號，例 `S03` |
| `data.school` | string | **場域識別字串**，見 §6。三方必須完全一致 |
| `data.currentDay` | int | 第幾個施測日 |
| `data.startTime` / `endTime` | int | Unix **毫秒**。`endTime` 不可早於 `startTime` |
| `data.stats[]` | array | `{apiname, value}` 陣列。每款遊戲**必須**包含這 5 筆（`<遊戲>_` 前綴）：`_correct`、`_wrong`、`_accuracy`、`_duration`、`_stage`。缺任一筆 → `400` |

> **注意（現況）**：中介平台目前**只儲存上面這 5 個核心數值**。你多送的遊戲專屬欄位
> （如 `DAT_avgReactionTime`、`EFT_wrongDirectionCount`…）中介平台會**收下但不寫入
> 資料庫**。如果研究需要保留這些細項，請告訴後端負責人，那是另一個工作項目。

---

## 3. 雙人版要多做的事

廠商定調：**雙人版 = 一台裝置、兩個小孩一起玩**。每位學生各記一筆自己的成績、
各送一個 POST，兩筆用一個 `pairId` 綁在一起。

### 3.1 payload 加兩個欄位

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

    "stats": [
      { "apiname": "DAT_correct",  "value": 20 },
      { "apiname": "DAT_wrong",    "value": 2  },
      { "apiname": "DAT_accuracy", "value": 0.90 },
      { "apiname": "DAT_duration", "value": 176000 },
      { "apiname": "DAT_stage",    "value": 9 }
    ]
  }
}
```

| 新欄位 | 型別 | 說明 |
|---|---|---|
| `data.mode` | string | `"double"`。不送或送 `"single"` = 單人版。大小寫不拘（後端會轉小寫） |
| `data.pairId` | string | 這一局雙人遊戲的識別碼。**同一局的兩位學生送的 `pairId` 必須一模一樣**。長度上限 36 字元（一個標準 UUID 剛好 36）|

### 3.2 pairId 怎麼產

**開局時產一次，兩位學生共用。** 建議：

```csharp
// 一場雙人局開始時，產一個 GUID
string pairId = System.Guid.NewGuid().ToString();   // 例："6f1c8e2a-3b7d-4e11-9a52-0c9d7f2b1e44"

// 結束時，兩位學生各送一個 POST，兩個 payload 都帶這同一個 pairId
```

因為是同一台裝置，Unity 這邊自己記住這局的 `pairId` 就好，沒有跨裝置的問題。

### 3.3 兩個 POST 各自獨立

雙人局的兩位學生 = 兩個完全獨立的 `POST /api/sessions`。一個失敗不影響另一個，
失敗的那個可以自己重送。**不要**想做「一次送兩個人」。

### 3.4 缺 pairId 會怎樣

如果 `mode: "double"` 但沒帶 `pairId`：中介平台**還是會收**（`201`），只是那筆少了
「跟搭檔的連結」。所以就算 `pairId` 產生邏輯出包，成績也不會掉。但請盡量帶對。

---

## 4. 驗證規則與錯誤回應

| 情況 | HTTP | body |
|---|---|---|
| 成功 | `201` | `{"sessionId": "...", "message": "已接收"}` |
| `mode` 不是 single / double | `422` | Pydantic 驗證錯誤結構 |
| `mode: "double"` 但遊戲不是 DAT/DCCS/EFT | `400` | `{"detail": "雙人版僅支援 DAT／DCCS／EFT"}` |
| `pairId` 長度 > 36 | `400` | `{"detail": "pairId 格式錯誤"}` |
| 缺 5 個核心 stat 之一 | `400` | `{"detail": "缺少必要統計：DAT_wrong"}` |
| `endTime` 早於 `startTime` | `400` | `{"detail": "endTime 不可早於 startTime"}` |
| `grade`／`caseId`／`school` 空白 | `422` | — |
| `lessonId` 認不出遊戲 | `400` | `{"detail": "不支援的遊戲：XXX"}` |
| 同一個 sessionId 重複送 | `409` | `{"detail": "場次已存在"}` |
| 中介平台/資料庫出錯 | `500` | `{"detail": "資料庫寫入失敗"}`（可重送） |

`mode: "single"` 時若誤帶了 `pairId`，會被忽略（存 NULL），不報錯。

---

## 5. 六個人的分工對照

一組遊戲 = 單人版 + 雙人版，各一位負責人。

| 遊戲 | 單人版負責人 | 雙人版負責人 |
|---|---|---|
| **DAT** | payload 不改 | `data` 加 `mode:"double"` + `pairId` |
| **DCCS** | payload 不改 | `data` 加 `mode:"double"` + `pairId` |
| **EFT** | payload 不改 | `data` 加 `mode:"double"` + `pairId` |

**所有六個人都要確認**（見 §6）：你的 build 送的 `data.school` 字串，用 §6 表格裡的
代碼（`KMU` / `NTHU-01` … `NTHU-07`），逐字對照。

---

## 6. `school` 字串必須三方對齊 ⚠️（已定案）

`data.school` 是把「學生、成績、場域、老師」串起來的鍵。只要 Unity 端送的字串跟
中介平台登記的差一個字（全形半形、空白、破折號變體），**兩邊就永遠對不起來，而且
不會報錯**，只會查出空資料。

廠商把命名交給後端決定，**已定案**（完整說明見 `docs/school-directory.md`）：

| Unity build 送的 `data.school` | 場域 |
|---|---|
| `KMU` | 高雄醫學大學 |
| `NTHU-01` | 清華大學（第一場） |
| `NTHU-02` | 清華大學（第二場） |
| `NTHU-03` | 清華大學（第三場） |
| `NTHU-04` | 清華大學（第四場） |
| `NTHU-05` | 清華大學（第五場） |
| `NTHU-06` | 清華大學（第六場） |
| `NTHU-07` | 清華大學（第七場） |

- 大寫英數字 + **半形**連字號 `-`。寫死進 build 前逐字對照本表（特別注意連字號不要
  打成 `–` 或 `－`）。
- 哪個場域對到 `NTHU-0X` 的哪一號，請跟後端／廠商確認對應關係後再寫死。

---

## 7. 交接 checklist

給雙人版負責人：

- [ ] 開局時 `Guid.NewGuid()` 產一個 `pairId`，這局兩位學生共用
- [ ] 每位學生結束時各送一個 `POST /api/sessions`，`data` 裡帶：
  - [ ] `mode: "double"`
  - [ ] `pairId`: 這局的那個 GUID
- [ ] 5 個核心 stat 的 `apiname` 前綴 = lessonId 的遊戲代號（`DAT_correct` 等）
- [ ] `data.school` 用 §6 表格的代碼（`KMU` / `NTHU-01`…），逐字對照連字號
- [ ] 先送一筆 `201` 測通

給單人版負責人：

- [ ] 確認現有 payload 仍照送（不用改）
- [ ] `data.school` 用 §6 表格的代碼
- [ ] （選）如果研究需要保留遊戲專屬細項欄位，跟後端負責人提出

---

## 8. 快速自測（curl）

```bash
BASE=https://attention-lesson-plan-transfer-data.zeabur.app

# 雙人版 DAT
curl -X POST "$BASE/api/sessions" -H "Content-Type: application/json" -d '{
  "lessonId": "test_DAT",
  "data": {
    "grade": "G1", "caseId": "S99", "school": "KMU",
    "currentDay": 1, "startTime": 1725000000000, "endTime": 1725000360000,
    "mode": "double", "pairId": "test-pair-0001",
    "stats": [
      {"apiname":"DAT_correct","value":20},{"apiname":"DAT_wrong","value":2},
      {"apiname":"DAT_accuracy","value":0.9},{"apiname":"DAT_duration","value":176000},
      {"apiname":"DAT_stage","value":9}
    ]
  }
}'
# → {"sessionId":"...","message":"已接收"}
```

（正式環境測完記得把測試資料清掉，或用測試場域代碼。）
