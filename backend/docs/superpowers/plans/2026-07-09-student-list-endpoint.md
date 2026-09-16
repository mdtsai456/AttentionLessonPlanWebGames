# 學生名單端點 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `GET /api/students` 端點，回傳學生名單、總數與每位學生的遊玩概況（含零場次學生）。

**Architecture:** 先建立測試基礎建設與既有端點的特性測試，再把 366 行的 `main.py` 拆成 `converters` / `models` / `queries` / `routers` 四層，讓「碰資料庫的程式」與「純函式」分離。拆分過程不改變任何既有行為，由先寫好的測試把關。最後統一 DB 錯誤處理，並在乾淨的結構上新增端點。

**Tech Stack:** Python 3.9、FastAPI 0.128、Pydantic v2、PyMySQL、pytest 8、httpx（TestClient）、MariaDB

**Spec:** `docs/superpowers/specs/2026-07-09-student-list-endpoint-design.md`

## Global Constraints

- **絕不污染系統 Python。** 所有套件安裝與指令執行一律走專案根目錄的 `.venv`。指令一律寫成 `.venv/bin/python`、`.venv/bin/pip`、`.venv/bin/uvicorn` 的完整路徑，**不要用 `source .venv/bin/activate`** —— 每次 Bash 呼叫都是新的 shell，activate 不會留下來。
- **`.venv` 跑的是 Python 3.12**（`brew install python@3.12`）。macOS 內建的 `/usr/bin/python3` 是 3.9，**不能用** —— Pydantic 在 3.9 上無法解析 `GameStats | None`，`import main` 會直接 `TypeError`。`from __future__ import annotations` 救不了這件事：那行只影響註記何時被求值，不影響求值時 `|` 運算子存不存在。既有 `main.py` 之所以能在 Zeabur 上運作，是因為那裡的 Python 是 3.10 以上。
- 新建的 `.py` 檔仍然加上 `from __future__ import annotations`，與既有程式一致。在 3.12 上它不是必要的，但保持一致比省一行有價值。
- **`pymysql` 目前未安裝。** 開始前先執行 `.venv/bin/pip install -r requirements.txt -r requirements-dev.txt`。
- **測試輸出必須乾淨。** `pytest.ini` 已把所有警告設為錯誤，唯一例外是 `starlette.testclient` 對 `httpx` 的棄用警告（第三方套件內部問題）。若你的改動引入新警告，測試會直接失敗 —— 那是刻意的。
- **測試資料庫名稱必須以 `_test` 結尾。** `tests/conftest.py` 的 `_assert_test_database()` 會強制檢查。
- **絕不對正式資料庫執行任何寫入。** 正式庫是 `AttentionLessonPlan`；測試庫是 `AttentionLessonPlan_test`，兩者在同一台 MariaDB 伺服器上。
- **回應欄位名稱一字不可改**：`studentKey`、`grade`、`caseId`、`school`、`sessionCount`、`lastPlayedAt`、`studentCount`、`students`。
- **既有兩個端點的輸入與輸出完全不變。** 唯一允許的行為變更是 Task 7 的 DB 錯誤訊息。
- **不做分頁、不做認證授權、不加學生姓名。**
- 所有 SQL 的值一律以 `%s` 參數化傳入。唯一允許以 f-string 拼入 SQL 的是表格名稱，且該名稱必須來自 `GAME_RESULT_TABLES` 白名單或測試輔助函式的呼叫端。
- 每個 Task 結束時 commit。commit message 結尾加上：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

## File Structure

| 檔案 | 職責 |
|---|---|
| `main.py` | 建立 app、掛載 router、`/` 與 `/health` |
| `db.py` | 連線設定（本計畫完全不修改） |
| `converters.py` | 純轉換工具：datetime 格式化、數值轉型、game_type 對應表 |
| `models.py` | 所有 Pydantic 回應模型 |
| `queries.py` | 所有 SQL。**唯一碰資料庫的模組** |
| `routers/__init__.py` | 空檔，讓 `routers` 成為 package |
| `routers/students.py` | 三個 `/api/students` 路由 + rows → models 的純組裝函式 |
| `pytest.ini` | pytest 設定：`pythonpath = .`（讓測試能 `import main`） |
| `requirements-dev.txt` | `pytest`、`httpx` |
| `tests/schema.sql` | 測試庫建表 DDL |
| `tests/conftest.py` | 安全閥、連線、建表、每個測試前後清空、插入資料的輔助函式 |
| `tests/test_guard.py` | 驗證安全閥本身（不碰資料庫） |
| `tests/test_converters.py` | 純函式測試（不碰資料庫） |
| `tests/test_assembly.py` | rows → models 的組裝邏輯（不碰資料庫） |
| `tests/test_queries.py` | SQL 行為（碰測試資料庫） |
| `tests/test_api.py` | 端點層行為（TestClient + 測試資料庫） |

## Task 順序的理由

Task 1–2 先建立安全網。Task 3–6 是純搬移，行為不變，由 Task 2 的測試把關。Task 7 是唯一對既有端點的行為變更。Task 8–9 才是新功能。

**不要跳過 Task 2 直接重構。** 沒有特性測試的搬移，錯誤只會在 code review 或正式環境才被發現。

---

### Task 1: 測試基礎建設

**Files:**
- Create: `requirements-dev.txt`
- Create: `pytest.ini`
- Create: `tests/schema.sql`
- Create: `tests/conftest.py`
- Create: `tests/test_guard.py`
- Create: `tests/test_db_fixture.py`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `db.get_connection()`（既有）
- Produces:
  - `tests/conftest.py::_assert_test_database(name: str) -> None`
  - pytest fixture `db` → `DbHelper` 實例，方法為：
    - `DbHelper.query(sql: str, params: list | None = None) -> list[dict]`
    - `DbHelper.execute(sql: str, params: list | None = None) -> None`
    - `DbHelper.insert_student(grade: str, case_id: str, school: str) -> None`
    - `DbHelper.insert_session(grade, case_id, school, uuid, game_type="DCCS", start_time=None, end_time=None, current_day=1) -> None`
    - `DbHelper.insert_result(table: str, grade, case_id, school, uuid, **columns) -> None`
  - pytest fixture `client` → `fastapi.testclient.TestClient`

- [ ] **Step 0: 確認 venv 存在，並把它排除在版控外**

`.venv/` 已經建立好了。確認它在，並把它加進 `.gitignore`：

```bash
.venv/bin/python --version
```

Expected: `Python 3.9.6`

在 `.gitignore` 末尾加上一行：

```
.venv/
```

- [ ] **Step 1: 安裝相依套件並建立 `requirements-dev.txt`**

`pymysql` 目前沒裝，本地連 `import main` 都會失敗。

建立 `requirements-dev.txt`：

```
pytest>=7.0.0
httpx>=0.27.0
```

安裝：

```bash
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
```

驗證：

```bash
.venv/bin/python -c "import pymysql, pytest, httpx; print('deps ok')"
```

Expected: `deps ok`

- [ ] **Step 2: 建立 `pytest.ini`**

沒有這個檔案，`tests/` 底下的測試無法 `import main`（pytest 只會把 `tests/` 放進 `sys.path`，不會放專案根目錄）。

```ini
[pytest]
pythonpath = .
testpaths = tests
```

- [ ] **Step 3: 在 `.env.example` 末尾加上測試庫設定**

```
TEST_DB_NAME=AttentionLessonPlan_test
```

然後在你自己的 `.env` 裡也加上同一行。`.env` 已在 `.gitignore` 中，不會進版控。

- [ ] **Step 4: 在 MariaDB 伺服器上建立測試資料庫**

```bash
.venv/bin/python - <<'PY'
import os
import pymysql
from dotenv import load_dotenv

load_dotenv()
connection = pymysql.connect(
    host=os.environ["DB_HOST"],
    port=int(os.environ["DB_PORT"]),
    user=os.environ["DB_USER"],
    password=os.environ["DB_PASSWORD"],
    charset="utf8mb4",
)
with connection.cursor() as cursor:
    cursor.execute(
        "CREATE DATABASE IF NOT EXISTS AttentionLessonPlan_test "
        "CHARACTER SET utf8mb4"
    )
connection.close()
print("AttentionLessonPlan_test 已建立")
PY
```

Expected: `AttentionLessonPlan_test 已建立`

這個指令只建立資料庫，不建表。表由 `tests/conftest.py` 從 `tests/schema.sql` 建立。

- [ ] **Step 5: 建立 `tests/schema.sql`**

內容取自正式庫 DDL，移除資料庫名稱前綴，並改為 `CREATE TABLE IF NOT EXISTS`。建表順序必須是父表在前（`student` → `assessment_result` → 五張細部表），否則外鍵會建不起來。

