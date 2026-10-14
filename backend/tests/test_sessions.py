"""Unity 場次寫入 API 的行為測試。"""

from __future__ import annotations

import json
from datetime import datetime

import pymysql
import pytest
from fastapi.testclient import TestClient as BaseTestClient
from datetime import timedelta, timezone
from uuid import UUID

import queries

import main
from routers import sessions



class TestClient(BaseTestClient):
    __test__ = False

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("headers", {"Authorization": "Bearer owner", "X-Partner-Authorization": "Bearer partner"})
        super().__init__(*args, **kwargs)


@pytest.fixture(autouse=True)
def session_writer_login(request, monkeypatch):
    # 格式與轉換測試使用可驗證的學生。整合測試登入實際的測試資料庫。
    if "db" in request.fixturenames or "client" in request.fixturenames:
        login = request.getfixturevalue("login_as_student")
        _, owner = login(grade="G1", case_id="S03", school="測試場域")
        _, partner = login(grade="G2", case_id="S04", school="其他場域")
        client = request.getfixturevalue("client")
        client.headers.update(owner)
        client.headers["X-Partner-Authorization"] = partner["Authorization"]
    else:
        monkeypatch.setattr(queries, "fetch_login_session", lambda token: {
            "subject_type": "student", "grade": "G1", "case_id": "S03",
            "school": "測試場域", "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        } if token in {"owner", "partner"} else None)


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
    """POST 整合測試使用 db／client fixture，並執行實際寫入流程。
須先登記「測試場域」，否則 student.school 的外鍵會拒絕寫入。
"""
    if "db" not in request.fixturenames and "client" not in request.fixturenames:
        return
    request.getfixturevalue("db").insert_school("測試場域")


@pytest.fixture
def write_calls(monkeypatch):
    calls = []

    def record_write(**kwargs):
        calls.append(kwargs)
        # 跟真正的寫入層一樣：有傳 session_id 就用它，沒有才自己產生。
        return kwargs.get("session_id") or "123e4567-e89b-42d3-a456-426614174000"

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


def test_post_session_stores_per_level_accuracy(write_calls):
    payload = dccs_payload()
    payload["data"]["stats"].append(
        {"apiname": "DCCS_levelAccuracy", "value": "1,0.5,0"}
    )

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 201
    assert write_calls[0]["stats"]["level_accuracy"] == "1.0000,0.5000,0.0000"
    assert write_calls[0]["stats"]["accuracy"] == 0.83


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
            "session_id": None,
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


def test_post_session_double_mode_accepts_tgame(write_calls):
    payload = dccs_payload()
    payload["lessonId"] = "lesson25_TGame"
    for stat in payload["data"]["stats"]:
        stat["apiname"] = stat["apiname"].replace("DCCS_", "TGame_")
    payload["data"]["mode"] = "double"
    payload["data"]["pairId"] = "p1"

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 201
    assert write_calls[0]["mode"] == "double"
    assert write_calls[0]["game_type"] == "TGAME"


def test_post_session_double_mode_rejects_non_capable_game(write_calls):
    payload = dccs_payload()
    payload["lessonId"] = "lesson25_IM"
    for stat in payload["data"]["stats"]:
        stat["apiname"] = stat["apiname"].replace("DCCS_", "IM_")
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


@pytest.mark.parametrize(
    ("index", "value"),
    [
        (0, "nan"),
        (0, "Infinity"),
        (0, "__RAW__1e400"),  # JSON 數字 1e400 會被解析成 float inf
        (2, "__RAW__NaN"),  # Python json 接受 NaN／Infinity 字面值
        (3, "__RAW__Infinity"),
        (0, [10]),
        (0, {"n": 10}),
        (2, "nan"),
        (2, "-Infinity"),
        (3, "Infinity"),
        (3, [360000]),
        (4, {"stage": 5}),
    ],
)
def test_post_session_rejects_non_finite_or_non_numeric_core_value(write_calls, index, value):
    """NaN／Infinity／陣列／物件都是格式錯誤，回 400，不可變成 500「資料庫寫入失敗」。"""
    payload = dccs_payload()
    payload["data"]["stats"][index]["value"] = value
    body = json.dumps(payload)
    if isinstance(value, str) and value.startswith("__RAW__"):
        body = body.replace(f'"{value}"', value.removeprefix("__RAW__"))

    with TestClient(main.app) as client:
        response = client.post(
            "/api/sessions", content=body, headers={"Content-Type": "application/json"}
        )

    assert response.status_code == 400, response.text
    apiname = payload["data"]["stats"][index]["apiname"]
    assert response.json() == {"detail": f"{apiname} 必須是數字"}
    assert write_calls == []


@pytest.mark.parametrize("suffix", ["avgReactionMs", "aimRatio", "focusMs", "questionCount"])
def test_post_session_rejects_infinite_optional_stat(write_calls, suffix):
    payload = dccs_payload()
    payload["data"]["stats"].append({"apiname": f"DCCS_{suffix}", "value": "Infinity"})

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 400, response.text
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

    # 成績由登入學生寫入，再登入同場域老師查詢。
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


# 前端逾時後重送同一筆成績時帶同一個 submissionId。後端用「學生身分 + submissionId」
# 推導出場次 UUID（uuid5）：同一位學生重送得到同一個 UUID，第二次寫入撞主鍵就當作
# 已收過；不同學生就算帶同一個 submissionId，UUID 也不會相同（uuid 在報表查詢裡
# 被當成全域唯一，見 queries.fetch_game_stats_by_uuids）。
SUBMISSION_ID = "0b8f5c2e-6d1a-4f3b-9c7e-2a4d6e8f1b3c"


def _student_token_lookup(token):
    students = {
        "owner": ("G1", "S03"),
        "other": ("G1", "S04"),
    }
    if token not in students:
        return None
    grade, case_id = students[token]
    return {
        "subject_type": "student", "grade": grade, "case_id": case_id,
        "school": "測試場域", "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
    }


def test_post_session_derives_session_uuid_from_submission_id(write_calls):
    payload = dccs_payload()
    payload["data"]["submissionId"] = SUBMISSION_ID

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 201
    session_id = write_calls[0]["session_id"]
    assert str(UUID(session_id)) == session_id
    # 不能直接拿 submissionId 當 uuid：別的學生可以送同一個值。
    assert session_id != SUBMISSION_ID
    assert response.json()["sessionId"] == session_id


def test_post_session_same_student_resend_maps_to_same_session_uuid(write_calls):
    """重送同一筆（大小寫不同也算）要推導出同一個 UUID，主鍵才擋得住重複。"""
    first = dccs_payload()
    first["data"]["submissionId"] = SUBMISSION_ID
    second = dccs_payload()
    second["data"]["submissionId"] = SUBMISSION_ID.upper()

    with TestClient(main.app) as client:
        assert client.post("/api/sessions", json=first).status_code == 201
        assert client.post("/api/sessions", json=second).status_code == 201

    assert write_calls[0]["session_id"] == write_calls[1]["session_id"]


def test_post_session_different_students_same_submission_id_get_different_uuids(
    write_calls, monkeypatch
):
    monkeypatch.setattr(queries, "fetch_login_session", _student_token_lookup)
    owner_payload = dccs_payload()
    owner_payload["data"]["submissionId"] = SUBMISSION_ID
    other_payload = dccs_payload()
    other_payload["data"]["caseId"] = "S04"
    other_payload["data"]["submissionId"] = SUBMISSION_ID

    with TestClient(main.app) as client:
        owner = client.post("/api/sessions", json=owner_payload)
        other = client.post(
            "/api/sessions", json=other_payload, headers={"Authorization": "Bearer other"}
        )

    assert owner.status_code == other.status_code == 201
    assert write_calls[0]["session_id"] != write_calls[1]["session_id"]
    assert owner.json()["sessionId"] != other.json()["sessionId"]


def test_post_session_without_submission_id_lets_writer_generate_uuid(write_calls):
    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=dccs_payload())

    assert response.status_code == 201
    assert write_calls[0]["session_id"] is None


@pytest.mark.parametrize("bad_id", ["not-a-uuid", "123", "0b8f5c2e-6d1a-4f3b-9c7e-2a4d6e8f1b3c-extra"])
def test_post_session_rejects_malformed_submission_id(write_calls, bad_id):
    payload = dccs_payload()
    payload["data"]["submissionId"] = bad_id

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 400
    assert write_calls == []


def test_post_session_replayed_submission_id_is_accepted_without_new_row(monkeypatch):
    attempted = []

    def duplicate_write(**kwargs):
        attempted.append(kwargs["session_id"])
        raise pymysql.IntegrityError(1062, "duplicate")

    monkeypatch.setattr(sessions.writes, "insert_session_with_stats", duplicate_write)
    # 同一筆重送：關卡沒有比較高，寫入層不會更新（中場檢查點的更新見 test_session_checkpoint_upgrade.py）。
    monkeypatch.setattr(sessions.writes, "upgrade_session_stats", lambda **kwargs: False)
    payload = dccs_payload()
    payload["data"]["submissionId"] = SUBMISSION_ID

    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=payload)

    assert response.status_code == 201
    # 回的是先前那一筆（同一個推導 UUID），不是原始 submissionId。
    assert response.json()["sessionId"] == attempted[0]
    assert attempted[0] != SUBMISSION_ID


