"""Unity 場次寫入 API 的行為測試。"""

from __future__ import annotations

from datetime import datetime

import pymysql
import pytest
from fastapi.testclient import TestClient

import main
from routers import sessions


def dccs_payload() -> dict:
    return {
        "planId": "plan-ignored",
        "deviceId": "device-ignored",
        "lessonId": "lesson25_DCCS",
        "data": {
            "grade": "G1",
            "caseId": "S03",
            "school": "測試場域",
            "currentDay": 1,
            "startStage": 1,
            "startTime": 1782877200000,
            "endTime": 1782877560000,
            "stats": [
                {"apiname": "DCCS_correct", "value": 10},
                {"apiname": "DCCS_wrong", "value": 2},
                {"apiname": "DCCS_accuracy", "value": 0.83},
                {"apiname": "DCCS_duration", "value": 360000},
                {"apiname": "DCCS_stage", "value": 5},
                {"apiname": "DCCS_frameWrongCount", "value": 99},
            ],
            "unlockedAchievements": [{"apiname": "DCCS_first", "unlocktime": 1}],
        },
    }


@pytest.fixture(autouse=True)
def _register_school(request):
    """走真實寫入路徑的 POST 測試（帶 db／client fixture）需要 '測試場域'
    這個場域先登記，否則 student.school 外鍵會擋下寫入。"""
    if "db" not in request.fixturenames and "client" not in request.fixturenames:
        return
    request.getfixturevalue("db").insert_school("測試場域")


@pytest.fixture
def write_calls(monkeypatch):
    calls = []

    def record_write(**kwargs):
        calls.append(kwargs)
        return "123e4567-e89b-42d3-a456-426614174000"

    monkeypatch.setattr(sessions.writes, "insert_session_with_stats", record_write)
    return calls


def test_post_session_returns_created_response(monkeypatch):
    monkeypatch.setattr(
        sessions.writes,
        "insert_session_with_stats",
        lambda **kwargs: "123e4567-e89b-42d3-a456-426614174000",
    )

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=dccs_payload())

    assert response.status_code == 201
    assert response.json() == {
        "sessionId": "123e4567-e89b-42d3-a456-426614174000",
        "message": "已接收",
    }


def test_post_session_missing_core_stat_returns_400_without_writing(monkeypatch):
    def unexpected_write(**kwargs):
        raise AssertionError("缺少 Core Value 時不應進入寫入層")

    monkeypatch.setattr(sessions.writes, "insert_session_with_stats", unexpected_write)
    payload = dccs_payload()
    payload["data"]["stats"] = [{"apiname": "DCCS_correct", "value": 10}]

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 400
    assert response.json() == {"detail": "缺少必要統計：DCCS_wrong"}


@pytest.mark.parametrize(
    ("game_name", "db_game_type"),
    [
        ("DCCS", "DCCS"),
        ("DAT", "DAT"),
        ("EFT", "EFT"),
        ("IM", "IM"),
        ("TGame", "TGAME"),
    ],
)
def test_post_session_maps_each_unity_game_to_db_type(
    write_calls, game_name, db_game_type
):
    payload = dccs_payload()
    payload["lessonId"] = f"lesson25_{game_name}"
    for stat in payload["data"]["stats"]:
        stat["apiname"] = stat["apiname"].replace("DCCS_", f"{game_name}_")

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 201
    assert write_calls[0]["game_type"] == db_game_type


