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
) -> str:
    """建立 Student、Session 與其五個共同遊戲統計，並回傳 UUID。"""
    table_name = GAME_RESULT_TABLES.get(game_type)
    if table_name is None:
        raise ValueError(f"不支援的遊戲類型：{game_type}")

    session_id = str(uuid4())
    student_sql = (
        "INSERT IGNORE INTO student (grade, case_id, school) VALUES (%s, %s, %s)"
    )
    assessment_sql = """
        INSERT INTO assessment_result
            (grade, case_id, school, uuid, start_time, game_type, current_day, end_time)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
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
