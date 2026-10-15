"""同一場遊戲的中場檢查點與完整成績共用一列。

遊戲到第 3 關中場就先送一次成績（stage 3），打完六關再用同一個 submissionId
送第 6 關。後端撞到同一個場次 UUID 時，用關卡較高的成績更新那一列；
關卡沒有比較高（逾時重送同一筆、晚到的第 3 關）就不動。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pymysql
import pytest
from fastapi.testclient import TestClient

import main
import queries
from routers import sessions

SUBMISSION_ID = "5d0c1e9a-3b7f-4c2d-8e6a-9f1b2c3d4e5f"
START_MS = 1782877200000
MIDWAY_END_MS = START_MS + 180_000
FINAL_END_MS = START_MS + 420_000


def payload(stage: int, end_ms: int, correct: int, submission_id: str | None = SUBMISSION_ID) -> dict:
    data = {
        "grade": "G1",
        "caseId": "S03",
        "school": "測試場域",
        "currentDay": 1,
        "startTime": START_MS,
        "endTime": end_ms,
        "mode": "single",
        "stats": [
            {"apiname": "EFT_correct", "value": correct},
            {"apiname": "EFT_wrong", "value": 2},
            {"apiname": "EFT_accuracy", "value": 0.8},
            {"apiname": "EFT_duration", "value": end_ms - START_MS},
            {"apiname": "EFT_stage", "value": stage},
            {"apiname": "EFT_levelAccuracy", "value": ",".join(["0.8"] * stage)},
        ],
    }
    if submission_id is not None:
        data["submissionId"] = submission_id
    return {"lessonId": "1140908_EFT", "data": data}


# ---------------------------------------------------------------------------
# 路由層：寫入層以替身記錄呼叫，不需要資料庫。
# ---------------------------------------------------------------------------


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setattr(queries, "fetch_login_session", lambda token: {
        "subject_type": "student", "grade": "G1", "case_id": "S03",
        "school": "測試場域", "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
    } if token == "owner" else None)
    with TestClient(main.app, headers={"Authorization": "Bearer owner"}) as client:
        yield client


def test_duplicate_submission_upgrades_with_new_stats(api, monkeypatch):
    def duplicate_insert(**kwargs):
        raise pymysql.IntegrityError(1062, "duplicate")

    upgrades = []

    def record_upgrade(**kwargs):
        upgrades.append(kwargs)
        return True

    monkeypatch.setattr(sessions.writes, "insert_session_with_stats", duplicate_insert)
    monkeypatch.setattr(sessions.writes, "upgrade_session_stats", record_upgrade)

    response = api.post("/api/sessions", json=payload(6, FINAL_END_MS, correct=30))

    assert response.status_code == 201
    assert len(upgrades) == 1
    call = upgrades[0]
    assert call["session_id"] == response.json()["sessionId"]
    assert call["game_type"] == "EFT"
    assert call["stats"]["stage"] == 6
    assert call["stats"]["correct_count"] == 30
    assert call["end_time"] == sessions.ms_to_datetime(FINAL_END_MS)


def test_duplicate_without_submission_id_is_still_409(api, monkeypatch):
    def duplicate_insert(**kwargs):
        raise pymysql.IntegrityError(1062, "duplicate")

    def unexpected_upgrade(**kwargs):
        raise AssertionError("沒有 submissionId 時不能拿來更新別的列")

    monkeypatch.setattr(sessions.writes, "insert_session_with_stats", duplicate_insert)
    monkeypatch.setattr(sessions.writes, "upgrade_session_stats", unexpected_upgrade)

    response = api.post("/api/sessions", json=payload(6, FINAL_END_MS, correct=30, submission_id=None))

    assert response.status_code == 409


def test_other_integrity_errors_with_submission_id_are_not_upgrades(api, monkeypatch):
    def unknown_school(**kwargs):
        raise pymysql.IntegrityError(1452, "foreign key")

    def unexpected_upgrade(**kwargs):
        raise AssertionError("不是重複主鍵時不能更新")

    monkeypatch.setattr(sessions.writes, "insert_session_with_stats", unknown_school)
    monkeypatch.setattr(sessions.writes, "upgrade_session_stats", unexpected_upgrade)

    response = api.post("/api/sessions", json=payload(3, MIDWAY_END_MS, correct=12))

    assert response.status_code == 400
    assert response.json() == {"detail": "未知的場域（school 尚未登記）"}


def test_upgrade_failure_is_reported_as_write_error(api, monkeypatch):
    def duplicate_insert(**kwargs):
        raise pymysql.IntegrityError(1062, "duplicate")

    def broken_upgrade(**kwargs):
        raise RuntimeError("host=secret-db")

    monkeypatch.setattr(sessions.writes, "insert_session_with_stats", duplicate_insert)
    monkeypatch.setattr(sessions.writes, "upgrade_session_stats", broken_upgrade)

    response = api.post("/api/sessions", json=payload(6, FINAL_END_MS, correct=30))

    assert response.status_code == 500
    assert response.json() == {"detail": "資料庫寫入失敗"}
    assert "secret-db" not in response.text


# ---------------------------------------------------------------------------
# 實際寫入測試資料庫（需設定 TEST_DB_NAME）。
# ---------------------------------------------------------------------------


@pytest.fixture
def owner_client(client, db, login_as_student):
    db.insert_school("測試場域")
    _, headers = login_as_student(grade="G1", case_id="S03", school="測試場域")
    client.headers.update(headers)
    return client


def stored(db, session_id):
    rows = db.query(
        "SELECT a.start_time, a.end_time, r.stage, r.correct_count, r.level_accuracy "
        "FROM assessment_result a JOIN eft_result r "
        "ON a.grade = r.grade AND a.case_id = r.case_id AND a.school = r.school AND a.uuid = r.uuid "
        "WHERE a.uuid = %s",
        [session_id],
    )
    assert len(rows) == 1, "同一場只能有一列"
    return rows[0]


def test_midway_then_final_keeps_one_row_with_final_stats(owner_client, db):
    midway = owner_client.post("/api/sessions", json=payload(3, MIDWAY_END_MS, correct=12))
    final = owner_client.post("/api/sessions", json=payload(6, FINAL_END_MS, correct=30))

    assert midway.status_code == final.status_code == 201
    session_id = midway.json()["sessionId"]
    assert final.json()["sessionId"] == session_id
    row = stored(db, session_id)
    assert row["stage"] == 6
    assert row["correct_count"] == 30
    assert row["level_accuracy"].count(",") == 5  # 六關都有正確率
    assert row["start_time"] == sessions.ms_to_datetime(START_MS)
    assert row["end_time"] == sessions.ms_to_datetime(FINAL_END_MS)
    assert db.query("SELECT COUNT(*) AS n FROM assessment_result") == [{"n": 1}]


def test_late_midway_does_not_overwrite_final(owner_client, db):
    final = owner_client.post("/api/sessions", json=payload(6, FINAL_END_MS, correct=30))
    late_midway = owner_client.post("/api/sessions", json=payload(3, MIDWAY_END_MS, correct=12))

    assert final.status_code == late_midway.status_code == 201
    row = stored(db, final.json()["sessionId"])
    assert row["stage"] == 6
    assert row["correct_count"] == 30
    assert row["end_time"] == sessions.ms_to_datetime(FINAL_END_MS)


def test_resending_midway_keeps_midway_stats(owner_client, db):
    first = owner_client.post("/api/sessions", json=payload(3, MIDWAY_END_MS, correct=12))
    again = owner_client.post("/api/sessions", json=payload(3, MIDWAY_END_MS, correct=12))

    assert first.status_code == again.status_code == 201
    row = stored(db, first.json()["sessionId"])
    assert row["stage"] == 3
    assert row["correct_count"] == 12
    assert db.query("SELECT COUNT(*) AS n FROM eft_result") == [{"n": 1}]


def test_different_plays_stay_separate_rows(owner_client, db):
    first = owner_client.post("/api/sessions", json=payload(6, FINAL_END_MS, correct=30))
    other_play = payload(3, MIDWAY_END_MS, correct=12, submission_id="7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d")
    second = owner_client.post("/api/sessions", json=other_play)

    assert first.status_code == second.status_code == 201
    assert first.json()["sessionId"] != second.json()["sessionId"]
    assert db.query("SELECT COUNT(*) AS n FROM assessment_result") == [{"n": 2}]
