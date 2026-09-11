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


def test_seed_assigns_account_and_password_to_every_teacher_without_one(db):
    from db import get_connection

    with get_connection() as connection:
        _, _, new_credentials = seed_directory.seed(connection)

    assert len(new_credentials) == 16  # 全部都是新的，account 欄位原本是 NULL
    rows = db.query("SELECT account, password_hash FROM teacher")
    assert all(row["account"] for row in rows)  # 每位老師都有非空的 account
    assert len({row["account"] for row in rows}) == 16  # 全域唯一，沒有重複
    assert all(row["password_hash"] for row in rows)


def test_seed_does_not_reassign_or_leak_existing_credentials(db):
    from db import get_connection

    with get_connection() as connection:
        seed_directory.seed(connection)

    before = {
        row["teacher_id"]: (row["account"], row["password_hash"])
        for row in db.query("SELECT teacher_id, account, password_hash FROM teacher")
    }

    with get_connection() as connection:
        _, _, new_credentials = seed_directory.seed(connection)

    assert new_credentials == []  # 第二次跑，沒有人需要新帳密
    after = {
        row["teacher_id"]: (row["account"], row["password_hash"])
        for row in db.query("SELECT teacher_id, account, password_hash FROM teacher")
    }
    assert before == after  # 既有帳密完全沒變


def test_seed_generated_credentials_actually_verify(db):
    from auth import verify_password
    from db import get_connection

    with get_connection() as connection:
        _, _, new_credentials = seed_directory.seed(connection)

    school, name, account, plaintext = new_credentials[0]
    stored = db.query(
        "SELECT password_hash FROM teacher WHERE school = %s AND name = %s",
        [school, name],
    )[0]["password_hash"]
    assert verify_password(plaintext, stored)

    stored_by_account = db.query(
        "SELECT password_hash FROM teacher WHERE account = %s", [account]
    )[0]["password_hash"]
    assert stored_by_account == stored