```sql
-- 測試資料庫的結構，取自正式庫 DDL。
-- 建表順序必須是父表在前，否則外鍵建立會失敗。

CREATE TABLE IF NOT EXISTS `student` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `assessment_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `start_time` datetime NOT NULL,
  `game_type` varchar(20) NOT NULL,
  `current_day` int(11) NOT NULL,
  `end_time` datetime DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_assessment_student` FOREIGN KEY (`grade`, `case_id`, `school`)
    REFERENCES `student` (`grade`, `case_id`, `school`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `dccs_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `correct_count` int(11) DEFAULT NULL,
  `wrong_count` int(11) DEFAULT NULL,
  `accuracy` double DEFAULT NULL,
  `duration` double DEFAULT NULL,
  `stage` int(11) DEFAULT NULL,
  `levelsPlayed` varchar(255) DEFAULT NULL,
  `frameWrongCount` int(11) DEFAULT NULL,
  `categoryWrongCount` int(11) DEFAULT NULL,
  `modelWrongCount` int(11) DEFAULT NULL,
  `frameCorrectCount` int(11) DEFAULT NULL,
  `categoryCorrectCount` int(11) DEFAULT NULL,
  `modelCorrectCount` int(11) DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_dccs_assessment` FOREIGN KEY (`grade`, `case_id`, `school`, `uuid`)
    REFERENCES `assessment_result` (`grade`, `case_id`, `school`, `uuid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `dat_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `correct_count` int(11) DEFAULT NULL,
  `wrong_count` int(11) DEFAULT NULL,
  `accuracy` double DEFAULT NULL,
  `duration` double DEFAULT NULL,
  `stage` int(11) DEFAULT NULL,
  `DAT_avgReactionTime` double DEFAULT NULL,
  `levelsPlayed` varchar(255) DEFAULT NULL,
  `DAT_outOfTarget` int(11) DEFAULT NULL,
  `DAT_wrongClickWhenShouldNot` int(11) DEFAULT NULL,
  `DAT_missedClickWhenShouldClick` int(11) DEFAULT NULL,
  `DAT_wrongMathAnswer` int(11) DEFAULT NULL,
  `DAT_wrongColorMatch` int(11) DEFAULT NULL,
  `DAT_wrongColorText` int(11) DEFAULT NULL,
  `DAT_correctClickWhenShouldNot` int(11) DEFAULT NULL,
  `DAT_correctClickWhenShouldClick` int(11) DEFAULT NULL,
  `DAT_correctMathAnswer` int(11) DEFAULT NULL,
  `DAT_correctColorMatch` int(11) DEFAULT NULL,
  `DAT_correctColorText` int(11) DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_dat_assessment` FOREIGN KEY (`grade`, `case_id`, `school`, `uuid`)
    REFERENCES `assessment_result` (`grade`, `case_id`, `school`, `uuid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `eft_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `correct_count` int(11) DEFAULT NULL,
  `wrong_count` int(11) DEFAULT NULL,
  `accuracy` double DEFAULT NULL,
  `duration` double DEFAULT NULL,
  `stage` int(11) DEFAULT NULL,
  `EFT_avgReactionTime` double DEFAULT NULL,
  `levelsPlayed` varchar(255) DEFAULT NULL,
  `EFT_wrongDirectionCount` int(11) DEFAULT NULL,
  `EFT_wrongColorDistractionCount` int(11) DEFAULT NULL,
  `EFT_wrongDottedLineCount` int(11) DEFAULT NULL,
  `EFT_wrongMovingBubbleCount` int(11) DEFAULT NULL,
  `EFT_correctDirectionCount` int(11) DEFAULT NULL,
  `EFT_correctColorDistractionCount` int(11) DEFAULT NULL,
  `EFT_correctDottedLineCount` int(11) DEFAULT NULL,
  `EFT_correctMovingBubbleCount` int(11) DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_eft_assessment` FOREIGN KEY (`grade`, `case_id`, `school`, `uuid`)
    REFERENCES `assessment_result` (`grade`, `case_id`, `school`, `uuid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `im_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `correct_count` int(11) DEFAULT NULL,
  `wrong_count` int(11) DEFAULT NULL,
  `accuracy` double DEFAULT NULL,
  `duration` double DEFAULT NULL,
  `stage` int(11) DEFAULT NULL,
  `levelsPlayed` varchar(255) DEFAULT NULL,
  `take_played` int(11) DEFAULT NULL,
  `take_passed` int(11) DEFAULT NULL,
  `take_failed` int(11) DEFAULT NULL,
  `place_played` int(11) DEFAULT NULL,
  `place_passed` int(11) DEFAULT NULL,
  `place_failed` int(11) DEFAULT NULL,
  `goto_played` int(11) DEFAULT NULL,
  `goto_passed` int(11) DEFAULT NULL,
  `goto_failed` int(11) DEFAULT NULL,
  `IM_stages` longtext DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_im_assessment` FOREIGN KEY (`grade`, `case_id`, `school`, `uuid`)
    REFERENCES `assessment_result` (`grade`, `case_id`, `school`, `uuid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `tgame_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `correct_count` int(11) DEFAULT NULL,
  `wrong_count` int(11) DEFAULT NULL,
  `accuracy` double DEFAULT NULL,
  `duration` double DEFAULT NULL,
  `stage` int(11) DEFAULT NULL,
  `TGame_obstacleHitCount` int(11) DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_tgame_assessment` FOREIGN KEY (`grade`, `case_id`, `school`, `uuid`)
    REFERENCES `assessment_result` (`grade`, `case_id`, `school`, `uuid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 6: 寫安全閥的失敗測試 `tests/test_guard.py`**

```python
"""驗證測試資料庫的安全閥。這個測試不碰資料庫。"""

from __future__ import annotations

import pytest

from conftest import _assert_test_database


def test_accepts_name_ending_with_test():
    _assert_test_database("AttentionLessonPlan_test")


def test_rejects_production_database_name():
    with pytest.raises(AssertionError, match="拒絕在非測試資料庫上執行"):
        _assert_test_database("AttentionLessonPlan")


def test_rejects_name_merely_containing_test():
    with pytest.raises(AssertionError, match="拒絕在非測試資料庫上執行"):
        _assert_test_database("test_AttentionLessonPlan")
```

- [ ] **Step 7: 執行測試，確認它因為 `conftest` 尚未存在而失敗**

```bash
.venv/bin/python -m pytest tests/test_guard.py -v
```

Expected: FAIL，錯誤訊息為 `ImportError: cannot import name '_assert_test_database' from 'conftest'` 或 `ModuleNotFoundError: No module named 'conftest'`

- [ ] **Step 8: 建立 `tests/conftest.py`**

```python
"""測試資料庫的連線、建表、清空與資料插入輔助。

需要環境變數 TEST_DB_NAME，且其值必須以 `_test` 結尾。
未設定時，需要資料庫的測試會被跳過，不碰資料庫的測試照常執行。
"""

from __future__ import annotations

import os
import pathlib
from datetime import datetime
from typing import Any

import pytest
from dotenv import load_dotenv

load_dotenv()

SCHEMA_PATH = pathlib.Path(__file__).parent / "schema.sql"

# 由子表往父表刪，避開外鍵限制。
TABLES_CHILD_FIRST = (
    "dat_result",
    "dccs_result",
    "eft_result",
    "im_result",
    "tgame_result",
    "assessment_result",
    "student",
)


def _assert_test_database(name: str) -> None:
    """防止測試連上正式庫並清空資料。

    這道檢查存在的理由很具體：若有人忘了設 TEST_DB_NAME，
    測試會靜默連上 AttentionLessonPlan 並 DELETE 掉 student。
    """
    assert name.endswith("_test"), f"拒絕在非測試資料庫上執行：{name}"


def _schema_statements() -> list[str]:
    raw = SCHEMA_PATH.read_text(encoding="utf-8")
    lines = [line for line in raw.splitlines() if not line.strip().startswith("--")]
    return [stmt.strip() for stmt in "\n".join(lines).split(";") if stmt.strip()]


@pytest.fixture(scope="session", autouse=True)
def point_app_at_test_db() -> Any:
    """把 DB_NAME 指向測試庫。

    db.get_db_config() 每次呼叫都會讀 os.getenv，所以在這裡改環境變數即可，
    不需要 patch 任何函式。

    沒設 TEST_DB_NAME 時回傳 None，讓不碰資料庫的測試照常執行。
    """
    name = os.getenv("TEST_DB_NAME")
    if not name:
        yield None
        return

    _assert_test_database(name)

    previous = os.environ.get("DB_NAME")
    os.environ["DB_NAME"] = name
    yield name
    if previous is None:
        os.environ.pop("DB_NAME", None)
    else:
        os.environ["DB_NAME"] = previous


@pytest.fixture(scope="session")
def db_available(point_app_at_test_db: Any) -> str:
    if point_app_at_test_db is None:
        pytest.skip("未設定 TEST_DB_NAME，跳過需要資料庫的測試")
    return point_app_at_test_db


@pytest.fixture(scope="session")
def _schema(db_available: str) -> None:
    from db import get_connection

    with get_connection() as connection:
        with connection.cursor() as cursor:
            for statement in _schema_statements():
                cursor.execute(statement)
        connection.commit()


def _truncate_all() -> None:
    from db import get_connection

    with get_connection() as connection:
        with connection.cursor() as cursor:
            for table in TABLES_CHILD_FIRST:
                cursor.execute(f"DELETE FROM {table}")
        connection.commit()


class DbHelper:
    """測試用的資料插入輔助。表格名稱由測試碼直接指定，不來自外部輸入。"""

    def query(self, sql: str, params: list | None = None) -> list[dict]:
        from db import get_connection

        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql, params or [])
                return cursor.fetchall()

    def execute(self, sql: str, params: list | None = None) -> None:
        from db import get_connection

        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql, params or [])
            connection.commit()

    def insert_student(self, grade: str, case_id: str, school: str) -> None:
        self.execute(
            "INSERT INTO student (grade, case_id, school) VALUES (%s, %s, %s)",
            [grade, case_id, school],
        )

    def insert_session(
        self,
        grade: str,
        case_id: str,
        school: str,
        uuid: str,
        game_type: str = "DCCS",
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        current_day: int = 1,
    ) -> None:
        self.execute(
            """
            INSERT INTO assessment_result
                (grade, case_id, school, uuid, start_time, game_type, current_day, end_time)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                grade,
                case_id,
                school,
                uuid,
                start_time or datetime(2026, 7, 1, 9, 0, 0),
                game_type,
                current_day,
                end_time,
            ],
        )

    def insert_result(
        self,
        table: str,
        grade: str,
        case_id: str,
        school: str,
        uuid: str,
        **columns: Any,
    ) -> None:
        names = ["grade", "case_id", "school", "uuid", *columns]
        placeholders = ", ".join(["%s"] * len(names))
        self.execute(
            f"INSERT INTO {table} ({', '.join(names)}) VALUES ({placeholders})",
            [grade, case_id, school, uuid, *columns.values()],
        )


@pytest.fixture
def db(_schema: None) -> Any:
    _truncate_all()
    yield DbHelper()
    _truncate_all()


@pytest.fixture
def client(db: DbHelper) -> Any:
    from fastapi.testclient import TestClient

    import main

    with TestClient(main.app) as test_client:
        yield test_client
```

`from db import get_connection` 刻意寫在函式內部，而不是模組頂端。理由是 `point_app_at_test_db` 必須先設好 `DB_NAME`，函式內部延後匯入可以避免任何匯入順序的意外。`db.get_db_config()` 本身每次呼叫都讀 `os.getenv`，所以即使提早匯入也不會出錯 —— 但延後匯入讓這件事不必依賴那個細節。

- [ ] **Step 9: 執行安全閥測試，確認通過**

```bash
.venv/bin/python -m pytest tests/test_guard.py -v
```

Expected: 3 passed

- [ ] **Step 10: 寫資料庫 fixture 的 smoke test `tests/test_db_fixture.py`**

```python
"""確認測試資料庫的連線、建表與清空真的能運作。"""

from __future__ import annotations

from datetime import datetime


def test_can_insert_and_read_student(db):
    db.insert_student("G1", "S03", "測試場域")

    rows = db.query("SELECT grade, case_id, school FROM student")

    assert rows == [{"grade": "G1", "case_id": "S03", "school": "測試場域"}]


def test_can_insert_session_for_student(db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1",
        "S03",
        "測試場域",
        uuid="u1",
        game_type="DCCS",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
        end_time=datetime(2026, 7, 1, 9, 30, 0),
    )

    rows = db.query("SELECT uuid, game_type, end_time FROM assessment_result")

    assert rows == [
        {
            "uuid": "u1",
            "game_type": "DCCS",
            "end_time": datetime(2026, 7, 1, 9, 30, 0),
        }
    ]


def test_each_test_starts_with_an_empty_database(db):
    """前兩個測試插入的資料不該留下來。"""
    assert db.query("SELECT COUNT(*) AS n FROM student") == [{"n": 0}]
```

- [ ] **Step 11: 執行 smoke test**

```bash
.venv/bin/python -m pytest tests/ -v
```

Expected: 6 passed（3 個 guard + 3 個 db fixture）

如果看到 `SKIPPED [1] 未設定 TEST_DB_NAME`，表示你的 `.env` 少了 `TEST_DB_NAME=AttentionLessonPlan_test`，回到 Step 3。

- [ ] **Step 12: Commit**

```bash
git add requirements-dev.txt pytest.ini .env.example tests/
git commit -m "$(cat <<'EOF'
test: add test database infrastructure

Adds pytest config, a schema.sql for AttentionLessonPlan_test, and a
conftest that refuses to run against any database not ending in _test.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 既有端點的特性測試

在搬移任何程式碼之前，先把既有兩個端點的行為釘死。這些測試**描述現況，不評判現況** —— 包含那個 `endTime` 為空字串的怪行為。

**Files:**
- Create: `tests/test_api.py`

**Interfaces:**
- Consumes: fixture `db`、fixture `client`（Task 1）
- Produces: 無（純測試）

- [ ] **Step 1: 寫特性測試 `tests/test_api.py`**

```python
"""既有端點的特性測試。

這些測試描述重構前的實際行為，包含不理想的部分（例如 endTime 的空字串），
目的是讓 Task 3–6 的搬移一旦改變行為就立刻失敗。
"""

from __future__ import annotations

from datetime import datetime


def test_root_returns_ok(client):
    response = client.get("/")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_returns_ok(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_sessions_returns_student_sessions(client, db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1",
        "S03",
        "測試場域",
        uuid="u1",
        game_type="DCCS",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
        end_time=datetime(2026, 7, 1, 9, 30, 0),
        current_day=1,
    )

    response = client.get(
        "/api/students/G1_S03/sessions", params={"school": "測試場域"}
    )

    assert response.status_code == 200
    assert response.json() == {
        "studentKey": "G1_S03",
        "grade": "G1",
        "caseId": "S03",
        "school": "測試場域",
        "sessions": [
            {
                "sessionId": "u1",
                "gameType": "DCCS",
                "currentDay": 1,
                "startTime": "2026-07-01 09:00:00",
                "endTime": "2026-07-01 09:30:00",
            }
        ],
    }


def test_sessions_rejects_malformed_student_key(client, db):
    response = client.get("/api/students/G1/sessions", params={"school": "測試場域"})

    assert response.status_code == 400
    assert "studentKey" in response.json()["detail"]


def test_sessions_of_unknown_student_is_empty_not_404(client, db):
    response = client.get(
        "/api/students/G9_S99/sessions", params={"school": "測試場域"}
    )

    assert response.status_code == 200
    assert response.json()["sessions"] == []


def test_unfinished_session_end_time_is_empty_string(client, db):
    """記錄既有行為：end_time 為 NULL 時回傳空字串，而非 null。

    這是已知債務，本次不修改。新端點的 lastPlayedAt 使用 null。
    """
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1",
        "S03",
        "測試場域",
        uuid="u1",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
        end_time=None,
    )

    response = client.get(
        "/api/students/G1_S03/sessions", params={"school": "測試場域"}
    )

    assert response.json()["sessions"][0]["endTime"] == ""


def test_sessions_filters_by_game_type_and_normalizes_tgame(client, db):
    """Unity 送 TGame，資料庫存 TGAME，回應要送回 TGame。"""
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u1", game_type="TGAME",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
    )
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u2", game_type="DCCS",
        start_time=datetime(2026, 7, 2, 9, 0, 0),
    )

    response = client.get(
        "/api/students/G1_S03/sessions",
        params={"school": "測試場域", "game_type": "TGame"},
    )

    sessions = response.json()["sessions"]
    assert len(sessions) == 1
    assert sessions[0]["sessionId"] == "u1"
    assert sessions[0]["gameType"] == "TGame"


