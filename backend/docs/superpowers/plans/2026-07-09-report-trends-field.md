# /report 新增 trends 欄位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/report` 回應新增 `trends` 欄位，把既有 `records` pivot 成「gameType × 指標 × 時間序列」，供前端畫進步趨勢折線圖。

**Architecture:** `trends` 是 `records` 的第三種切法（前兩種為 `records` 與 `summaryByGame`），由一個純函式 `build_trends` 從既有 `records` 導出。不新增 SQL、不改 `fetch_*`。三個指標名恰為 `GameStats` 的屬性名，以 `getattr` 取值。

**Tech Stack:** Python 3.10+、FastAPI、Pydantic v2、pytest（純函式測試 + FastAPI TestClient 端點測試）。

## Global Constraints

- **Python 3.10 以上。** 程式碼使用 `X | None` / `int | float` 型別註記，Pydantic 在 3.9 上無法解析。
- **所有指令在 venv 內執行**，不污染系統 Python：一律以 `.venv/bin/python -m pytest ...` 呼叫，不用系統 `python`/`pytest`。
- **`type` 一律回機器鍵**（`correctCount` / `wrongCount` / `accuracy`），不回中文顯示字串。
- **指標固定三種、固定順序**：`correctCount` → `wrongCount` → `accuracy`。
- **`gameType` 依字母排序**（與 `summaryByGame` 對齊）。
- **每條 `stats` 序列由舊到新排序**（ascending by `startTime`）。
- **`stats is None` 的場次整筆略過**，不補 `value: 0`。
- **`value` 型別為 `int | float`**，保留原生型別（計數為 int、accuracy 為 float）。
- **不動 SQL、不動 `fetch_*`、不改 `records` 與 `summaryByGame`。**
- 需要資料庫的測試需設定 `TEST_DB_NAME`（名稱以 `_test` 結尾）；未設定時這類測試會自動跳過，純函式測試照常執行。

---

## File Structure

- `models.py` — 新增三個回應模型 `TrendPoint` / `TrendItem` / `GameTrend`，並在 `StudentReportResponse` 掛上 `trends` 欄位。
- `routers/students.py` — 新增 `TREND_METRICS` 常數與純函式 `build_trends`；在 `get_student_report` handler 掛上 `trends=build_trends(records)`。
- `tests/test_assembly.py` — `build_trends` 的純函式測試（不碰資料庫）。
- `tests/test_api.py` — `/report` 端點層測試，斷言 `trends` 結構（碰測試資料庫，沿用既有 `client` / `db` fixture）。

---

## Task 1: trend 模型與 build_trends 純函式

**Files:**
- Modify: `models.py`（在檔尾新增三個模型，並於 `StudentReportResponse` 加一欄）
- Modify: `routers/students.py`（在 `build_summary_by_game` 之後新增 `TREND_METRICS` 與 `build_trends`）
- Test: `tests/test_assembly.py`

**Interfaces:**
- Consumes: 既有 `build_play_records(rows, stats_by_uuid) -> list[PlayRecord]`（測試用來造 records）；`PlayRecord.stats: GameStats | None`，`GameStats` 具屬性 `correctCount: int`、`wrongCount: int`、`accuracy: float`。
- Produces:
  - `models.TrendPoint(time: str, value: int | float)`
  - `models.TrendItem(type: str, stats: list[TrendPoint])`
  - `models.GameTrend(gameType: str, items: list[TrendItem])`
  - `StudentReportResponse.trends: list[GameTrend]`（預設空陣列）
  - `routers.students.TREND_METRICS: tuple[str, ...]`（`("correctCount", "wrongCount", "accuracy")`）
  - `routers.students.build_trends(records: list[PlayRecord]) -> list[GameTrend]`

- [ ] **Step 1: 新增三個模型並在 StudentReportResponse 掛上 trends**

在 `models.py` 檔尾（`StudentListResponse` 之後）新增：