def test_post_session_applies_reference_conversion_rules(write_calls):
    payload = dccs_payload()
    payload["lessonId"] = "DCCS"
    payload["data"].update(
        {
            "grade": "  G1  ",
            "caseId": "  S03  ",
            "school": "  測試場域  ",
            "currentDay": "1",
            "startTime": "1782877200123",
            "endTime": "1782877560456",
        }
    )
    payload["data"]["stats"] = [
        {"apiname": "DCCS_correct", "value": 1},
        {"apiname": "DCCS_correct", "value": "10"},
        {"apiname": "DCCS_wrong", "value": None},
        {"apiname": "DCCS_accuracy", "value": "0.83"},
        {"apiname": "DCCS_duration", "value": -1},
        {"apiname": "DCCS_stage", "value": "5"},
        {"apiname": "DCCS_frameWrongCount", "value": 99},
    ]

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 201
    assert write_calls == [
        {
            "grade": "G1",
            "case_id": "S03",
            "school": "測試場域",
            "start_time": datetime(2026, 7, 1, 3, 40, 0, 123000),
            "game_type": "DCCS",
            "current_day": 1,
            "end_time": datetime(2026, 7, 1, 3, 46, 0, 456000),
            "stats": {
                "correct_count": 10,
                "wrong_count": 0,
                "accuracy": 0.83,
                "duration": -1.0,
                "stage": 5,
            },
            "mode": "single",
            "pair_id": None,
        }
    ]


def _dat_double_payload(pair_id: str | None = "6f1c8e2a-3b7d-4e11-9a52-0c9d7f2b1e44") -> dict:
    payload = dccs_payload()
    payload["lessonId"] = "lesson25_DAT"
    for stat in payload["data"]["stats"]:
        stat["apiname"] = stat["apiname"].replace("DCCS_", "DAT_")
    payload["data"]["mode"] = "double"
    if pair_id is None:
        payload["data"].pop("pairId", None)
    else:
        payload["data"]["pairId"] = pair_id
    return payload


def test_post_session_double_mode_passes_mode_and_pair_id_to_writer(write_calls):
    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=_dat_double_payload())

    assert response.status_code == 201
    assert write_calls[0]["mode"] == "double"
    assert write_calls[0]["pair_id"] == "6f1c8e2a-3b7d-4e11-9a52-0c9d7f2b1e44"


def test_post_session_without_mode_defaults_to_single(write_calls):
    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=dccs_payload())

    assert response.status_code == 201
    assert write_calls[0]["mode"] == "single"
    assert write_calls[0]["pair_id"] is None


def test_post_session_double_mode_rejects_non_capable_game(write_calls):
    payload = dccs_payload()
    payload["lessonId"] = "lesson25_TGame"
    for stat in payload["data"]["stats"]:
        stat["apiname"] = stat["apiname"].replace("DCCS_", "TGame_")
    payload["data"]["mode"] = "double"
    payload["data"]["pairId"] = "p1"

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 400
    assert "雙人版僅支援" in response.json()["detail"]
    assert write_calls == []


def test_post_session_double_mode_without_pair_id_is_accepted(write_calls):
    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=_dat_double_payload(pair_id=None))

    assert response.status_code == 201
    assert write_calls[0]["mode"] == "double"
    assert write_calls[0]["pair_id"] is None


def test_post_session_single_mode_ignores_stray_pair_id(write_calls):
    payload = dccs_payload()
    payload["data"]["pairId"] = "should-be-ignored"

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 201
    assert write_calls[0]["pair_id"] is None


def test_post_session_rejects_overlong_pair_id(write_calls):
    with TestClient(main.app) as client:
        response = client.post(
            "/api/sessions", json=_dat_double_payload(pair_id="x" * 37)
        )

    assert response.status_code == 400
    assert response.json() == {"detail": "pairId 格式錯誤"}
    assert write_calls == []


@pytest.mark.parametrize("bad_mode", ["x", "SOLO", "1"])
def test_post_session_rejects_invalid_mode(write_calls, bad_mode):
    payload = dccs_payload()
    payload["data"]["mode"] = bad_mode

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 422
    assert write_calls == []


def test_post_session_double_mode_persisted_and_retrievable(client, db):
    response = client.post("/api/sessions", json=_dat_double_payload())

    assert response.status_code == 201
    session_id = response.json()["sessionId"]
    assert db.query(
        "SELECT mode, pair_id FROM assessment_result WHERE uuid = %s", [session_id]
    ) == [{"mode": "double", "pair_id": "6f1c8e2a-3b7d-4e11-9a52-0c9d7f2b1e44"}]