def test_report_includes_stats_and_summary(client, db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u1", game_type="DCCS",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
        end_time=datetime(2026, 7, 1, 9, 30, 0),
    )
    db.insert_result(
        "dccs_result", "G1", "S03", "測試場域", "u1",
        correct_count=8, wrong_count=2, accuracy=0.8, duration=12000.0, stage=10,
    )

    response = client.get(
        "/api/students/G1_S03/report", params={"school": "測試場域"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["totalSessions"] == 1
    assert body["records"][0]["stats"] == {
        "correctCount": 8,
        "wrongCount": 2,
        "accuracy": 0.8,
        "duration": 12000.0,
        "stage": 10,
    }
    assert body["summaryByGame"] == [
        {
            "gameType": "DCCS",
            "sessionCount": 1,
            "totalCorrect": 8,
            "totalWrong": 2,
            "avgAccuracy": 0.8,
            "totalDuration": 12000.0,
        }
    ]


def test_report_session_without_stats_row_has_null_stats(client, db):
    """assessment_result 有列，但細部表沒有對應列。"""
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u1", game_type="DCCS",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
    )

    response = client.get(
        "/api/students/G1_S03/report", params={"school": "測試場域"}
    )

    body = response.json()
    assert body["records"][0]["stats"] is None
    assert body["summaryByGame"] == [
        {
            "gameType": "DCCS",
            "sessionCount": 1,
            "totalCorrect": 0,
            "totalWrong": 0,
            "avgAccuracy": 0.0,
            "totalDuration": 0.0,
        }
    ]


def test_sessions_are_ordered_by_start_time_descending(client, db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="old",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
    )
    db.insert_session(
        "G1", "S03", "測試場域", uuid="new",
        start_time=datetime(2026, 7, 8, 9, 0, 0),
    )

    response = client.get(
        "/api/students/G1_S03/sessions", params={"school": "測試場域"}
    )

    ids = [s["sessionId"] for s in response.json()["sessions"]]
    assert ids == ["new", "old"]
```

- [ ] **Step 2: 執行測試，全部應該通過**

這些測試描述的是**現有**行為，所以應該立刻全綠。如果有任何一個失敗，表示你對現有行為的理解錯了 —— 停下來，修正測試以符合實際行為，不要修改 `main.py`。

```bash
.venv/bin/python -m pytest tests/test_api.py -v
```

Expected: 10 passed

- [ ] **Step 3: Commit**

```bash
git add tests/test_api.py
git commit -m "$(cat <<'EOF'
test: pin down existing endpoint behaviour before refactor

Characterization tests for /, /health, /sessions and /report, including
the empty-string endTime that we are deliberately not changing yet.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 抽出 `converters.py`

純搬移。函式內容一字不改。

**Files:**
- Create: `converters.py`
- Create: `tests/test_converters.py`
- Modify: `main.py`（刪除 `GAME_TYPE_TO_DB`、`GAME_TYPE_FROM_DB`、`normalize_game_type_for_db`、`normalize_game_type_from_db`、`format_datetime`、`to_int`、`to_float`，改為匯入）

**Interfaces:**
- Consumes: 無
- Produces:
  - `converters.GAME_TYPE_TO_DB: dict[str, str]`
  - `converters.GAME_TYPE_FROM_DB: dict[str, str]`
  - `converters.normalize_game_type_for_db(game_type: str | None) -> str | None`
  - `converters.normalize_game_type_from_db(game_type: str) -> str`
  - `converters.format_datetime(value: Any) -> str`
  - `converters.to_int(value: Any) -> int`
  - `converters.to_float(value: Any) -> float`

- [ ] **Step 1: 寫 `tests/test_converters.py`**

```python
"""converters 的純函式測試。不碰資料庫。"""

from __future__ import annotations

from datetime import datetime

import pytest

from converters import (
    format_datetime,
    normalize_game_type_for_db,
    normalize_game_type_from_db,
    to_float,
    to_int,
)


def test_format_datetime_of_none_is_empty_string():
    """既有行為，新端點不使用這個函式處理可空的日期。"""
    assert format_datetime(None) == ""


def test_format_datetime_uses_space_separator_and_second_precision():
    assert format_datetime(datetime(2026, 7, 1, 9, 0, 0)) == "2026-07-01 09:00:00"


def test_format_datetime_drops_microseconds():
    assert format_datetime(datetime(2026, 7, 1, 9, 0, 0, 123456)) == "2026-07-01 09:00:00"


def test_format_datetime_of_string_passes_through():
    assert format_datetime("2026-07-01") == "2026-07-01"


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("TGame", "TGAME"),
        ("TGAME", "TGAME"),
        ("dccs", "DCCS"),
        ("  DAT  ", "DAT"),
        (None, None),
        ("", None),
        ("   ", None),
    ],
)
def test_normalize_game_type_for_db(given, expected):
    assert normalize_game_type_for_db(given) == expected


def test_normalize_game_type_from_db_maps_tgame_back():
    assert normalize_game_type_from_db("TGAME") == "TGame"


def test_normalize_game_type_from_db_passes_others_through():
    assert normalize_game_type_from_db("DCCS") == "DCCS"


def test_to_int_of_none_is_zero():
    assert to_int(None) == 0


def test_to_int_converts():
    assert to_int("7") == 7


def test_to_float_of_none_is_zero():
    assert to_float(None) == 0.0


def test_to_float_converts():
    assert to_float(3) == 3.0
```

- [ ] **Step 2: 執行測試，確認失敗**

```bash
.venv/bin/python -m pytest tests/test_converters.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'converters'`

- [ ] **Step 3: 建立 `converters.py`**

內容從 `main.py` 逐字搬過來。

```python
"""純轉換工具。不依賴 FastAPI，也不碰資料庫。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

# Unity 的 TGame 在 DB 存為 TGAME
GAME_TYPE_TO_DB = {"TGame": "TGAME", "TGAME": "TGAME"}
GAME_TYPE_FROM_DB = {"TGAME": "TGame"}


def normalize_game_type_for_db(game_type: str | None) -> str | None:
    if not game_type or not game_type.strip():
        return None

    normalized = game_type.strip()
    return GAME_TYPE_TO_DB.get(normalized, normalized.upper())


def normalize_game_type_from_db(game_type: str) -> str:
    return GAME_TYPE_FROM_DB.get(game_type, game_type)


def format_datetime(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    return str(value)


def to_int(value: Any) -> int:
    return 0 if value is None else int(value)


def to_float(value: Any) -> float:
    return 0.0 if value is None else float(value)
```

- [ ] **Step 4: 從 `main.py` 刪除已搬走的定義，改為匯入**

刪除 `main.py` 中這些定義：`GAME_TYPE_TO_DB`、`GAME_TYPE_FROM_DB`、`normalize_game_type_for_db`、`normalize_game_type_from_db`、`format_datetime`、`to_int`、`to_float`（含其註解）。

在 `from db import get_connection` 之後加上：

```python
from converters import (
    format_datetime,
    normalize_game_type_for_db,
    normalize_game_type_from_db,
    to_float,
    to_int,
)
```

`main.py` 仍需保留 `from datetime import datetime`？**不需要** —— 刪除 `format_datetime` 之後 `main.py` 不再直接使用 `datetime`。一併移除該匯入。

- [ ] **Step 5: 執行全部測試**

```bash
.venv/bin/python -m pytest tests/ -v
```

Expected: 全部通過（Task 2 的 10 個 API 測試證明搬移沒改變行為）

- [ ] **Step 6: Commit**

```bash
git add converters.py main.py tests/test_converters.py
git commit -m "$(cat <<'EOF'
refactor: extract pure converters out of main

No behaviour change. Converters have no FastAPI or database dependency,
so they can be tested without either.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 抽出 `models.py`

純搬移。模型定義一字不改。

**Files:**
- Create: `models.py`
- Modify: `main.py`（刪除六個 Pydantic 類別，改為匯入）

**Interfaces:**
- Consumes: 無
- Produces: `models.SessionItem`、`models.SessionsResponse`、`models.GameStats`、`models.PlayRecord`、`models.GameSummary`、`models.StudentReportResponse`

- [ ] **Step 1: 建立 `models.py`**

```python
"""所有 API 回應模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class SessionItem(BaseModel):
    sessionId: str
    gameType: str
    currentDay: int
    startTime: str
    endTime: str


class SessionsResponse(BaseModel):
    studentKey: str
    grade: str
    caseId: str
    school: str
    sessions: list[SessionItem] = Field(default_factory=list)


class GameStats(BaseModel):
    correctCount: int
    wrongCount: int
    accuracy: float
    duration: float  # 毫秒
    stage: int  # 本場實際作答題數／關卡數


class PlayRecord(SessionItem):
    stats: GameStats | None = None


class GameSummary(BaseModel):
    gameType: str
    sessionCount: int
    totalCorrect: int
    totalWrong: int
    avgAccuracy: float
    totalDuration: float


class StudentReportResponse(BaseModel):
    studentKey: str
    grade: str
    caseId: str
    school: str
    totalSessions: int
    records: list[PlayRecord] = Field(default_factory=list)
    summaryByGame: list[GameSummary] = Field(default_factory=list)
```

`from __future__ import annotations` 在這裡不是風格問題。Python 3.9 沒有 `X | None` 的執行期語法，少了這行，`PlayRecord` 的 `stats: GameStats | None` 會在匯入時直接 `TypeError`。

- [ ] **Step 2: 從 `main.py` 刪除六個模型類別，改為匯入**

刪除 `SessionItem`、`SessionsResponse`、`GameStats`、`PlayRecord`、`GameSummary`、`StudentReportResponse` 的定義（含 `# --- 回應模型 ---` 區塊註解）。

加上：

```python
from models import (
    GameStats,
    GameSummary,
    PlayRecord,
    SessionItem,
    SessionsResponse,
    StudentReportResponse,
)
```

刪除 `from pydantic import BaseModel, Field` —— `main.py` 已不再需要。

- [ ] **Step 3: 執行全部測試**

```bash
.venv/bin/python -m pytest tests/ -v
```

Expected: 全部通過

- [ ] **Step 4: 額外確認 app 能正常匯入**

```bash
.venv/bin/python -c "import main; print(sorted(r.path for r in main.app.routes if hasattr(r, 'path')))"
```

Expected: 包含 `/`、`/health`、`/api/students/{student_key}/report`、`/api/students/{student_key}/sessions`

- [ ] **Step 5: Commit**

```bash
git add models.py main.py
git commit -m "$(cat <<'EOF'
refactor: extract response models out of main

No behaviour change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 抽出 `queries.py`，並拆開 `build_play_records`

`queries.py` 成為唯一碰資料庫的模組。同時把 `build_play_records` 裡「查詢遊戲細部表」的部分抽成 `fetch_stats_for_rows`，讓剩下的合併邏輯變成純函式。

**Files:**
- Create: `queries.py`
- Create: `tests/test_queries.py`
- Modify: `main.py`

**Interfaces:**
- Consumes: `db.get_connection()`、fixture `db`
- Produces:
  - `queries.GAME_RESULT_TABLES: dict[str, str]`
  - `queries.CORE_STAT_COLUMNS: tuple[str, ...]`
  - `queries.fetch_assessment_rows(grade: str, case_id: str, school: str, game_type: str | None = None) -> list[dict]`
  - `queries.fetch_game_stats_by_uuids(table_name: str, uuids: list[str]) -> dict[str, dict]`
  - `queries.fetch_stats_for_rows(rows: list[dict]) -> dict[str, dict]` —— key 為 `uuid`

- [ ] **Step 1: 寫 `tests/test_queries.py`**

```python
"""queries 的 SQL 行為測試。需要測試資料庫。"""

from __future__ import annotations

from datetime import datetime

import queries


def test_fetch_assessment_rows_returns_only_matching_student(db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_student("G1", "S04", "測試場域")
    db.insert_session("G1", "S03", "測試場域", uuid="u1")
    db.insert_session("G1", "S04", "測試場域", uuid="u2")

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域")

    assert [row["uuid"] for row in rows] == ["u1"]


def test_fetch_assessment_rows_filters_by_game_type(db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session("G1", "S03", "測試場域", uuid="u1", game_type="DCCS")
    db.insert_session("G1", "S03", "測試場域", uuid="u2", game_type="TGAME")

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域", game_type="TGAME")

    assert [row["uuid"] for row in rows] == ["u2"]


def test_fetch_assessment_rows_orders_by_start_time_descending(db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="old", start_time=datetime(2026, 7, 1, 9, 0, 0)
    )
    db.insert_session(
        "G1", "S03", "測試場域", uuid="new", start_time=datetime(2026, 7, 8, 9, 0, 0)
    )

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域")

    assert [row["uuid"] for row in rows] == ["new", "old"]


def test_fetch_stats_for_rows_groups_by_game_type_across_tables(db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session("G1", "S03", "測試場域", uuid="u1", game_type="DCCS")
    db.insert_session("G1", "S03", "測試場域", uuid="u2", game_type="TGAME")
    db.insert_result(
        "dccs_result", "G1", "S03", "測試場域", "u1",
        correct_count=8, wrong_count=2, accuracy=0.8, duration=1000.0, stage=10,
    )
    db.insert_result(
        "tgame_result", "G1", "S03", "測試場域", "u2",
        correct_count=5, wrong_count=1, accuracy=0.83, duration=2000.0, stage=6,
    )

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域")
    stats = queries.fetch_stats_for_rows(rows)

    assert set(stats) == {"u1", "u2"}
    assert stats["u1"]["correct_count"] == 8
    assert stats["u2"]["correct_count"] == 5


def test_fetch_stats_for_rows_skips_sessions_without_stats_row(db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session("G1", "S03", "測試場域", uuid="u1", game_type="DCCS")

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域")
    stats = queries.fetch_stats_for_rows(rows)

    assert stats == {}


def test_fetch_stats_for_rows_ignores_unknown_game_type(db):
    """game_type 不在白名單裡時不該炸，只是查不到 stats。"""
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session("G1", "S03", "測試場域", uuid="u1", game_type="UNKNOWN")

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域")

    assert queries.fetch_stats_for_rows(rows) == {}


def test_fetch_stats_for_rows_of_empty_input_is_empty(db):
    assert queries.fetch_stats_for_rows([]) == {}
```

- [ ] **Step 2: 執行測試，確認失敗**

```bash
.venv/bin/python -m pytest tests/test_queries.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'queries'`

- [ ] **Step 3: 建立 `queries.py`**

```python
"""所有 SQL。這是唯一碰資料庫的模組。"""

from __future__ import annotations

from typing import Any

from db import get_connection

# assessment_result.game_type → 各遊戲細部表
GAME_RESULT_TABLES = {
    "DCCS": "dccs_result",
    "DAT": "dat_result",
    "EFT": "eft_result",
    "IM": "im_result",
    "TGAME": "tgame_result",
}

# /report 回傳的核心統計欄位（duration 單位為毫秒）
CORE_STAT_COLUMNS = (
    "correct_count",
    "wrong_count",
    "accuracy",
    "duration",
    "stage",
)


def fetch_assessment_rows(
    grade: str,
    case_id: str,
    school: str,
    game_type: str | None = None,
) -> list[dict[str, Any]]:
    """查場次索引表 assessment_result。"""
    sql = """
        SELECT uuid, game_type, current_day, start_time, end_time
        FROM assessment_result
        WHERE grade = %s AND case_id = %s AND school = %s
    """
    params: list[Any] = [grade, case_id, school]

    if game_type is not None:
        sql += " AND game_type = %s"
        params.append(game_type)

    sql += " ORDER BY start_time DESC"

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()


def fetch_game_stats_by_uuids(
    table_name: str,
    uuids: list[str],
) -> dict[str, dict[str, Any]]:
    """依 uuid 批次查遊戲細部表。

    table_name 以 f-string 拼入 SQL，這是安全的，因為它的唯一來源是
    GAME_RESULT_TABLES 白名單的值，不會來自外部輸入。uuids 仍然參數化。
    """
    if not uuids:
        return {}

    placeholders = ", ".join(["%s"] * len(uuids))
    sql = f"""
        SELECT uuid, {", ".join(CORE_STAT_COLUMNS)}
        FROM {table_name}
        WHERE uuid IN ({placeholders})
    """

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, uuids)
            rows = cursor.fetchall()

    return {row["uuid"]: row for row in rows}


def fetch_stats_for_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """把場次列依 game_type 分組，逐表查出統計，合成 uuid → stats row。

    這是 build_play_records 裡唯一碰資料庫的部分，抽出來之後，
    合併邏輯就成為可以餵 dict 測試的純函式。
    """
    stats_by_uuid: dict[str, dict[str, Any]] = {}
    uuids_by_game_type: dict[str, list[str]] = {}

    for row in rows:
        uuids_by_game_type.setdefault(row["game_type"], []).append(row["uuid"])

    for db_game_type, uuids in uuids_by_game_type.items():
        table_name = GAME_RESULT_TABLES.get(db_game_type)
        if table_name is None:
            continue
        stats_by_uuid.update(fetch_game_stats_by_uuids(table_name, uuids))

    return stats_by_uuid
```

- [ ] **Step 4: 修改 `main.py`**

刪除：`GAME_RESULT_TABLES`、`CORE_STAT_COLUMNS`、`fetch_assessment_rows`、`fetch_game_stats_by_uuids` 的定義，以及 `from db import get_connection`。

加上：

```python
import queries
```

把 `build_play_records` 改成純函式（多接一個參數）：

```python
def build_play_records(
    rows: list[dict[str, Any]],
    stats_by_uuid: dict[str, dict[str, Any]],
) -> list[PlayRecord]:
    """合併場次索引與各遊戲細部統計。純函式，不碰資料庫。"""
    return [
        PlayRecord(
            **session_fields_from_row(row),
            stats=build_game_stats(stats_by_uuid.get(row["uuid"])),
        )
        for row in rows
    ]
```

把兩個路由裡呼叫的地方改掉：

`list_student_sessions` 中：

```python
        rows = queries.fetch_assessment_rows(
            grade, case_id, school, normalize_game_type_for_db(game_type)
        )
```

`get_student_report` 中：

```python
        rows = queries.fetch_assessment_rows(
            grade, case_id, school, normalize_game_type_for_db(game_type)
        )
        records = build_play_records(rows, queries.fetch_stats_for_rows(rows))
```

- [ ] **Step 5: 執行全部測試**

```bash
.venv/bin/python -m pytest tests/ -v
```

Expected: 全部通過。Task 2 的 `test_report_includes_stats_and_summary` 和 `test_report_session_without_stats_row_has_null_stats` 證明 `build_play_records` 的拆分沒有改變行為。

- [ ] **Step 6: Commit**

```bash
git add queries.py main.py tests/test_queries.py
git commit -m "$(cat <<'EOF'
refactor: extract queries module and split build_play_records

fetch_stats_for_rows now owns the database access that used to live inside
build_play_records, leaving the merge as a pure function.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 抽出 `routers/students.py`，`main.py` 瘦身

**Files:**
- Create: `routers/__init__.py`
- Create: `routers/students.py`
- Create: `tests/test_assembly.py`
- Modify: `main.py`（縮減為 app 建立、掛載 router、`/`、`/health`）

**Interfaces:**
- Consumes: `converters`、`models`、`queries`
- Produces:
  - `routers.students.router: APIRouter`
  - `routers.students.parse_student_key(student_key: str) -> tuple[str, str]`
  - `routers.students.session_fields_from_row(row: dict) -> dict`
  - `routers.students.build_game_stats(row: dict | None) -> GameStats | None`
  - `routers.students.build_play_records(rows: list[dict], stats_by_uuid: dict[str, dict]) -> list[PlayRecord]`
  - `routers.students.build_summary_by_game(records: list[PlayRecord]) -> list[GameSummary]`

- [ ] **Step 1: 寫 `tests/test_assembly.py`**

這些測試餵 dict，完全不碰資料庫。

```python
"""rows → models 的組裝邏輯。純函式，不碰資料庫。"""

from __future__ import annotations

from datetime import datetime

import pytest
from fastapi import HTTPException

from routers.students import (
    build_game_stats,
    build_play_records,
    build_summary_by_game,
    parse_student_key,
    session_fields_from_row,
)


def _assessment_row(uuid: str = "u1", game_type: str = "DCCS") -> dict:
    return {
        "uuid": uuid,
        "game_type": game_type,
        "current_day": 1,
        "start_time": datetime(2026, 7, 1, 9, 0, 0),
        "end_time": datetime(2026, 7, 1, 9, 30, 0),
    }


def _stats_row(uuid: str = "u1", correct: int = 8, accuracy: float = 0.8) -> dict:
    return {
        "uuid": uuid,
        "correct_count": correct,
        "wrong_count": 2,
        "accuracy": accuracy,
        "duration": 1000.0,
        "stage": 10,
    }


def test_parse_student_key_splits_on_first_underscore():
    assert parse_student_key("G1_S03") == ("G1", "S03")


def test_parse_student_key_keeps_later_underscores_in_case_id():
    assert parse_student_key("G1_S0_3") == ("G1", "S0_3")


@pytest.mark.parametrize("given", ["G1", "_S03", "G1_", "", "_"])
def test_parse_student_key_rejects_malformed_input(given):
    with pytest.raises(HTTPException) as exc_info:
        parse_student_key(given)
    assert exc_info.value.status_code == 400


def test_session_fields_from_row_normalizes_tgame():
    fields = session_fields_from_row(_assessment_row(game_type="TGAME"))

    assert fields["gameType"] == "TGame"
    assert fields["startTime"] == "2026-07-01 09:00:00"
    assert fields["endTime"] == "2026-07-01 09:30:00"


def test_session_fields_from_row_of_unfinished_session_has_empty_end_time():
    row = _assessment_row()
    row["end_time"] = None

    assert session_fields_from_row(row)["endTime"] == ""


def test_build_game_stats_of_none_is_none():
    assert build_game_stats(None) is None


def test_build_game_stats_converts_null_columns_to_zero():
    stats = build_game_stats(
        {
            "correct_count": None,
            "wrong_count": None,
            "accuracy": None,
            "duration": None,
            "stage": None,
        }
    )

    assert stats.correctCount == 0
    assert stats.accuracy == 0.0
    assert stats.duration == 0.0


def test_build_play_records_attaches_matching_stats():
    records = build_play_records([_assessment_row()], {"u1": _stats_row()})

    assert records[0].stats.correctCount == 8


def test_build_play_records_leaves_stats_none_when_uuid_missing():
    records = build_play_records([_assessment_row()], {})

    assert records[0].stats is None


def test_build_summary_by_game_aggregates_and_rounds_average():
    """0.1 與 0.2 是刻意挑的：它們的平均是 0.15000000000000002，不等於 0.15。

    若改用 0.8 與 0.5，平均恰好是 0.65，這個測試就無法分辨 round(..., 2)
    存不存在 —— 拿掉那行照樣通過。
    """
    records = build_play_records(
        [_assessment_row("u1"), _assessment_row("u2")],
        {
            "u1": _stats_row("u1", correct=8, accuracy=0.1),
            "u2": _stats_row("u2", correct=4, accuracy=0.2),
        },
    )

    summaries = build_summary_by_game(records)

    assert len(summaries) == 1
    assert summaries[0].gameType == "DCCS"
    assert summaries[0].sessionCount == 2
    assert summaries[0].totalCorrect == 12
    assert summaries[0].totalWrong == 4
    assert summaries[0].avgAccuracy == 0.15
    assert summaries[0].totalDuration == 2000.0


def test_build_summary_by_game_of_records_without_stats_is_all_zero():
    records = build_play_records([_assessment_row()], {})

    summaries = build_summary_by_game(records)

    assert summaries[0].sessionCount == 1
    assert summaries[0].totalCorrect == 0
    assert summaries[0].avgAccuracy == 0.0


def test_build_summary_by_game_sorts_by_game_type():
    records = build_play_records(
        [_assessment_row("u1", "TGAME"), _assessment_row("u2", "DCCS")], {}
    )

    summaries = build_summary_by_game(records)

    assert [s.gameType for s in summaries] == ["DCCS", "TGame"]
```

- [ ] **Step 2: 執行測試，確認失敗**

```bash
.venv/bin/python -m pytest tests/test_assembly.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'routers'`

- [ ] **Step 3: 建立 `routers/__init__.py`**

空檔案。

```bash
touch routers/__init__.py
```

- [ ] **Step 4: 建立 `routers/students.py`**

`parse_student_key` 留在這裡，不放進 `converters.py` —— 它會 `raise HTTPException`，那是 HTTP 層的概念，放進純工具模組會迫使該模組匯入 FastAPI。

路由使用完整路徑而非 `APIRouter(prefix=...)`，這樣路徑一眼可見，不需要在腦中拼接。

```python
"""學生相關的 API 路由，以及 rows → models 的組裝函式。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

import queries
from converters import (
    format_datetime,
    normalize_game_type_for_db,
    normalize_game_type_from_db,
    to_float,
    to_int,
)
from models import (
    GameStats,
    GameSummary,
    PlayRecord,
    SessionItem,
    SessionsResponse,
    StudentReportResponse,
)

router = APIRouter(tags=["students"])


# --- 工具函式 ---


def parse_student_key(student_key: str) -> tuple[str, str]:
    """G1_S03 → (G1, S03)"""
    parts = student_key.strip().split("_", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise HTTPException(
            status_code=400,
            detail="studentKey 格式應為 G1_S03（grade_caseId）",
        )
    return parts[0], parts[1]


def session_fields_from_row(row: dict[str, Any]) -> dict[str, Any]:
    """從 assessment_result 列取出場次共用欄位。"""
    return {
        "sessionId": row["uuid"],
        "gameType": normalize_game_type_from_db(row["game_type"]),
        "currentDay": to_int(row["current_day"]),
        "startTime": format_datetime(row["start_time"]),
        "endTime": format_datetime(row["end_time"]),
    }


def build_game_stats(row: dict[str, Any] | None) -> GameStats | None:
    """從遊戲細部表列取出遊戲統計欄位。"""
    if row is None:
        return None
    return GameStats(
        correctCount=to_int(row["correct_count"]),
        wrongCount=to_int(row["wrong_count"]),
        accuracy=to_float(row["accuracy"]),
        duration=to_float(row["duration"]),
        stage=to_int(row["stage"]),
    )


# --- report 組裝（純函式） ---


def build_play_records(
    rows: list[dict[str, Any]],
    stats_by_uuid: dict[str, dict[str, Any]],
) -> list[PlayRecord]:
    """合併場次索引與各遊戲細部統計。"""
    return [
        PlayRecord(
            **session_fields_from_row(row),
            stats=build_game_stats(stats_by_uuid.get(row["uuid"])),
        )
        for row in rows
    ]


def build_summary_by_game(records: list[PlayRecord]) -> list[GameSummary]:
    """依遊戲種類彙總多場次統計。"""
    grouped: dict[str, list[PlayRecord]] = {}
    for record in records:
        grouped.setdefault(record.gameType, []).append(record)

    summaries: list[GameSummary] = []
    for game_type, game_records in grouped.items():
        stats_list = [r.stats for r in game_records if r.stats is not None]
        if not stats_list:
            summaries.append(
                GameSummary(
                    gameType=game_type,
                    sessionCount=len(game_records),
                    totalCorrect=0,
                    totalWrong=0,
                    avgAccuracy=0.0,
                    totalDuration=0.0,
                )
            )
            continue

        summaries.append(
            GameSummary(
                gameType=game_type,
                sessionCount=len(game_records),
                totalCorrect=sum(s.correctCount for s in stats_list),
                totalWrong=sum(s.wrongCount for s in stats_list),
                avgAccuracy=round(
                    sum(s.accuracy for s in stats_list) / len(stats_list), 2
                ),
                totalDuration=sum(s.duration for s in stats_list),
            )
        )

    summaries.sort(key=lambda item: item.gameType)
    return summaries


# --- API 路由 ---


@router.get("/api/students/{student_key}/sessions", response_model=SessionsResponse)
def list_student_sessions(
    student_key: str,
    school: str = Query(..., description="場域／學校，例如：測試場域"),
    game_type: str | None = Query(
        default=None, description="可選，例如 DAT、EFT、TGame"
    ),
) -> SessionsResponse:
    grade, case_id = parse_student_key(student_key)

    try:
        rows = queries.fetch_assessment_rows(
            grade, case_id, school, normalize_game_type_for_db(game_type)
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"資料庫查詢失敗：{exc}") from exc

    return SessionsResponse(
        studentKey=student_key,
        grade=grade,
        caseId=case_id,
        school=school,
        sessions=[SessionItem(**session_fields_from_row(row)) for row in rows],
    )


@router.get("/api/students/{student_key}/report", response_model=StudentReportResponse)
def get_student_report(
    student_key: str,
    school: str = Query(..., description="場域／學校，例如：測試場域"),
    game_type: str | None = Query(default=None, description="可選，例如 DCCS"),
) -> StudentReportResponse:
    grade, case_id = parse_student_key(student_key)

    try:
        rows = queries.fetch_assessment_rows(
            grade, case_id, school, normalize_game_type_for_db(game_type)
        )
        records = build_play_records(rows, queries.fetch_stats_for_rows(rows))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"資料庫查詢失敗：{exc}") from exc

    return StudentReportResponse(
        studentKey=student_key,
        grade=grade,
        caseId=case_id,
        school=school,
        totalSessions=len(records),
        records=records,
        summaryByGame=build_summary_by_game(records),
    )
```

錯誤處理**此刻先保持原樣**（仍然洩漏例外訊息）。Task 7 才改。這樣搬移與行為變更分屬不同 commit，出問題時容易二分定位。

- [ ] **Step 5: 用新的 `main.py` 取代舊的**

```python
"""學生遊戲場次與總覽報告 API。

啟動方式：
    cp .env.example .env   # 填入 DB_PASSWORD
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    .venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 5001

端點：
    GET /api/students/{studentKey}/sessions?school=測試場域
    GET /api/students/{studentKey}/report?school=測試場域
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI

from routers import students

load_dotenv()

# version 是開發時手動訂的版本號
app = FastAPI(title="ADHD Game Data API", version="0.2.0")

app.include_router(students.router)


@app.get("/")
def root() -> dict[str, str]:
    return {
        "status": "ok",
        "message": "API is running",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("API_HOST", "127.0.0.1"),
        port=int(os.getenv("API_PORT", "5000")),
        reload=True,
    )
```

- [ ] **Step 6: 執行全部測試**

```bash
.venv/bin/python -m pytest tests/ -v
```

Expected: 全部通過。Task 2 的 10 個 API 測試是這次搬移的安全網。

- [ ] **Step 7: 確認路由沒有遺漏或改名**

```bash
.venv/bin/python -c "import main; print(sorted(r.path for r in main.app.routes if hasattr(r, 'path')))"
```

Expected: 輸出中包含 `/`、`/health`、`/api/students/{student_key}/report`、`/api/students/{student_key}/sessions`

- [ ] **Step 8: 確認 `main.py` 真的瘦下來了**

```bash
wc -l main.py routers/students.py queries.py models.py converters.py
```

Expected: `main.py` 約 45 行（原本 366 行）

- [ ] **Step 9: Commit**

```bash
git add routers/ main.py tests/test_assembly.py
git commit -m "$(cat <<'EOF'
refactor: move student routes into routers/students.py

main.py now only wires the app together. Assembly functions are pure and
tested without a database. Error handling is unchanged in this commit.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 統一 DB 錯誤處理

現行寫法把 PyMySQL 的原始例外訊息回傳給呼叫端。該訊息可能包含表名、欄位名，連線失敗時甚至包含主機位址與使用者名稱。這個 API 部署在公開網路上。

**Files:**
- Modify: `routers/students.py`
- Modify: `tests/conftest.py`（新增 `break_query` fixture）
- Modify: `tests/test_api.py`（新增兩個測試）

**Interfaces:**
- Consumes: 無
- Produces:
  - `routers.students.db_error(exc: Exception) -> HTTPException`
  - pytest fixture `break_query` → `Callable[[str], None]`，讓指定的 `queries` 函式拋出含敏感資訊的例外

- [ ] **Step 1: 在 `tests/conftest.py` 末尾加上 `break_query` fixture**

三個端點的「DB 錯誤不外洩」測試需要同一種假例外。抽成 fixture，日後要調整例外訊息只需改一處。

```python
@pytest.fixture
def break_query(monkeypatch: Any) -> Any:
    """讓指定的 queries 函式拋出一個含敏感資訊的例外。

    例外訊息刻意包含主機位址與使用者名稱，測試才能斷言它們沒有出現在
    HTTP 回應裡。
    """

    def _break(function_name: str) -> None:
        import queries

        def boom(*args: Any, **kwargs: Any) -> None:
            raise RuntimeError("連線失敗 host=43.163.233.40 user=root")

        monkeypatch.setattr(queries, function_name, boom)

    return _break
```

`monkeypatch.setattr(queries, function_name, boom)` 能生效，是因為 `routers/students.py` 呼叫的是 `queries.fetch_assessment_rows(...)`（模組屬性查找），而不是 `from queries import fetch_assessment_rows`（匯入時綁定）。這正是 Task 5 用 `import queries` 而非 `from queries import ...` 的理由。

- [ ] **Step 2: 在 `tests/test_api.py` 末尾加上失敗測試**

```python
def test_sessions_db_error_returns_500_without_leaking_exception(
    client, db, break_query
):
    break_query("fetch_assessment_rows")

    response = client.get(
        "/api/students/G1_S03/sessions", params={"school": "測試場域"}
    )

    assert response.status_code == 500
    assert response.json() == {"detail": "資料庫查詢失敗"}
    assert "43.163.233.40" not in response.text
    assert "root" not in response.text


def test_report_db_error_returns_500_without_leaking_exception(
    client, db, break_query
):
    break_query("fetch_assessment_rows")

    response = client.get(
        "/api/students/G1_S03/report", params={"school": "測試場域"}
    )

    assert response.status_code == 500
    assert response.json() == {"detail": "資料庫查詢失敗"}
    assert "43.163.233.40" not in response.text
```

TestClient 預設會把伺服器端例外往外拋而非轉成 500 回應，但這裡的 `HTTPException(500)` 是**主動 raise 的 HTTP 例外**，FastAPI 會正常轉成回應，不受該行為影響。

- [ ] **Step 3: 執行測試，確認失敗**

```bash
.venv/bin/python -m pytest tests/test_api.py -k db_error -v
```

Expected: FAIL —— `assert response.json() == {"detail": "資料庫查詢失敗"}` 失敗，實際值為 `{"detail": "資料庫查詢失敗：連線失敗 host=43.163.233.40 user=root"}`

這個失敗訊息本身就展示了問題：主機位址和使用者名稱出現在 HTTP 回應裡。

- [ ] **Step 4: 在 `routers/students.py` 加上 `db_error`**

在 import 區塊加上：

```python
import logging
```

在 `router = APIRouter(tags=["students"])` 之前加上：

```python
logger = logging.getLogger(__name__)
```

在 `# --- 工具函式 ---` 區塊開頭加上：

```python
def db_error(exc: Exception) -> HTTPException:
    """回給呼叫端一句通用訊息，完整例外寫進 server log。

    PyMySQL 的例外訊息可能包含表名、欄位名，連線失敗時甚至包含主機位址與
    使用者名稱。這個 API 部署在公開網路上，那些資訊不該出現在 HTTP 回應裡。
    """
    logger.exception("資料庫查詢失敗")
    return HTTPException(status_code=500, detail="資料庫查詢失敗")
```

- [ ] **Step 5: 把兩個路由的 except 區塊改掉**

`list_student_sessions` 中：

```python
    except Exception as exc:
        raise db_error(exc) from exc
```

`get_student_report` 中：

```python
    except Exception as exc:
        raise db_error(exc) from exc
```

- [ ] **Step 6: 執行全部測試**

```bash
.venv/bin/python -m pytest tests/ -v
```

Expected: 全部通過

- [ ] **Step 7: Commit**

```bash
git add routers/students.py tests/conftest.py tests/test_api.py
git commit -m "$(cat <<'EOF'
fix: stop leaking database exception text to API clients

PyMySQL error messages can contain table names, column names, and on
connection failure the host and user. The API is publicly reachable.
Clients now get a fixed message; the full exception goes to the log.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `fetch_students` 查詢與三個陷阱測試

這是整個計畫風險最高的一段。三個陷阱都不會拋出例外，只會靜靜地回傳錯誤的數字。**先寫測試，看它們用錯誤的 SQL 失敗，再寫正確的 SQL。**

**Files:**
- Modify: `queries.py`
- Modify: `tests/test_queries.py`

**Interfaces:**
- Consumes: fixture `db`
- Produces: `queries.fetch_students(school: str | None = None) -> list[dict]`
  - 每列的 key：`grade`、`case_id`、`school`、`session_count`、`last_played_at`
  - `session_count` 為 `int`，`last_played_at` 為 `datetime | None`

- [ ] **Step 1: 在 `tests/test_queries.py` 末尾加上五個測試**

```python
# --- fetch_students ---


def test_zero_session_student_has_count_zero_not_one(db):
    """陷阱一：LEFT JOIN 對零場次學生產生一列，COUNT(*) 會把它算成 1。"""
    db.insert_student("G1", "S04", "測試場域")

    rows = queries.fetch_students()

    assert len(rows) == 1
    assert rows[0]["session_count"] == 0
    assert rows[0]["last_played_at"] is None


def test_school_filter_keeps_zero_session_students(db):
    """陷阱二：WHERE a.school = %s 會把零場次學生濾掉，因為 a.school 是 NULL。"""
    db.insert_student("G1", "S03", "測試場域")
    db.insert_student("G1", "S04", "測試場域")
    db.insert_session("G1", "S03", "測試場域", uuid="u1")

    rows = queries.fetch_students("測試場域")

    counts = {row["case_id"]: row["session_count"] for row in rows}
    assert counts == {"S03": 1, "S04": 0}


def test_same_case_id_in_two_schools_is_not_merged(db):
    """陷阱三：ON 條件少了 school，兩個場域的同名學生會互相 join。"""
    db.insert_student("G1", "S03", "SchoolA")
    db.insert_student("G1", "S03", "SchoolB")
    for index in range(3):
        db.insert_session(
            "G1", "S03", "SchoolA", uuid=f"u{index}",
            start_time=datetime(2026, 7, 1 + index, 9, 0, 0),
        )

    rows = queries.fetch_students()

    assert len(rows) == 2  # 每個場域各一列，不該有重複
    counts = {row["school"]: row["session_count"] for row in rows}
    assert counts == {"SchoolA": 3, "SchoolB": 0}


def test_last_played_at_uses_start_time_and_ignores_null_end_time(db):
    """最近一場尚未結束（end_time 為 NULL），仍然要是最後遊玩時間。"""
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="finished",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
        end_time=datetime(2026, 7, 1, 9, 30, 0),
    )
    db.insert_session(
        "G1", "S03", "測試場域", uuid="unfinished",
        start_time=datetime(2026, 7, 8, 14, 30, 0),
        end_time=None,
    )

    rows = queries.fetch_students()

    assert rows[0]["session_count"] == 2
    assert rows[0]["last_played_at"] == datetime(2026, 7, 8, 14, 30, 0)


def test_fetch_students_orders_by_school_grade_case_id(db):
    """SchoolA 底下刻意放兩個 case_id 相同、grade 不同的學生。

    少了他們，grade 與 case_id 的先後就分不出來 —— ORDER BY 若寫成
    school, case_id, grade，輸出順序會完全相同，測試照樣通過。
    """
    db.insert_student("G2", "S01", "SchoolB")
    db.insert_student("G1", "S02", "SchoolA")
    db.insert_student("G2", "S01", "SchoolA")
    db.insert_student("G1", "S01", "SchoolA")

    rows = queries.fetch_students()

    assert [(r["school"], r["grade"], r["case_id"]) for r in rows] == [
        ("SchoolA", "G1", "S01"),
        ("SchoolA", "G1", "S02"),
        ("SchoolA", "G2", "S01"),
        ("SchoolB", "G2", "S01"),
    ]


def test_fetch_students_of_unknown_school_is_empty(db):
    db.insert_student("G1", "S03", "測試場域")

    assert queries.fetch_students("不存在的場域") == []
```

- [ ] **Step 2: 執行測試，確認失敗**

```bash
.venv/bin/python -m pytest tests/test_queries.py -k fetch_students -v
```

Expected: FAIL with `AttributeError: module 'queries' has no attribute 'fetch_students'`

- [ ] **Step 3: 在 `queries.py` 末尾加上 `fetch_students`**

```python
def fetch_students(school: str | None = None) -> list[dict[str, Any]]:
    """查學生名冊與遊玩概況。零場次的學生也會出現在結果裡。

    三個容易寫錯而且不會拋錯的地方：

    1. COUNT(a.uuid) 不能寫成 COUNT(*)。LEFT JOIN 對零場次學生產生一列，
       右側欄位皆為 NULL，COUNT(*) 數列數會算成 1。
    2. WHERE 只能過濾 s.school。若過濾 a.school，零場次學生的 a.school 是
       NULL，條件為假，LEFT JOIN 會退化成 INNER JOIN，零場次學生全被濾掉。
    3. ON 必須包含全部三個鍵欄位。少了 school，不同場域的同名學生會互相
       join，場次數被放大。
    """
    sql = """
        SELECT s.grade, s.case_id, s.school,
               COUNT(a.uuid)     AS session_count,
               MAX(a.start_time) AS last_played_at
        FROM student s
        LEFT JOIN assessment_result a
               ON a.grade   = s.grade
              AND a.case_id = s.case_id
              AND a.school  = s.school
    """
    params: list[Any] = []

    if school is not None:
        sql += " WHERE s.school = %s"
        params.append(school)

    sql += """
        GROUP BY s.grade, s.case_id, s.school
        ORDER BY s.school, s.grade, s.case_id
    """

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()
```

- [ ] **Step 4: 執行測試，確認通過**

```bash
.venv/bin/python -m pytest tests/test_queries.py -k fetch_students -v
```

Expected: 6 passed

- [ ] **Step 5: 親手確認測試真的會抓到陷阱**

這一步不改任何檔案，只是驗證測試有牙齒。依序做三次，每次改壞 `fetch_students` 的一個地方、跑測試、確認**指定的那個測試失敗**，然後改回來。

把 `COUNT(a.uuid)` 改成 `COUNT(*)`：

```bash
.venv/bin/python -m pytest tests/test_queries.py::test_zero_session_student_has_count_zero_not_one -v
```
Expected: FAIL（`assert 1 == 0`）。改回 `COUNT(a.uuid)`。

把 `WHERE s.school = %s` 改成 `WHERE a.school = %s`：

```bash
.venv/bin/python -m pytest tests/test_queries.py::test_school_filter_keeps_zero_session_students -v
```
Expected: FAIL（`S04` 從結果中消失）。改回 `s.school`。

把 `ON` 條件裡的 `AND a.school = s.school` 刪掉：

```bash
.venv/bin/python -m pytest tests/test_queries.py::test_same_case_id_in_two_schools_is_not_merged -v
```
Expected: FAIL（兩個場域都是 3）。把該行加回去。

- [ ] **Step 6: 執行全部測試，確認已復原**

```bash
.venv/bin/python -m pytest tests/ -v
```

Expected: 全部通過

- [ ] **Step 7: Commit**

```bash
git add queries.py tests/test_queries.py
git commit -m "$(cat <<'EOF'
feat: add fetch_students query with zero-session students included

Three silent-failure traps are covered by dedicated tests: COUNT(a.uuid)
vs COUNT(*), filtering s.school vs a.school, and the three-column ON.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `GET /api/students` 端點

**Files:**
- Modify: `converters.py`（新增 `format_optional_datetime`、`normalize_school`）
- Modify: `models.py`（新增 `StudentListItem`、`StudentListResponse`）
- Modify: `routers/students.py`（新增 `build_student_list_items` 與路由）
- Modify: `main.py`（版本號 `0.2.0` → `0.3.0`、docstring 補上新端點）
- Modify: `README.md`
- Modify: `tests/test_converters.py`
- Modify: `tests/test_assembly.py`
- Modify: `tests/test_api.py`

**Interfaces:**
- Consumes: `queries.fetch_students`（Task 8）
- Produces:
  - `converters.format_optional_datetime(value: Any) -> str | None`
  - `converters.normalize_school(school: str | None) -> str | None`
  - `models.StudentListItem`、`models.StudentListResponse`
  - `routers.students.build_student_list_items(rows: list[dict]) -> list[StudentListItem]`
  - 路由 `GET /api/students`

- [ ] **Step 1: 在 `tests/test_converters.py` 末尾加上新函式的測試**

```python
from converters import format_optional_datetime, normalize_school


def test_format_optional_datetime_of_none_is_none():
    """與 format_datetime 不同：不假裝有值。"""
    assert format_optional_datetime(None) is None


def test_format_optional_datetime_formats_like_format_datetime():
    assert format_optional_datetime(datetime(2026, 7, 8, 14, 30, 0)) == "2026-07-08 14:30:00"


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("測試場域", "測試場域"),
        ("  測試場域  ", "測試場域"),
        ("", None),
        ("   ", None),
        (None, None),
    ],
)
def test_normalize_school(given, expected):
    assert normalize_school(given) == expected
```

把最上面的 import 區塊改成（合併新舊）：

```python
from converters import (
    format_datetime,
    format_optional_datetime,
    normalize_game_type_for_db,
    normalize_game_type_from_db,
    normalize_school,
    to_float,
    to_int,
)
```

並刪除剛才加在末尾的那行單獨 `from converters import format_optional_datetime, normalize_school`。

- [ ] **Step 2: 執行測試，確認失敗**

```bash
.venv/bin/python -m pytest tests/test_converters.py -v
```

Expected: FAIL with `ImportError: cannot import name 'format_optional_datetime' from 'converters'`

- [ ] **Step 3: 在 `converters.py` 末尾加上兩個函式**

```python
def format_optional_datetime(value: Any) -> str | None:
    """給可為空的日期欄位使用。

    與 format_datetime 不同：None 就回傳 None，不回傳空字串。
    空字串會假裝有值，讓呼叫端無法乾淨地判斷「沒有這個時間點」。
    """
    if value is None:
        return None
    return format_datetime(value)


def normalize_school(school: str | None) -> str | None:
    """空字串或全為空白的 school 視同未提供。

    沒有人會想查詢「場域名稱是空字串的學生」，把它當成篩選條件只會
    回傳一個對使用者毫無幫助的空名單。
    """
    if school is None:
        return None
    return school.strip() or None
```

- [ ] **Step 4: 執行 converters 測試，確認通過**

```bash
.venv/bin/python -m pytest tests/test_converters.py -v
```

Expected: 全部通過

- [ ] **Step 5: 在 `tests/test_assembly.py` 末尾加上組裝測試**

```python
def test_build_student_list_items_composes_student_key():
    from routers.students import build_student_list_items

    items = build_student_list_items(
        [
            {
                "grade": "G1",
                "case_id": "S03",
                "school": "測試場域",
                "session_count": 12,
                "last_played_at": datetime(2026, 7, 8, 14, 30, 0),
            }
        ]
    )

    assert items[0].studentKey == "G1_S03"
    assert items[0].grade == "G1"
    assert items[0].caseId == "S03"
    assert items[0].school == "測試場域"
    assert items[0].sessionCount == 12
    assert items[0].lastPlayedAt == "2026-07-08 14:30:00"


def test_build_student_list_items_of_zero_session_student_has_null_last_played():
    from routers.students import build_student_list_items

    items = build_student_list_items(
        [
            {
                "grade": "G1",
                "case_id": "S04",
                "school": "測試場域",
                "session_count": 0,
                "last_played_at": None,
            }
        ]
    )

    assert items[0].sessionCount == 0
    assert items[0].lastPlayedAt is None


def test_build_student_list_items_of_empty_rows_is_empty():
    from routers.students import build_student_list_items

    assert build_student_list_items([]) == []
```

- [ ] **Step 6: 在 `tests/test_api.py` 末尾加上端點測試**

```python
# --- GET /api/students ---


def test_list_students_without_school_returns_all_schools(client, db):
    db.insert_student("G1", "S03", "SchoolA")
    db.insert_student("G1", "S03", "SchoolB")

    response = client.get("/api/students")

    assert response.status_code == 200
    body = response.json()
    assert body["school"] is None
    assert body["studentCount"] == 2
    assert [(s["studentKey"], s["school"]) for s in body["students"]] == [
        ("G1_S03", "SchoolA"),
        ("G1_S03", "SchoolB"),
    ]


def test_list_students_with_school_filters_and_echoes_it(client, db):
    db.insert_student("G1", "S03", "SchoolA")
    db.insert_student("G1", "S03", "SchoolB")

    response = client.get("/api/students", params={"school": "SchoolA"})

    body = response.json()
    assert body["school"] == "SchoolA"
    assert body["studentCount"] == 1
    assert body["students"][0]["school"] == "SchoolA"


def test_list_students_includes_zero_session_students(client, db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_student("G1", "S04", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u1",
        start_time=datetime(2026, 7, 8, 14, 30, 0),
    )

    response = client.get("/api/students", params={"school": "測試場域"})

    assert response.json()["students"] == [
        {
            "studentKey": "G1_S03",
            "grade": "G1",
            "caseId": "S03",
            "school": "測試場域",
            "sessionCount": 1,
            "lastPlayedAt": "2026-07-08 14:30:00",
        },
        {
            "studentKey": "G1_S04",
            "grade": "G1",
            "caseId": "S04",
            "school": "測試場域",
            "sessionCount": 0,
            "lastPlayedAt": None,
        },
    ]


def test_list_students_blank_school_is_treated_as_not_given(client, db):
    db.insert_student("G1", "S03", "SchoolA")
    db.insert_student("G1", "S03", "SchoolB")

    response = client.get("/api/students", params={"school": "   "})

    body = response.json()
    assert body["school"] is None
    assert body["studentCount"] == 2


def test_list_students_of_unknown_school_is_200_with_empty_list(client, db):
    db.insert_student("G1", "S03", "測試場域")

    response = client.get("/api/students", params={"school": "不存在的場域"})

    assert response.status_code == 200
    assert response.json() == {
        "school": "不存在的場域",
        "studentCount": 0,
        "students": [],
    }


def test_list_students_student_count_matches_list_length(client, db):
    for index in range(3):
        db.insert_student("G1", f"S0{index}", "測試場域")

    body = client.get("/api/students").json()

    assert body["studentCount"] == len(body["students"]) == 3


def test_list_students_db_error_returns_500_without_leaking_exception(
    client, db, break_query
):
    break_query("fetch_students")

    response = client.get("/api/students")

    assert response.status_code == 500
    assert response.json() == {"detail": "資料庫查詢失敗"}
    assert "43.163.233.40" not in response.text
```

`break_query` 是 Task 7 建立的 fixture，位於 `tests/conftest.py`。

- [ ] **Step 7: 執行測試，確認失敗**

```bash
.venv/bin/python -m pytest tests/test_api.py -k list_students -v
```

Expected: FAIL —— `GET /api/students` 回傳 404 或 422（路由不存在，或被 `/api/students/{student_key}/...` 誤配）

- [ ] **Step 8: 在 `models.py` 末尾加上兩個模型**

```python
class StudentListItem(BaseModel):
    studentKey: str
    grade: str
    caseId: str
    school: str  # 主鍵的一部分：不同場域的 G1_S03 是不同的學生
    sessionCount: int  # 含未完成的場次
    lastPlayedAt: str | None = None  # MAX(start_time)；零場次為 None


class StudentListResponse(BaseModel):
    school: str | None = None  # 回顯查詢參數；未指定時為 None
    studentCount: int
    students: list[StudentListItem] = Field(default_factory=list)
```

- [ ] **Step 9: 在 `routers/students.py` 加上組裝函式與路由**

修改 import 區塊：

```python
from converters import (
    format_datetime,
    format_optional_datetime,
    normalize_game_type_for_db,
    normalize_game_type_from_db,
    normalize_school,
    to_float,
    to_int,
)
from models import (
    GameStats,
    GameSummary,
    PlayRecord,
    SessionItem,
    SessionsResponse,
    StudentListItem,
    StudentListResponse,
    StudentReportResponse,
)
```

在 `build_summary_by_game` 之後、`# --- API 路由 ---` 之前加上：

```python
def build_student_list_items(rows: list[dict[str, Any]]) -> list[StudentListItem]:
    """把 fetch_students 的列組成回應項目。純函式。"""
    return [
        StudentListItem(
            studentKey=f"{row['grade']}_{row['case_id']}",
            grade=row["grade"],
            caseId=row["case_id"],
            school=row["school"],
            sessionCount=to_int(row["session_count"]),
            lastPlayedAt=format_optional_datetime(row["last_played_at"]),
        )
        for row in rows
    ]
```

在 `# --- API 路由 ---` 之後、`list_student_sessions` **之前**加上新路由：

```python
@router.get("/api/students", response_model=StudentListResponse)
def list_students(
    school: str | None = Query(
        default=None, description="可選，場域／學校，例如：測試場域。不給則回傳所有場域"
    ),
) -> StudentListResponse:
    normalized_school = normalize_school(school)

    try:
        rows = queries.fetch_students(normalized_school)
    except Exception as exc:
        raise db_error(exc) from exc

    items = build_student_list_items(rows)

    return StudentListResponse(
        school=normalized_school,
        studentCount=len(items),
        students=items,
    )
```

放在最前面是為了讓路由順序與路徑的具體程度一致。FastAPI 依註冊順序比對，`/api/students` 與 `/api/students/{student_key}/sessions` 不會互相遮蔽（前者沒有後續路徑段），但把最短的路徑放最前面，讀的人不必去推敲這件事。

注意 `test_list_students_of_unknown_school_is_200_with_empty_list` 預期回應的 `school` 是 `"不存在的場域"` 而非 `None` —— 因為 `normalize_school` 只把空白視為未提供，不驗證場域是否存在。這是刻意的：規格說我們不去分辨「場域不存在」與「場域存在但無學生」。

- [ ] **Step 10: 執行全部測試**

```bash
.venv/bin/python -m pytest tests/ -v
```

Expected: 全部通過

- [ ] **Step 11: 更新 `main.py` 的版本號與 docstring**

把 docstring 的端點清單改成：

```
端點：
    GET /api/students?school=測試場域
    GET /api/students/{studentKey}/sessions?school=測試場域
    GET /api/students/{studentKey}/report?school=測試場域
```

把版本號改成：

```python
app = FastAPI(title="ADHD Game Data API", version="0.3.0")
```

- [ ] **Step 12: 更新 `README.md`**

```markdown
# AttentionLessonPlanTransferDataPlatform

注意力教案的遊戲資料中介 API。以 FastAPI 讀取 MariaDB，供前端與研究用途查詢。

## 端點

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/health` | 存活檢查 |
| GET | `/api/students` | 學生名單與總數。`?school=` 選填，不給則回傳所有場域 |
| GET | `/api/students/{studentKey}/sessions` | 單一學生的場次清單。`?school=` 必填 |
| GET | `/api/students/{studentKey}/report` | 單一學生的場次明細與各遊戲彙總。`?school=` 必填 |

`studentKey` 的格式是 `grade_caseId`，例如 `G1_S03`。學生的唯一鍵是
`(grade, case_id, school)` —— 不同場域的 `G1_S03` 是不同的學生。

## 開發

**需要 Python 3.10 以上。** 程式碼使用 `X | None` 型別註記，Pydantic 在 3.9 上無法解析它。macOS 內建的 `/usr/bin/python3` 是 3.9。

```bash
cp .env.example .env        # 填入 DB_PASSWORD 與 TEST_DB_NAME
"$(brew --prefix python@3.12)/bin/python3.12" -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 5001
```

互動式文件在 <http://127.0.0.1:5001/docs>。

## 測試

測試需要一個名稱以 `_test` 結尾的資料庫。`tests/conftest.py` 會拒絕在
其他資料庫上執行，以免清空正式資料。

```bash
.venv/bin/python -m pytest tests/ -v
```

未設定 `TEST_DB_NAME` 時，需要資料庫的測試會被跳過，純函式測試照常執行。

## 模組

| 檔案 | 職責 |
|---|---|
| `main.py` | 建立 app、掛載 router、`/` 與 `/health` |
| `db.py` | MariaDB 連線設定 |
| `converters.py` | 純轉換工具 |
| `models.py` | Pydantic 回應模型 |
| `queries.py` | 所有 SQL。唯一碰資料庫的模組 |
| `routers/students.py` | `/api/students` 路由與組裝邏輯 |
```

- [ ] **Step 13: 手動確認端點在真的伺服器上可用**

```bash
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 5001 &
sleep 2
curl -s "http://127.0.0.1:5001/api/students" | head -c 400
echo
kill %1
```

Expected: 回傳正式資料庫裡的學生名單 JSON，包含 `studentCount` 與 `students`。這一步會連上**正式資料庫**，但只執行 `SELECT`。

如果 `studentCount` 大於 `assessment_result` 裡出現過的學生數，那是正確的 —— 差額就是零場次的學生，也正是這個端點存在的理由。

- [ ] **Step 14: 執行全部測試最後一次**

```bash
.venv/bin/python -m pytest tests/ -v
```

Expected: 全部通過

- [ ] **Step 15: Commit**

```bash
git add converters.py models.py routers/students.py main.py README.md tests/
git commit -m "$(cat <<'EOF'
feat: add GET /api/students returning roster with play summary

Optional school filter, zero-session students included with sessionCount 0
and lastPlayedAt null. Bumps API version to 0.3.0.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完成後的收尾

這兩件事在規格的「已知債務」章節裡，**不屬於本計畫的任務**，但實作完成後應該處理：

1. **輪換 MariaDB 的 root 密碼。** 開發過程中曾以明文傳遞。
2. **限制資料庫的網路存取，並為 API 建立僅具 `SELECT` 權限的專用帳號。** 目前 root 帳號直接暴露於公開 IP。

`.env` 已在 `.gitignore` 中，不會進版控。請確認 `git status` 沒有把它列出來。