```python
class TrendPoint(BaseModel):
    time: str
    value: int | float  # 計數保持 int，accuracy 保持 float


class TrendItem(BaseModel):
    type: str  # 機器鍵：correctCount / wrongCount / accuracy
    stats: list[TrendPoint] = Field(default_factory=list)


class GameTrend(BaseModel):
    gameType: str
    items: list[TrendItem] = Field(default_factory=list)
```

並在既有 `StudentReportResponse` 內，`summaryByGame` 欄位之後新增一欄：

```python
class StudentReportResponse(BaseModel):
    studentKey: str
    grade: str
    caseId: str
    school: str
    totalSessions: int
    records: list[PlayRecord] = Field(default_factory=list)
    summaryByGame: list[GameSummary] = Field(default_factory=list)
    trends: list[GameTrend] = Field(default_factory=list)
```

- [ ] **Step 2: 寫失敗的純函式測試**

在 `tests/test_assembly.py` 檔尾新增。`build_trends` 一併加入頂部的 import：

```python
from routers.students import (
    build_game_stats,
    build_play_records,
    build_summary_by_game,
    build_trends,
    parse_student_key,
    session_fields_from_row,
)
```

測試（沿用檔案既有的 `_assessment_row` / `_stats_row` helper）：

```python
def test_build_trends_groups_by_game_type_sorted():
    records = build_play_records(
        [_assessment_row("u1", "TGAME"), _assessment_row("u2", "DCCS")],
        {"u1": _stats_row("u1"), "u2": _stats_row("u2")},
    )

    trends = build_trends(records)

    assert [t.gameType for t in trends] == ["DCCS", "TGame"]


def test_build_trends_has_three_metric_items_in_fixed_order():
    records = build_play_records([_assessment_row()], {"u1": _stats_row()})

    trends = build_trends(records)

    assert [i.type for i in trends[0].items] == [
        "correctCount",
        "wrongCount",
        "accuracy",
    ]


def test_build_trends_orders_points_old_to_new():
    row_old = _assessment_row("old")
    row_old["start_time"] = datetime(2026, 7, 1, 9, 0, 0)
    row_new = _assessment_row("new")
    row_new["start_time"] = datetime(2026, 7, 8, 9, 0, 0)
    # 刻意把新的排在輸入的前面，證明是 build_trends 在升冪排序
    records = build_play_records(
        [row_new, row_old],
        {"new": _stats_row("new"), "old": _stats_row("old")},
    )

    times = [p.time for p in build_trends(records)[0].items[0].stats]

    assert times == ["2026-07-01 09:00:00", "2026-07-08 09:00:00"]


def test_build_trends_skips_records_without_stats():
    records = build_play_records(
        [_assessment_row("u1"), _assessment_row("u2")],
        {"u1": _stats_row("u1")},  # u2 無 stats
    )

    trends = build_trends(records)

    # 兩筆都是 DCCS，只有 u1 有 stats：每條序列只剩 1 個點
    assert len(trends[0].items[0].stats) == 1


def test_build_trends_pulls_correct_value_per_metric_and_preserves_types():
    records = build_play_records(
        [_assessment_row("u1")],
        {"u1": _stats_row("u1", correct=8, accuracy=0.8)},
    )

    items = {i.type: i for i in build_trends(records)[0].items}

    assert items["correctCount"].stats[0].value == 8
    assert isinstance(items["correctCount"].stats[0].value, int)
    assert items["accuracy"].stats[0].value == 0.8
    assert isinstance(items["accuracy"].stats[0].value, float)


def test_build_trends_of_empty_records_is_empty():
    assert build_trends([]) == []


def test_build_trends_of_records_all_without_stats_is_empty():
    records = build_play_records([_assessment_row()], {})

    assert build_trends(records) == []
```

- [ ] **Step 3: 執行測試，確認失敗**

Run: `.venv/bin/python -m pytest tests/test_assembly.py -k build_trends -v`
Expected: 蒐集階段即報 `ImportError: cannot import name 'build_trends'`（`build_trends` 尚未定義）。

