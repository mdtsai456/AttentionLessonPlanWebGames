"""SQL 查詢模組，負責查詢資料庫。"""

from __future__ import annotations

from typing import Any

from db import get_read_connection

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
    "level_accuracy",
    "avg_reaction_ms",
    "question_count",
    "aim_ratio",
    "focus_ms",
)


def fetch_assessment_rows(
    grade: str,
    case_id: str,
    school: str,
    game_type: str | None = None,
    mode: str | None = None,
) -> list[dict[str, Any]]:
    """查詢場次索引表 assessment_result。

    SELECT 也取得 mode／pair_id。目前組裝回應時，不提供 pair_id。
    保留此欄位供後續比對雙人搭檔。
    """
    sql = """
        SELECT uuid, game_type, mode, pair_id, current_day, start_time, end_time
        FROM assessment_result
        WHERE grade = %s AND case_id = %s AND school = %s
    """
    params: list[Any] = [grade, case_id, school]

    if game_type is not None:
        sql += " AND game_type = %s"
        params.append(game_type)

    if mode is not None:
        sql += " AND mode = %s"
        params.append(mode)

    sql += " ORDER BY start_time DESC"

    with get_read_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())


def fetch_game_stats_by_uuids(
    table_name: str,
    uuids: list[str],
) -> dict[str, dict[str, Any]]:
    """依 uuid 批次查詢遊戲明細表。

    table_name 以 f-string 加入 SQL，來源僅限 GAME_RESULT_TABLES 白名單，不接受外部輸入。
    uuids 使用參數化查詢。
    """
    if not uuids:
        return {}

    placeholders = ", ".join(["%s"] * len(uuids))
    sql = f"""
        SELECT uuid, {", ".join(CORE_STAT_COLUMNS)}
        FROM {table_name}
        WHERE uuid IN ({placeholders})
    """

    with get_read_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, uuids)
            rows = cursor.fetchall()

    return {row["uuid"]: row for row in rows}


def fetch_stats_for_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """依 game_type 將場次分組，再逐表查詢統計，建立 uuid 與統計列的對應關係。

    此函式負責 build_play_records 所需的資料庫查詢。
    合併邏輯使用純函式，可直接以 dict 測試。
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


def fetch_students(school: str | None = None) -> list[dict[str, Any]]:
    """查詢學生名冊與遊玩概況，包含沒有場次的學生。

    1. 使用 COUNT(a.uuid)。LEFT JOIN 會為零場次學生產生一列，右側欄位為 NULL。
       COUNT(*) 會將該列計為一場。
    2. WHERE 只篩選 s.school。零場次學生的 a.school 為 NULL。
       篩選 a.school 會排除這些學生，使 LEFT JOIN 產生 INNER JOIN 的結果。
    3. ON 包含全部三個鍵欄位。缺少 school 時，不同場域的同名學生會互相連接，增加場次數。

    目前有數十至數百位學生，查詢不分頁。
    若 student 增至數萬列，須加入 LIMIT/OFFSET 與 school 索引。
    school 不是主鍵的最左前綴，此查詢會掃描整張 student 表。
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

    with get_read_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())


# 參照資料：場域與老師名錄，見 teacher-directory-login-design。


def fetch_schools() -> list[dict[str, Any]]:
    """場域清單，依 sort_order、再依 school 排序。"""
    with get_read_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT school, display_name, sort_order
                FROM school
                ORDER BY sort_order, school
                """
            )
            return list(cursor.fetchall())


def fetch_teachers(school: str) -> list[dict[str, Any]]:
    """某場域的老師清單，依 teacher_id（建立順序）排序。"""
    with get_read_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT teacher_id, name
                FROM teacher
                WHERE school = %s
                ORDER BY teacher_id
                """,
                [school],
            )
            return list(cursor.fetchall())


def fetch_teacher(teacher_id: int) -> dict[str, Any] | None:
    """查詢單一老師。查無資料時，回傳 None，由 router 轉為 404。"""
    with get_read_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT teacher_id, name, school FROM teacher WHERE teacher_id = %s",
                [teacher_id],
            )
            return cursor.fetchone()


# 帳號與密碼登入，見 docs/adr/0004-teacher-student-password-login.md。


def fetch_teacher_by_account(account: str) -> dict[str, Any] | None:
    """依全域唯一的 account 查詢老師，包含 password_hash。查無資料時，回傳 None。

    teacher.name 僅在 school 內唯一，受 uq_teacher_school_name 約束，不用於登入。
    登入使用全域唯一的 account，見 ADR 0004。
    """
    with get_read_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT teacher_id, name, school, password_hash FROM teacher "
                "WHERE account = %s",
                [account],
            )
            return cursor.fetchone()


def fetch_student_by_account(account: str) -> dict[str, Any] | None:
    """依全域唯一的 account 查詢學生，包含 password_hash。查無資料時，回傳 None。

    grade_caseId，也就是 studentKey，可能在不同場域重複，不用於登入。
    登入使用全域唯一的 account，見 ADR 0004。
    """
    with get_read_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT grade, case_id, school, password_hash FROM student "
                "WHERE account = %s",
                [account],
            )
            return cursor.fetchone()


def fetch_login_session(token: str) -> dict[str, Any] | None:
    """查詢登入 token。不存在時，回傳 None，由 router 轉為 401，不區分過期狀態。"""
    with get_read_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT token, subject_type, teacher_id, grade, case_id, school, "
                "expires_at FROM login_session WHERE token = %s",
                [token],
            )
            return cursor.fetchone()
