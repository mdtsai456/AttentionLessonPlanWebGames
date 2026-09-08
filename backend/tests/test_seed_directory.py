"""seed_directory.py 的測試：常數不變式（純函式）＋ 冪等灌注（需測試庫）。"""

from __future__ import annotations

import collections

import pytest

import seed_directory


# --- 不碰資料庫 ---


def test_eight_schools_all_distinct():
    codes = [row[0] for row in seed_directory.SCHOOLS]
    assert len(codes) == 8
    assert len(set(codes)) == 8


def test_sixteen_teachers_two_per_school():
    by_school = collections.Counter(school for school, _name in seed_directory.TEACHERS)
    school_codes = {row[0] for row in seed_directory.SCHOOLS}

    assert len(seed_directory.TEACHERS) == 16
    assert set(by_school) == school_codes
    assert all(count == 2 for count in by_school.values())


def test_teacher_names_unique_within_each_school():
    seen: set[tuple[str, str]] = set()
    for pair in seed_directory.TEACHERS:
        assert pair not in seen
        seen.add(pair)


def test_resolve_target_rejects_non_test_db(monkeypatch):
    monkeypatch.setattr(seed_directory.sys, "argv", ["seed_directory.py"])
    monkeypatch.setenv("TEST_DB_NAME", "AttentionLessonPlan")  # 不以 _test 結尾

    with pytest.raises(SystemExit):
        seed_directory._resolve_target()


def test_resolve_target_requires_test_db_name(monkeypatch):
    monkeypatch.setattr(seed_directory.sys, "argv", ["seed_directory.py"])
    monkeypatch.delenv("TEST_DB_NAME", raising=False)

    with pytest.raises(SystemExit):
        seed_directory._resolve_target()


# --- 碰測試資料庫 ---


def _counts(db):
    return (
        db.query("SELECT COUNT(*) AS n FROM school")[0]["n"],
        db.query("SELECT COUNT(*) AS n FROM teacher")[0]["n"],
    )


def test_seed_fills_eight_schools_and_sixteen_teachers(db):
    from db import get_connection

    with get_connection() as connection:
        seed_directory.seed(connection)

    assert _counts(db) == (8, 16)


def test_seed_is_idempotent(db):
    from db import get_connection

    with get_connection() as connection:
        seed_directory.seed(connection)
    with get_connection() as connection:
        seed_directory.seed(connection)  # 第二次不該拋重複鍵、不該增加筆數

    assert _counts(db) == (8, 16)


def test_seed_preserves_manually_added_teacher(db):
    from db import get_connection

    with get_connection() as connection:
        seed_directory.seed(connection)
    db.execute(
        "INSERT INTO teacher (name, school) VALUES (%s, %s)", ["手動老師", "KMU"]
    )

    with get_connection() as connection:
        seed_directory.seed(connection)

    names = {
        row["name"]
        for row in db.query("SELECT name FROM teacher WHERE school = 'KMU'")
    }
    assert "手動老師" in names