- [ ] **Step 4: 實作 build_trends**

在 `routers/students.py`，`build_summary_by_game` 之後新增。先確認 import 區塊已含 `GameTrend`、`TrendItem`、`TrendPoint`（若無則補進既有 `from models import (...)`）：

```python
TREND_METRICS = ("correctCount", "wrongCount", "accuracy")  # 固定順序


def build_trends(records: list[PlayRecord]) -> list[GameTrend]:
    """把 records 依 gameType × 指標 pivot 成時間序列。純函式。

    stats 為 None 的場次沒有數值可畫，整筆略過。gameType 依字母排序，
    每條序列由舊到新（startTime 為 YYYY-MM-DD HH:MM:SS，字典序即時間序）。
    """
    grouped: dict[str, list[PlayRecord]] = {}
    for record in records:
        if record.stats is None:
            continue
        grouped.setdefault(record.gameType, []).append(record)

    trends: list[GameTrend] = []
    for game_type in sorted(grouped):
        ordered = sorted(grouped[game_type], key=lambda r: r.startTime)
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

在 `routers/students.py` 頂部的 `from models import (...)` 加入三個新名稱：

```python
from models import (
    GameStats,
    GameSummary,
    GameTrend,
    PlayRecord,
    SessionItem,
    SessionsResponse,
    StudentListItem,
    StudentListResponse,
    StudentReportResponse,
    TrendItem,
    TrendPoint,
)
```

- [ ] **Step 5: 執行測試，確認通過**

Run: `.venv/bin/python -m pytest tests/test_assembly.py -k build_trends -v`
Expected: 7 個測試全數 PASS。

若 `test_..._preserves_types` 失敗（例如 `isinstance(8, float)` 因 Pydantic 把 int 轉成 float），代表 `value` 未保留原生型別 —— 確認欄位型別是 `int | float`（順序 int 在前），Pydantic v2 的 smart union 會保留傳入的原生型別。

- [ ] **Step 6: 執行整包 assembly 測試，確認無回歸**

Run: `.venv/bin/python -m pytest tests/test_assembly.py -v`
Expected: 既有測試 + 新增 7 個全數 PASS。

- [ ] **Step 7: Commit**

```bash
git add models.py routers/students.py tests/test_assembly.py
git commit -m "feat: add build_trends pivoting report records into time series"
```

---

## Task 2: 把 trends 掛進 /report 端點

**Files:**
- Modify: `routers/students.py`（`get_student_report` handler 的回應加一欄）
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `build_trends(records) -> list[GameTrend]`（Task 1）；既有 `get_student_report` 已算出的 `records`。
- Produces: `/report` 回應多一個 `trends` 欄位（結構見下方測試）。

- [ ] **Step 1: 寫失敗的端點測試**

在 `tests/test_api.py` 檔尾（`/report` 相關測試附近）新增。此測試刻意讓兩場資料的 `start_time` 一新一舊，且 `records` 本身是 DESC，用來證明 `trends` 有做升冪排序：

```python
def test_report_includes_trends_ascending_by_time(client, db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u_old", game_type="DCCS",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
    )
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u_new", game_type="DCCS",
        start_time=datetime(2026, 7, 8, 9, 0, 0),
    )
    db.insert_result(
        "dccs_result", "G1", "S03", "測試場域", "u_old",
        correct_count=8, wrong_count=2, accuracy=0.8, duration=12000.0, stage=10,
    )
    db.insert_result(
        "dccs_result", "G1", "S03", "測試場域", "u_new",
        correct_count=15, wrong_count=1, accuracy=0.95, duration=9000.0, stage=12,
    )

    body = client.get(
        "/api/students/G1_S03/report", params={"school": "測試場域"}
    ).json()

    assert body["trends"] == [
        {
            "gameType": "DCCS",
            "items": [
                {
                    "type": "correctCount",
                    "stats": [
                        {"time": "2026-07-01 09:00:00", "value": 8},
                        {"time": "2026-07-08 09:00:00", "value": 15},
                    ],
                },
                {
                    "type": "wrongCount",
                    "stats": [
                        {"time": "2026-07-01 09:00:00", "value": 2},
                        {"time": "2026-07-08 09:00:00", "value": 1},
                    ],
                },
                {
                    "type": "accuracy",
                    "stats": [
                        {"time": "2026-07-01 09:00:00", "value": 0.8},
                        {"time": "2026-07-08 09:00:00", "value": 0.95},
                    ],
                },
            ],
        }
    ]


