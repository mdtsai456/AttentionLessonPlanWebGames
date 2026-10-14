"""測試資料庫的連線、建表、清空與資料插入輔助函式。

需要設定 TEST_DB_NAME，且值須以 _test 結尾。
未設定時，略過需要資料庫的測試。其餘測試照常執行。
"""

from __future__ import annotations

import os
import pathlib
import secrets
from datetime import datetime
from typing import Any

import pytest
from dotenv import load_dotenv

load_dotenv()

SCHEMA_PATH = pathlib.Path(__file__).parent / "schema.sql"

# 先刪除子表，再刪除父表，避免違反外鍵約束。
TABLES_CHILD_FIRST = (
    "dat_result",
    "dccs_result",
    "eft_result",
    "im_result",
    "tgame_result",
    "assessment_result",
    "login_session",  # 此外鍵同時指向 teacher 與 student，須先刪除此表，再刪除兩個父表。
    "student",
    "teacher",  # teacher 的外鍵指向 school，須先刪除 teacher。
    "school",
)


def _assert_test_database(name: str) -> None:
    """阻止測試連線至正式資料庫並清空資料。

    未設定 TEST_DB_NAME 時，可能連線至 AttentionLessonPlan 並刪除 student 資料，因此須檢查目標。
    """
    assert name.endswith("_test"), f"拒絕在非測試資料庫上執行：{name}"


def _schema_statements() -> list[str]:
    # 使用分號分隔 SQL。schema.sql 目前的字串常值與行內註解不包含分號，
    # 若後續加入此類分號，須調整分隔方式。
    raw = SCHEMA_PATH.read_text(encoding="utf-8")
    lines = [line for line in raw.splitlines() if not line.strip().startswith("--")]
    return [stmt.strip() for stmt in "\n".join(lines).split(";") if stmt.strip()]


@pytest.fixture(scope="session", autouse=True)
def point_app_at_test_db() -> Any:
    """將 DB_NAME 指向測試資料庫。

    db.get_db_config() 每次呼叫皆讀取 os.getenv，修改環境變數即可，不需替換函式。
    未設定 TEST_DB_NAME 時，回傳 None，讓不存取資料庫的測試照常執行。
    """
    # 應用程式啟動時需要讀取與寫入憑證。未設定測試資料庫時，使用不會建立連線的測試值。
    # 已設定測試資料庫時，寫入操作沿用測試帳號。
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


# schema.sql 的 CREATE TABLE IF NOT EXISTS 不會替既有資料表增加缺少的約束。
# 在此以冪等操作補齊外鍵，更新既有的 _test 資料庫。
_RETROFIT_CONSTRAINTS = (
    (
        "student",
        "fk_student_school",
        "ALTER TABLE student ADD CONSTRAINT fk_student_school "
        "FOREIGN KEY (school) REFERENCES school (school) ON UPDATE CASCADE",
    ),
)

# 同樣以冪等操作補齊欄位。帳號與密碼欄位是後續新增，
# 既有 _test 資料庫的 teacher／student 表需另外加入 password_hash。
_RETROFIT_COLUMNS = (
    ("teacher", "password_hash", "ALTER TABLE teacher ADD COLUMN password_hash "
     "varchar(255) NOT NULL DEFAULT ''"),
    ("student", "password_hash", "ALTER TABLE student ADD COLUMN password_hash "
     "varchar(255) NOT NULL DEFAULT ''"),
    ("teacher", "account", "ALTER TABLE teacher ADD COLUMN account varchar(20) "
     "DEFAULT NULL, ADD CONSTRAINT uq_teacher_account UNIQUE (account)"),
    ("student", "student_id", "ALTER TABLE student ADD COLUMN student_id int "
     "NOT NULL AUTO_INCREMENT, ADD CONSTRAINT uq_student_id UNIQUE (student_id)"),
    ("student", "account", "ALTER TABLE student ADD COLUMN account varchar(20) "
     "DEFAULT NULL, ADD CONSTRAINT uq_student_account UNIQUE (account)"),
)


@pytest.fixture(scope="session")
def _schema(db_available: str) -> None:
    from db import get_connection

    with get_connection() as connection:
        with connection.cursor() as cursor:
            for statement in _schema_statements():
                cursor.execute(statement)
            for table, constraint, alter_sql in _RETROFIT_CONSTRAINTS:
                cursor.execute(
                    "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS "
                    "WHERE CONSTRAINT_SCHEMA = %s AND TABLE_NAME = %s "
                    "AND CONSTRAINT_NAME = %s",
                    [os.environ["DB_NAME"], table, constraint],
                )
                if cursor.fetchone()["n"] == 0:
                    cursor.execute(alter_sql)
            for table, column, alter_sql in _RETROFIT_COLUMNS:
                cursor.execute(
                    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS "
                    "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s",
                    [os.environ["DB_NAME"], table, column],
                )
                if cursor.fetchone()["n"] == 0:
                    cursor.execute(alter_sql)
        connection.commit()


