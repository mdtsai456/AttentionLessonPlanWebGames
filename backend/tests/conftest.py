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
    "teacher",  # 參照資料：teacher 掛在 school 底下，先刪 teacher
    "school",
)


def _assert_test_database(name: str) -> None:
    """防止測試連上正式庫並清空資料。

    這道檢查存在的理由很具體：若有人忘了設 TEST_DB_NAME，
    測試會靜默連上 AttentionLessonPlan 並 DELETE 掉 student。
    """
    assert name.endswith("_test"), f"拒絕在非測試資料庫上執行：{name}"


def _schema_statements() -> list[str]:
    # 以裸分號切分。schema.sql 目前沒有任何字串常值或行內註解包含分號，
    # 若日後有，這裡會切錯。
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
    # App startup 現在要求 read/write credentials。沒有測試庫時提供不會真的
    # 連線的 dummy 值；有測試庫時 writer 明確沿用該測試帳號。
    name = os.getenv("TEST_DB_NAME")
    test_user = (os.getenv("DB_USER") or "").strip() or "test_reader"
    configured_password = os.getenv("DB_PASSWORD") or ""
    test_password = (
        configured_password
        if configured_password.strip()
        else "test_read_password"
    )
    credential_defaults = {
        "DB_USER": test_user,
        "DB_PASSWORD": test_password,
        "DB_WRITE_USER": test_user,
        "DB_WRITE_PASSWORD": test_password,
    }
    previous_credentials = {
        variable: os.environ.get(variable) for variable in credential_defaults
    }
    for variable, default in credential_defaults.items():
        if name and variable.startswith("DB_WRITE_"):
            os.environ[variable] = default
        elif not (os.getenv(variable) or "").strip():
            os.environ[variable] = default

    if name:
        _assert_test_database(name)

    previous = os.environ.get("DB_NAME")
    if name:
        os.environ["DB_NAME"] = name
    yield name

    if name:
        if previous is None:
            os.environ.pop("DB_NAME", None)
        else:
            os.environ["DB_NAME"] = previous
    for variable, value in previous_credentials.items():
        if value is None:
            os.environ.pop(variable, None)
        else:
            os.environ[variable] = value


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

    # 這道檢查是最後一關。point_app_at_test_db 已經檢查過一次，但那守的是
    # fixture 路徑，不是資料庫本身：任何繞過 fixture 直接連線的程式碼都會
    # 走到這裡來刪資料。
    _assert_test_database(os.environ["DB_NAME"])

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

    def insert_school(
        self, school: str, display_name: str | None = None, sort_order: int = 0
    ) -> None:
        self.execute(
            "INSERT INTO school (school, display_name, sort_order) VALUES (%s, %s, %s)",
            [school, display_name if display_name is not None else school, sort_order],
        )

    def insert_teacher(self, name: str, school: str) -> int:
        from db import get_connection

        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO teacher (name, school) VALUES (%s, %s)", [name, school]
                )
                teacher_id = cursor.lastrowid
            connection.commit()
        return teacher_id

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
        mode: str = "single",
        pair_id: str | None = None,
    ) -> None:
        self.execute(
            """
            INSERT INTO assessment_result
                (grade, case_id, school, uuid, start_time, game_type,
                 mode, pair_id, current_day, end_time)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                grade,
                case_id,
                school,
                uuid,
                start_time or datetime(2026, 7, 1, 9, 0, 0),
                game_type,
                mode,
                pair_id,
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