@pytest.mark.parametrize("missing_field", ["currentDay", "endTime", "stats"])
def test_post_session_missing_required_field_returns_422(write_calls, missing_field):
    payload = dccs_payload()
    del payload["data"][missing_field]

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 422
    assert write_calls == []


@pytest.mark.parametrize("field", ["grade", "caseId", "school"])
def test_post_session_blank_identity_field_returns_422(write_calls, field):
    payload = dccs_payload()
    payload["data"][field] = "   "

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 422
    assert write_calls == []


@pytest.mark.parametrize("lesson_id", ["lesson25_UNKNOWN", "lesson25_TGAME", ""])
def test_post_session_rejects_unknown_or_invalid_game(write_calls, lesson_id):
    payload = dccs_payload()
    payload["lessonId"] = lesson_id

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 400
    assert write_calls == []


def test_post_session_rejects_unconvertible_core_value(write_calls):
    payload = dccs_payload()
    payload["data"]["stats"][0]["value"] = "not-a-number"

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 400
    assert write_calls == []


def test_post_session_rejects_reversed_time_range(write_calls):
    payload = dccs_payload()
    payload["data"]["endTime"] = payload["data"]["startTime"] - 1

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 400
    assert response.json() == {"detail": "endTime 不可早於 startTime"}
    assert write_calls == []


def test_post_session_accepts_equal_start_and_end_time(write_calls):
    payload = dccs_payload()
    payload["data"]["endTime"] = payload["data"]["startTime"]

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 201
    assert write_calls[0]["end_time"] == write_calls[0]["start_time"]


def test_post_session_rejects_out_of_range_timestamp(write_calls):
    payload = dccs_payload()
    payload["data"]["startTime"] = 10**30

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 400
    assert response.json() == {"detail": "時間戳記無效"}
    assert write_calls == []


@pytest.mark.parametrize(
    ("error", "expected_status", "expected_detail"),
    [
        (pymysql.IntegrityError(1062, "duplicate"), 409, "場次已存在"),
        (
            pymysql.IntegrityError(1452, "foreign key"),
            400,
            "未知的場域（school 尚未登記）",
        ),
        (pymysql.IntegrityError(1048, "column cannot be null"), 500, "資料庫寫入失敗"),
        (RuntimeError("host=secret-db user=root"), 500, "資料庫寫入失敗"),
    ],
)
def test_post_session_maps_write_errors_without_leaking_details(
    monkeypatch, error, expected_status, expected_detail
):
    def fail_write(**kwargs):
        raise error

    monkeypatch.setattr(sessions.writes, "insert_session_with_stats", fail_write)

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=dccs_payload())

    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}
    assert "secret-db" not in response.text
    assert "root" not in response.text


def test_post_session_writes_session_retrievable_by_existing_api(
    client, db, login_as_teacher
):
    payload = dccs_payload()
    payload["data"]["startTime"] += 123
    payload["data"]["endTime"] += 456

    post_response = client.post("/api/sessions", json=payload)

    assert post_response.status_code == 201
    session_id = post_response.json()["sessionId"]
    assert db.query(
        """
        SELECT correct_count, frameWrongCount
        FROM dccs_result
        WHERE uuid = %s
        """,
        [session_id],
    ) == [{"correct_count": 10, "frameWrongCount": None}]

    # POST /api/sessions 是 Unity 用的，無驗證；GET /sessions 是人看的，帳密登入後
    # 要帶 token —— 這裡登入一位「測試場域」的老師來查剛才 Unity 寫入的場次。
    _, headers = login_as_teacher(school="測試場域")
    get_response = client.get(
        "/api/students/G1_S03/sessions", params={"school": "測試場域"}, headers=headers
    )
    assert get_response.status_code == 200
    assert get_response.json()["sessions"] == [
        {
            "sessionId": session_id,
            "gameType": "DCCS",
            "mode": "single",
            "currentDay": 1,
            "startTime": "2026-07-01 03:40:00",
            "endTime": "2026-07-01 03:46:00",
        }
    ]
