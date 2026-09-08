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


def test_fetch_assessment_rows_selects_mode_and_pair_id(db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u1", game_type="DAT",
        mode="double", pair_id="pair-1",
    )

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域")

    assert rows[0]["mode"] == "double"
    assert rows[0]["pair_id"] == "pair-1"


def test_fetch_assessment_rows_filters_by_mode(db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session("G1", "S03", "測試場域", uuid="s1", game_type="DAT", mode="single")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="d1", game_type="DAT",
        mode="double", pair_id="p1",
    )

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域", mode="double")

    assert [row["uuid"] for row in rows] == ["d1"]


def test_fetch_assessment_rows_combines_game_type_and_mode_filters(db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session("G1", "S03", "測試場域", uuid="dat_s", game_type="DAT", mode="single")
    db.insert_session("G1", "S03", "測試場域", uuid="dat_d", game_type="DAT", mode="double")
    db.insert_session("G1", "S03", "測試場域", uuid="dccs_s", game_type="DCCS", mode="single")

    rows = queries.fetch_assessment_rows(
        "G1", "S03", "測試場域", game_type="DAT", mode="single"
    )

    assert [row["uuid"] for row in rows] == ["dat_s"]


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
