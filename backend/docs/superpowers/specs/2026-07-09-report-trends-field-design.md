# /report 新增 trends 欄位設計

日期：2026-07-09

## 問題

`/report` 目前提供兩種資料視圖：`records`（逐場次的原始統計）與 `summaryByGame`（依遊戲彙總成單一數字）。前端要畫「進步趨勢折線圖」時，缺少一個「依遊戲、依指標、沿時間排列」的時間序列視圖，必須自己從 `records` 反覆 pivot。

## 範圍

在 `StudentReportResponse` 新增第三個欄位 `trends`，把 report 已經取得的 `records` 重新 pivot 成時間序列。

**不新增任何 SQL、不變更任何 `fetch_*` 函式。** `trends` 完全由既有 `records` 以純函式導出。

不在範圍內：新的資料庫查詢、獨立的 `/trends` 端點、`records` 或 `summaryByGame` 的任何變更、時間區間篩選、指標門檻/警示。

## 設計核心

`trends` 是 `records` 的第三種切法。三者是同一批資料：

| 視圖 | 分組軸 | 內容 |
|---|---|---|
| `records[]` | 場次 | 每場的完整 stats |
| `summaryByGame[]` | gameType | 彙總成單一數字 |
| `trends[]`（新增） | gameType × 指標 | 沿時間排列的 `{time, value}` 序列 |

因為 `records` 已含 `gameType`、`startTime` 與每場 `stats`，`trends` 不需要碰資料庫。

## API 契約

`/report` 的輸入完全不變（`studentKey`、`school` 必填、`game_type` 選填）。回應新增 `trends` 欄位。

### 回應片段（200）

```jsonc
"trends": [
  {
    "gameType": "DCCS",
    "items": [
      {
        "type": "correctCount",
        "stats": [
          { "time": "2026-01-01 08:26:00", "value": 15 },
          { "time": "2026-01-05 13:35:00", "value": 18 }
        ]
      },
      { "type": "wrongCount", "stats": [ ... ] },
      { "type": "accuracy",   "stats": [ { "time": "...", "value": 93.5 }, ... ] }
    ]
  }
]
```

### 欄位語意

| 欄位 | 型別 | 說明 |
|---|---|---|
| `trends[].gameType` | `string` | 機器鍵（如 `DCCS`）。依字母排序 |
| `trends[].items[].type` | `string` | 指標機器鍵。固定三種、固定順序 |
| `items[].stats[].time` | `string` | 沿用該場次的 `startTime`（秒精度） |
| `items[].stats[].value` | `int \| float` | 該指標的值 |

### 契約決定與理由

**只涵蓋三個指標，固定順序 `correctCount → wrongCount → accuracy`。**
這三者恰好是 `GameStats` 的屬性名。`duration`（單位為毫秒，需再決定換算）與 `stage`（語意依遊戲而定）暫不納入。順序固定使回應可預測、測試可斷言。

**`type` 回機器鍵，不回中文顯示字串。**
整支 API 一律用機器鍵（`gameType`、`correctCount`、`avgAccuracy`），顯示文字留給前端。若在此塞入中文 `"正確數"`，將是全 API 唯一綁死語系的地方，日後做多語系或改字會受阻。中文標籤由前端對照。

**`time` 沿用場次的 `startTime`（秒精度），不另做分鐘精度。**
同一筆資料在 report 各處格式一致；前端要截成分鐘只需字串切片，無損。

**`value` 型別為 `int | float` 聯集，保留原生型別。**
`correctCount` / `wrongCount` 維持整數 `15`，`accuracy` 維持浮點 `93.5`。若統一成 `float`，計數會顯示為 `15.0`。Pydantic v2 的 smart union 會保留傳入的原生型別。

**每條 `stats` 序列由舊到新排序（ascending）。**
折線圖即取即畫。`records` 本身是 `start_time DESC`，`trends` 在組裝時另行升冪排序，不改動 `records` 的順序。

**`gameType` 依字母排序，與 `summaryByGame` 對齊。**
兩個欄位排序一致，呼叫端行為可預測。

