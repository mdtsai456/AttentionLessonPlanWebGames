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