def test_report_session_without_stats_has_empty_trends(client, db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u1", game_type="DCCS",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
    )  # 無對應 dccs_result 列

    body = client.get(
        "/api/students/G1_S03/report", params={"school": "測試場域"}
    ).json()

    assert body["trends"] == []
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `.venv/bin/python -m pytest tests/test_api.py -k trends -v`
Expected: 兩個測試 FAIL。`test_report_includes_trends_ascending_by_time` 因回應無 `trends` 鍵而 `KeyError`；`test_report_session_without_stats_has_empty_trends` 同理。

（若未設定 `TEST_DB_NAME`，這兩個需要資料庫的測試會 SKIP —— 屆時改在有測試庫的環境跑。）

- [ ] **Step 3: 在 handler 掛上 trends**

在 `routers/students.py` 的 `get_student_report`，把回應改為多一欄 `trends`：

```python
    return StudentReportResponse(
        studentKey=student_key,
        grade=grade,
        caseId=case_id,
        school=school,
        totalSessions=len(records),
        records=records,
        summaryByGame=build_summary_by_game(records),
        trends=build_trends(records),
    )
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `.venv/bin/python -m pytest tests/test_api.py -k trends -v`
Expected: 兩個測試 PASS。

- [ ] **Step 5: 執行整包測試，確認無回歸**

Run: `.venv/bin/python -m pytest tests/ -v`
Expected: 全數 PASS（既有 `test_report_includes_stats_and_summary` 只斷言 `records` 與 `summaryByGame` 特定鍵，不做整體相等，故新增 `trends` 欄位不影響它）。

- [ ] **Step 6: Commit**

```bash
git add routers/students.py tests/test_api.py
git commit -m "feat: expose trends time series on GET /report"
```

---

## Self-Review

**1. Spec coverage** — 逐項對照 spec：
- 回應結構 `trends[].gameType/items[].type/stats[].{time,value}` → Task 1 模型 + Task 2 端點測試涵蓋。
- 三指標固定順序、機器鍵 → Task 1 Step 2 `test_..._three_metric_items_in_fixed_order`、`TREND_METRICS`。
- `time` 沿用 `startTime`、`value` 型別 `int | float` → Task 1 `test_..._preserves_types`、模型定義。
- 序列由舊到新 → Task 1 `test_..._orders_points_old_to_new` + Task 2 `test_..._ascending_by_time`。
- gameType 字母排序 → Task 1 `test_..._groups_by_game_type_sorted`。
- 略過 null stats → Task 1 `test_..._skips_records_without_stats`、Task 2 `test_..._empty_trends`。
- 空情況 → Task 1 `test_..._of_empty_records_is_empty`、`test_..._all_without_stats_is_empty`。
- 不動 SQL / `fetch_*` → 兩個 Task 皆只改 models / routers / tests，未觸及 `queries.py`。
- `game_type` 篩選連動 → 屬既有行為（handler 用同一批 records），無需新程式；Task 2 整包回歸測試涵蓋。

**2. Placeholder scan** — 無 TBD/TODO；每個 code step 皆為完整可貼上的程式碼與可執行指令。

**3. Type consistency** — `build_trends`、`TREND_METRICS`、`TrendPoint`/`TrendItem`/`GameTrend`、`StudentReportResponse.trends` 在各 Task 的簽名與屬性名一致；指標鍵 `correctCount`/`wrongCount`/`accuracy` 與 `GameStats` 屬性名一致（`getattr` 依此取值）。