**`stats is None` 的場次整筆略過。**
report 中某些 `record.stats` 為 `None`（細部表查無對應列），沒有數值可畫。略過該場次，而非補 `value: 0`——`0` 會與「真的考 0」混淆。

## 衍生行為（非新增，順帶記錄）

- **`game_type` 篩選連動**：`/report?game_type=DAT` 時 `records` 只剩 DAT，`trends` 自然也只有 DAT。無須特別處理。
- **排序靠字串**：`startTime` 為 `YYYY-MM-DD HH:MM:SS`，字典序等同時間序，直接字串排序即正確。
- **空情況**：無任何帶 stats 的場次 → `trends: []`。

## 模型（models.py）

在既有回應模型之後新增三個：

```python
class TrendPoint(BaseModel):
    time: str
    value: int | float

class TrendItem(BaseModel):
    type: str
    stats: list[TrendPoint] = Field(default_factory=list)

class GameTrend(BaseModel):
    gameType: str
    items: list[TrendItem] = Field(default_factory=list)
```

並在 `StudentReportResponse` 新增：

```python
    trends: list[GameTrend] = Field(default_factory=list)
```

## 組裝（routers/students.py）

新增純函式，與 `build_summary_by_game` 並列：

```python
TREND_METRICS = ("correctCount", "wrongCount", "accuracy")  # 固定順序

def build_trends(records: list[PlayRecord]) -> list[GameTrend]:
    grouped: dict[str, list[PlayRecord]] = {}
    for record in records:
        if record.stats is None:
            continue
        grouped.setdefault(record.gameType, []).append(record)

    trends: list[GameTrend] = []
    for game_type in sorted(grouped):
        ordered = sorted(grouped[game_type], key=lambda r: r.startTime)  # 舊→新
        items = [
            TrendItem(
                type=metric,
                stats=[
                    TrendPoint(time=r.startTime, value=getattr(r.stats, metric))
                    for r in ordered
                ],
            )
            for metric in TREND_METRICS
        ]
        trends.append(GameTrend(gameType=game_type, items=items))
    return trends
```

指標名恰為 `GameStats` 的屬性名，`getattr` 直接取值。route handler 只多一行：

```python
    return StudentReportResponse(
        ...
        summaryByGame=build_summary_by_game(records),
        trends=build_trends(records),
    )
```

`fetch_*` 與 SQL 完全不動。

## 測試

### 純函式（test_assembly.py）

`build_trends` 全數不碰資料庫，餵 `PlayRecord` 清單即可：

1. 依 `gameType` 分組且字母排序（餵 `EFT`、`DCCS`、`DAT` → 出 `DAT`、`DCCS`、`EFT`）。
2. 每個 gameType 固定三個 item，順序為 `correctCount`、`wrongCount`、`accuracy`。
3. 每條 `stats` 序列由舊到新（餵亂序 `startTime`，斷言輸出升冪）。
4. `stats is None` 的場次不出現在任何序列裡。
5. 取值正確：`correctCount` 點的 `value` 等於該場 `stats.correctCount`，`accuracy` 同理。
6. `value` 型別：計數為 `int`、`accuracy` 為 `float`。
7. 空輸入、或全數 stats 皆 None → 回 `[]`。

### API（test_api.py）

以 TestClient 打 `/report`，斷言回應含 `trends`，且結構符合契約（gameType 排序、三指標順序、序列升冪）。此層以測試資料庫為資料來源，沿用既有 fixture。

### 實作順序

1. 新增三個模型並在 `StudentReportResponse` 掛上 `trends`。
2. 先寫 `build_trends` 的純函式測試（紅燈）。
3. 實作 `build_trends`，測試轉綠。
4. route handler 加上 `trends=build_trends(records)`。
5. 補 `test_api.py` 的端點層斷言。

## 已知債務

**`duration` 與 `stage` 未納入趨勢。**
`duration` 單位為毫秒，畫圖前需決定是否換算為秒；`stage` 的意義依遊戲設計而定。兩者留待實際有需求時，以相同的 pivot 機制擴充 `TREND_METRICS` 即可，不需改動結構。