def test_post_session_retry_with_same_submission_id_stores_one_row(client, db):
    payload = dccs_payload()
    payload["data"]["submissionId"] = SUBMISSION_ID

    first = client.post("/api/sessions", json=payload)
    second = client.post("/api/sessions", json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    session_id = first.json()["sessionId"]
    assert second.json()["sessionId"] == session_id
    assert session_id != SUBMISSION_ID
    assert db.query(
        "SELECT COUNT(*) AS n FROM assessment_result WHERE uuid = %s", [session_id]
    ) == [{"n": 1}]
    assert db.query(
        "SELECT COUNT(*) AS n FROM dccs_result WHERE uuid = %s", [session_id]
    ) == [{"n": 1}]


def test_post_session_two_students_same_submission_id_store_distinct_uuids(
    client, db, login_as_student
):
    _, other_headers = login_as_student(grade="G1", case_id="S05", school="測試場域")
    owner_payload = dccs_payload()
    owner_payload["data"]["submissionId"] = SUBMISSION_ID
    other_payload = dccs_payload()
    other_payload["data"]["caseId"] = "S05"
    other_payload["data"]["submissionId"] = SUBMISSION_ID

    owner = client.post("/api/sessions", json=owner_payload)
    other = client.post("/api/sessions", json=other_payload, headers=other_headers)

    assert owner.status_code == other.status_code == 201
    owner_id, other_id = owner.json()["sessionId"], other.json()["sessionId"]
    assert owner_id != other_id
    assert db.query(
        "SELECT COUNT(*) AS n FROM assessment_result WHERE uuid IN (%s, %s)",
        [owner_id, other_id],
    ) == [{"n": 2}]
    stats = queries.fetch_game_stats_by_uuids("dccs_result", [owner_id, other_id])
    assert set(stats) == {owner_id, other_id}
