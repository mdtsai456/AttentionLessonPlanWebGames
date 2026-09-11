"""建立學生遊戲場次所需的 transactional SQL。"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from db import get_write_connection
from queries import CORE_STAT_COLUMNS, GAME_RESULT_TABLES


def insert_session_with_stats(
    grade: str,
    case_id: str,
    school: str,
    start_time: datetime,
    game_type: str,
    current_day: int,
    end_time: datetime | None,
    stats: dict[str, Any],
    mode: str = "single",
    pair_id: str | None = None,
) -> str:
    """建立 Student、Session 與其五個共同遊戲統計，並回傳 UUID。

    mode 預設 "single"、pair_id 預設 None —— 現有（只有單人版的）呼叫端不用改。
    後端對這兩欄完全被動：收到什麼存什麼。
    """
    table_name = GAME_RESULT_TABLES.get(game_type)
    if table_name is None:
        raise ValueError(f"不支援的遊戲類型：{game_type}")

    session_id = str(uuid4())
    student_sql = (
        "INSERT IGNORE INTO student (grade, case_id, school) VALUES (%s, %s, %s)"
    )
    assessment_sql = """
        INSERT INTO assessment_result
            (grade, case_id, school, uuid, start_time, game_type,
             mode, pair_id, current_day, end_time)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    stat_placeholders = ", ".join(["%s"] * len(CORE_STAT_COLUMNS))
    result_sql = f"""
        INSERT INTO {table_name}
            (grade, case_id, school, uuid, {", ".join(CORE_STAT_COLUMNS)})
        VALUES (%s, %s, %s, %s, {stat_placeholders})
    """

    assessment_params = [
        grade,
        case_id,
        school,
        session_id,
        start_time,
        game_type,
        mode,
        pair_id,
        current_day,
        end_time,
    ]
    result_params = [
        grade,
        case_id,
        school,
        session_id,
        *[stats.get(column) for column in CORE_STAT_COLUMNS],
    ]

    with get_write_connection() as connection:
        try:
            with connection.cursor() as cursor:
                cursor.execute(student_sql, [grade, case_id, school])
                cursor.execute(assessment_sql, assessment_params)
                cursor.execute(result_sql, result_params)
            connection.commit()
        except Exception:
            try:
                connection.rollback()
            except Exception:
                # 連線中斷時 rollback 也可能失敗；仍須保留原始寫入例外。
                pass
            raise

    return session_id


# --- 帳密登入（見 docs/adr/0004-teacher-student-password-login.md） ---


def insert_login_session(
    token: str,
    subject_type: str,
    expires_at: datetime,
    *,
    teacher_id: int | None = None,
    grade: str | None = None,
    case_id: str | None = None,
    school: str | None = None,
) -> None:
    """建立一筆登入憑證。老師只填 teacher_id；學生只填 grade/case_id/school。"""
    with get_write_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO login_session "
                "(token, subject_type, teacher_id, grade, case_id, school, "
                " created_at, expires_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, NOW(), %s)",
                [token, subject_type, teacher_id, grade, case_id, school, expires_at],
            )
        connection.commit()


def delete_login_session(token: str) -> None:
    """登出：刪掉一筆登入憑證。token 不存在也視為成功（冪等）。"""
    with get_write_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM login_session WHERE token = %s", [token])
        connection.commit()
