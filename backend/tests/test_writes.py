"""writes 的公開行為測試。需要測試資料庫。"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Any

import pymysql
import pytest

import queries
import writes


SCHOOL = "測試場域"


@pytest.fixture(autouse=True)
def _register_school(request):
    """這些測試直接呼叫寫入路徑（writes.insert_session_with_stats），
    student.school 的外鍵要求場域先登記。碰資料庫的測試都帶 db fixture。"""
    if "db" not in request.fixturenames:
        return
    request.getfixturevalue("db").insert_school(SCHOOL)


START = datetime(2026, 7, 1, 9, 0, 0)
END = datetime(2026, 7, 1, 9, 6, 0)
STATS = {
    "correct_count": 10,
    "wrong_count": 2,
    "accuracy": 0.83,
    "duration": 360000.0,
    "stage": 5,
}


def test_insert_session_with_stats_returns_retrievable_session(db):
    session_id = writes.insert_session_with_stats(
        grade="G1",
        case_id="S03",
        school="測試場域",
        start_time=START,
        game_type="DCCS",
        current_day=1,
        end_time=END,
        stats=STATS,
    )

    parsed_session_id = uuid.UUID(session_id)
    assert parsed_session_id.version == 4
    assert str(parsed_session_id) == session_id
    assert queries.fetch_students("測試場域")[0]["session_count"] == 1

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域")
    assert rows == [
        {
            "uuid": session_id,
            "game_type": "DCCS",
            "mode": "single",
            "pair_id": None,
            "current_day": 1,
            "start_time": START,
            "end_time": END,
        }
    ]
    assert queries.fetch_stats_for_rows(rows)[session_id]["correct_count"] == 10


@pytest.mark.parametrize("game_type", ["DCCS", "DAT", "EFT", "IM", "TGAME"])
def test_insert_session_with_stats_routes_each_game_to_its_result_table(
    db, game_type
):
    session_id = writes.insert_session_with_stats(
        "G1",
        "S03",
        "測試場域",
        START,
        game_type,
        1,
        END,
        STATS,
    )

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域")
    assert rows[0]["game_type"] == game_type
    assert queries.fetch_stats_for_rows(rows)[session_id]["stage"] == 5


def test_insert_session_with_stats_stores_mode_and_pair_id(db):
    session_id = writes.insert_session_with_stats(
        "G1",
        "S03",
        "測試場域",
        START,
        "DAT",
        1,
        END,
        STATS,
        mode="double",
        pair_id="6f1c8e2a-3b7d-4e11-9a52-0c9d7f2b1e44",
    )

    row = db.query(
        "SELECT mode, pair_id FROM assessment_result WHERE uuid = %s", [session_id]
    )
    assert row == [
        {"mode": "double", "pair_id": "6f1c8e2a-3b7d-4e11-9a52-0c9d7f2b1e44"}
    ]


def test_insert_session_with_stats_defaults_to_single_mode(db):
    session_id = writes.insert_session_with_stats(
        "G1", "S03", "測試場域", START, "DCCS", 1, END, STATS
    )

    assert db.query(
        "SELECT mode, pair_id FROM assessment_result WHERE uuid = %s", [session_id]
    ) == [{"mode": "single", "pair_id": None}]


def test_insert_session_with_stats_writes_missing_core_value_as_null(db):
    session_id = writes.insert_session_with_stats(
        "G1",
        "S03",
        "測試場域",
        START,
        "DCCS",
        1,
        END,
        {"correct_count": 10},
    )

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域")
    stats = queries.fetch_stats_for_rows(rows)[session_id]
    assert stats["correct_count"] == 10
    assert stats["wrong_count"] is None
    assert stats["accuracy"] is None
    assert stats["duration"] is None
    assert stats["stage"] is None


def test_insert_session_with_stats_ignores_non_core_stats(db):
    session_id = writes.insert_session_with_stats(
        "G1",
        "S03",
        "測試場域",
        START,
        "DCCS",
        1,
        END,
        {**STATS, "frameWrongCount": 99},
    )

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域")
    assert queries.fetch_stats_for_rows(rows)[session_id]["correct_count"] == 10
    assert db.query(
        "SELECT frameWrongCount FROM dccs_result WHERE uuid = %s", [session_id]
    ) == [{"frameWrongCount": None}]


def test_insert_session_with_stats_accepts_unfinished_session(db):
    session_id = writes.insert_session_with_stats(
        "G1",
        "S03",
        "測試場域",
        START,
        "DCCS",
        1,
        None,
        STATS,
    )

    rows = queries.fetch_assessment_rows("G1", "S03", "測試場域")
    assert rows[0]["uuid"] == session_id
    assert rows[0]["end_time"] is None


def test_insert_session_with_stats_rejects_unknown_game_before_connecting(monkeypatch):
    def unexpected_connection():
        raise AssertionError("未知 game_type 不應連線資料庫")

    monkeypatch.setattr(writes, "get_write_connection", unexpected_connection)

    with pytest.raises(ValueError, match="不支援的遊戲類型：UNKNOWN"):
        writes.insert_session_with_stats(
            "G1",
            "S03",
            "測試場域",
            START,
            "UNKNOWN",
            1,
            END,
            STATS,
        )


class FailingConnection:
    def __init__(self, rollback_error: Exception | None = None) -> None:
        self.committed = False
        self.rolled_back = False
        self.execute_count = 0
        self.rollback_error = rollback_error

    @contextmanager
    def cursor(self):
        yield self

    def execute(self, sql: str, params: list[Any]) -> None:
        self.execute_count += 1
        if self.execute_count == 3:
            raise RuntimeError("result insert failed")

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True
        if self.rollback_error is not None:
            raise self.rollback_error


def test_insert_session_with_stats_rolls_back_and_preserves_write_error(monkeypatch):
    connection = FailingConnection()

    @contextmanager
    def failing_connection():
        yield connection

    monkeypatch.setattr(writes, "get_write_connection", failing_connection)

    with pytest.raises(RuntimeError, match="result insert failed"):
        writes.insert_session_with_stats(
            "G1",
            "S03",
            "測試場域",
            START,
            "DCCS",
            1,
            END,
            STATS,
        )

    assert connection.rolled_back is True
    assert connection.committed is False


def test_insert_session_with_stats_leaves_no_partial_rows_after_result_failure(db):
    invalid_stats = {**STATS, "accuracy": float("nan")}

    with pytest.raises(pymysql.ProgrammingError):
        writes.insert_session_with_stats(
            "G1",
            "S03",
            "測試場域",
            START,
            "DCCS",
            1,
            END,
            invalid_stats,
        )

    assert queries.fetch_students("測試場域") == []
    assert queries.fetch_assessment_rows("G1", "S03", "測試場域") == []
    assert not db.query("SELECT uuid FROM dccs_result")


def test_insert_session_with_stats_preserves_write_error_when_rollback_fails(
    monkeypatch,
):
    connection = FailingConnection(RuntimeError("rollback failed"))

    @contextmanager
    def failing_connection():
        yield connection

    monkeypatch.setattr(writes, "get_write_connection", failing_connection)

    with pytest.raises(RuntimeError, match="result insert failed"):
        writes.insert_session_with_stats(
            "G1",
            "S03",
            "測試場域",
            START,
            "DCCS",
            1,
            END,
            STATS,
        )

    assert connection.rolled_back is True
    assert connection.committed is False
