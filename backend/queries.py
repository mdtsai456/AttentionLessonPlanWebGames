"""所有 SQL。這是唯一碰資料庫的模組。"""

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

    with get_read_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())


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

    with get_read_connection() as connection:
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


def fetch_students(school: str | None = None) -> list[dict[str, Any]]:
    """查學生名冊與遊玩概況。零場次的學生也會出現在結果裡。

    三個容易寫錯而且不會拋錯的地方：

    1. COUNT(a.uuid) 不能寫成 COUNT(*)。LEFT JOIN 對零場次學生產生一列，
       右側欄位皆為 NULL，COUNT(*) 數列數會算成 1。
    2. WHERE 只能過濾 s.school。若過濾 a.school，零場次學生的 a.school 是
       NULL，條件為假，LEFT JOIN 會退化成 INNER JOIN，零場次學生全被濾掉。
    3. ON 必須包含全部三個鍵欄位。少了 school，不同場域的同名學生會互相
       join，場次數被放大。

    刻意不分頁。現有規模是數十至數百位學生，一次全撈沒有問題。若 student
    表成長到數萬列，這裡要加 LIMIT/OFFSET，並同時為 school 加索引 ——
    school 不是主鍵的最左前綴，這個查詢會全表掃描 student。
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


# --- 參照資料：場域與老師名錄（見 teacher-directory-login-design） ---


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
    """查單一老師。None 表示查無此老師（router 轉 404）。"""
    with get_read_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT teacher_id, name, school FROM teacher WHERE teacher_id = %s",
                [teacher_id],
            )
            return cursor.fetchone()