def _truncate_all() -> None:
    from db import get_connection

    # 刪除前，再次驗證資料庫名稱。point_app_at_test_db 已驗證 fixture 使用的路徑，
    # 但此處還須驗證資料庫本身，因為略過 fixture 並直接連線的程式碼
    # 也會在此刪除資料。
    _assert_test_database(os.environ["DB_NAME"])

    with get_connection() as connection:
        with connection.cursor() as cursor:
            for table in TABLES_CHILD_FIRST:
                cursor.execute(f"DELETE FROM {table}")
        connection.commit()


class DbHelper:
    """測試用的資料插入輔助函式。資料表名稱由測試程式指定，不接受外部輸入。"""

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

    def ensure_school(self, school: str) -> None:
        """以冪等操作登記場域字串。student.school 的外鍵指向 school，因此插入學生或場次前，場域須存在。
插入學生時，自動補齊場域。驗證場域行為的測試可直接呼叫 insert_school。
"""
        self.execute(
            "INSERT INTO school (school, display_name, sort_order) VALUES (%s, %s, 0) "
            "ON DUPLICATE KEY UPDATE school = school",
            [school, school],
        )

    def insert_student(
        self,
        grade: str,
        case_id: str,
        school: str,
        password: str | None = None,
        account: str | None = None,
    ) -> None:
        from auth import hash_password

        self.ensure_school(school)
        self.execute(
            "INSERT INTO student (grade, case_id, school, password_hash, account) "
            "VALUES (%s, %s, %s, %s, %s)",
            [grade, case_id, school, hash_password(password) if password else "", account],
        )

    def insert_school(
        self, school: str, display_name: str | None = None, sort_order: int = 0
    ) -> None:
        self.execute(
            "INSERT INTO school (school, display_name, sort_order) VALUES (%s, %s, %s) "
            "ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), "
            "sort_order = VALUES(sort_order)",
            [school, display_name if display_name is not None else school, sort_order],
        )

    def insert_teacher(
        self,
        name: str,
        school: str,
        password: str | None = None,
        account: str | None = None,
    ) -> int:
        from auth import hash_password
        from db import get_connection

        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO teacher (name, school, password_hash, account) "
                    "VALUES (%s, %s, %s, %s)",
                    [name, school, hash_password(password) if password else "", account],
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
def login_as_teacher(client: Any, db: DbHelper) -> Any:
    """回傳工廠函式，建立帳號與密碼已知的老師，再登入並回傳 (teacher_id, headers)。

    account 預設使用隨機字串。登入使用全域唯一的 account，不使用 school+name。
    見 docs/adr/0004。
    """

    def _login(
        name: str = "吳老師",
        school: str = "A",
        password: str = "test-pw-1",
        account: str | None = None,
    ) -> Any:
        account = account or f"t-{secrets.token_hex(4)}"
        db.insert_school(school)
        teacher_id = db.insert_teacher(name, school, password=password, account=account)
        response = client.post(
            "/api/auth/teacher/login",
            json={"account": account, "password": password},
        )
        assert response.status_code == 200, response.text
        token = response.json()["token"]
        return teacher_id, {"Authorization": f"Bearer {token}"}

    return _login


@pytest.fixture
def login_as_student(client: Any, db: DbHelper) -> Any:
    """回傳工廠函式，建立帳號與密碼已知的學生，再登入並回傳 (studentKey, headers)。"""

    def _login(
        grade: str = "G1",
        case_id: str = "S01",
        school: str = "A",
        password: str = "test-pw-1",
        account: str | None = None,
    ) -> Any:
        account = account or f"s-{secrets.token_hex(4)}"
        db.insert_student(grade, case_id, school, password=password, account=account)
        response = client.post(
            "/api/auth/student/login",
            json={"account": account, "password": password},
        )
        assert response.status_code == 200, response.text
        token = response.json()["token"]
        return f"{grade}_{case_id}", {"Authorization": f"Bearer {token}"}

    return _login


@pytest.fixture
def break_query(monkeypatch: Any) -> Any:
    """讓指定的 queries 函式拋出包含敏感資訊的例外。

    例外包含主機位址與使用者名稱，以驗證 HTTP 回應未包含這些資訊。
    """

    def _break(function_name: str) -> None:
        import queries

        def boom(*args: Any, **kwargs: Any) -> None:
            raise RuntimeError("連線失敗 host=43.163.233.40 user=root")

        monkeypatch.setattr(queries, function_name, boom)

    return _break
