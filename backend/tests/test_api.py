"""既有端點的特性測試。

這些測試描述重構前的實際行為，包含不理想的部分（例如 endTime 的空字串），
目的是讓 Task 3–6 的搬移一旦改變行為就立刻失敗。
"""

from __future__ import annotations

from datetime import datetime


def test_root_returns_ok(client):
    response = client.get("/")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_returns_ok(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_sessions_returns_student_sessions(client, db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1",
        "S03",
        "測試場域",
        uuid="u1",
        game_type="DCCS",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
        end_time=datetime(2026, 7, 1, 9, 30, 0),
        current_day=1,
    )

    response = client.get(
        "/api/students/G1_S03/sessions", params={"school": "測試場域"}
    )

    assert response.status_code == 200
    assert response.json() == {
        "studentKey": "G1_S03",
        "grade": "G1",
        "caseId": "S03",
        "school": "測試場域",
        "sessions": [
            {
                "sessionId": "u1",
                "gameType": "DCCS",
                "mode": "single",
                "currentDay": 1,
                "startTime": "2026-07-01 09:00:00",
                "endTime": "2026-07-01 09:30:00",
            }
        ],
    }


def test_sessions_rejects_malformed_student_key(client, db):
    response = client.get("/api/students/G1/sessions", params={"school": "測試場域"})

    assert response.status_code == 400
    assert "studentKey" in response.json()["detail"]


def test_sessions_of_unknown_student_is_empty_not_404(client, db):
    response = client.get(
        "/api/students/G9_S99/sessions", params={"school": "測試場域"}
    )

    assert response.status_code == 200
    assert response.json()["sessions"] == []


def test_unfinished_session_end_time_is_empty_string(client, db):
    """記錄既有行為：end_time 為 NULL 時回傳空字串，而非 null。

    這是已知債務，本次不修改。新端點的 lastPlayedAt 使用 null。
    """
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1",
        "S03",
        "測試場域",
        uuid="u1",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
        end_time=None,
    )

    response = client.get(
        "/api/students/G1_S03/sessions", params={"school": "測試場域"}
    )

    assert response.json()["sessions"][0]["endTime"] == ""


def test_sessions_filters_by_game_type_and_normalizes_tgame(client, db):
    """Unity 送 TGame，資料庫存 TGAME，回應要送回 TGame。"""
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u1", game_type="TGAME",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
    )
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u2", game_type="DCCS",
        start_time=datetime(2026, 7, 2, 9, 0, 0),
    )

    response = client.get(
        "/api/students/G1_S03/sessions",
        params={"school": "測試場域", "game_type": "TGame"},
    )

    sessions = response.json()["sessions"]
    assert len(sessions) == 1
    assert sessions[0]["sessionId"] == "u1"
    assert sessions[0]["gameType"] == "TGame"
    assert sessions[0]["mode"] == "single"


def test_report_includes_stats_and_summary(client, db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u1", game_type="DCCS",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
        end_time=datetime(2026, 7, 1, 9, 30, 0),
    )
    db.insert_result(
        "dccs_result", "G1", "S03", "測試場域", "u1",
        correct_count=8, wrong_count=2, accuracy=0.8, duration=12000.0, stage=10,
    )

    response = client.get(
        "/api/students/G1_S03/report", params={"school": "測試場域"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["totalSessions"] == 1
    assert body["records"][0]["stats"] == {
        "correctCount": 8,
        "wrongCount": 2,
        "accuracy": 0.8,
        "duration": 12000.0,
        "stage": 10,
    }
    assert body["summaryByGame"] == [
        {
            "gameType": "DCCS",
            "mode": "single",
            "sessionCount": 1,
            "totalCorrect": 8,
            "totalWrong": 2,
            "avgAccuracy": 0.8,
            "totalDuration": 12000.0,
        }
    ]


def test_report_session_without_stats_row_has_null_stats(client, db):
    """assessment_result 有列，但細部表沒有對應列。"""
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u1", game_type="DCCS",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
    )

    response = client.get(
        "/api/students/G1_S03/report", params={"school": "測試場域"}
    )

    body = response.json()
    assert body["records"][0]["stats"] is None
    assert body["summaryByGame"] == [
        {
            "gameType": "DCCS",
            "mode": "single",
            "sessionCount": 1,
            "totalCorrect": 0,
            "totalWrong": 0,
            "avgAccuracy": 0.0,
            "totalDuration": 0.0,
        }
    ]


def test_sessions_are_ordered_by_start_time_descending(client, db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="old",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
    )
    db.insert_session(
        "G1", "S03", "測試場域", uuid="new",
        start_time=datetime(2026, 7, 8, 9, 0, 0),
    )

    response = client.get(
        "/api/students/G1_S03/sessions", params={"school": "測試場域"}
    )

    ids = [s["sessionId"] for s in response.json()["sessions"]]
    assert ids == ["new", "old"]


def test_sessions_db_error_returns_500_without_leaking_exception(
    client, db, break_query
):
    break_query("fetch_assessment_rows")

    response = client.get(
        "/api/students/G1_S03/sessions", params={"school": "測試場域"}
    )

    assert response.status_code == 500
    assert response.json() == {"detail": "資料庫查詢失敗"}
    assert "43.163.233.40" not in response.text
    assert "root" not in response.text


def test_report_db_error_returns_500_without_leaking_exception(
    client, db, break_query
):
    break_query("fetch_assessment_rows")

    response = client.get(
        "/api/students/G1_S03/report", params={"school": "測試場域"}
    )

    assert response.status_code == 500
    assert response.json() == {"detail": "資料庫查詢失敗"}
    assert "43.163.233.40" not in response.text


# --- GET /api/students ---


def test_list_students_without_school_returns_all_schools(client, db):
    db.insert_student("G1", "S03", "SchoolA")
    db.insert_student("G1", "S03", "SchoolB")

    response = client.get("/api/students")

    assert response.status_code == 200
    body = response.json()
    assert body["school"] is None
    assert body["studentCount"] == 2
    assert [(s["studentKey"], s["school"]) for s in body["students"]] == [
        ("G1_S03", "SchoolA"),
        ("G1_S03", "SchoolB"),
    ]


def test_list_students_with_school_filters_and_echoes_it(client, db):
    db.insert_student("G1", "S03", "SchoolA")
    db.insert_student("G1", "S03", "SchoolB")

    response = client.get("/api/students", params={"school": "SchoolA"})

    body = response.json()
    assert body["school"] == "SchoolA"
    assert body["studentCount"] == 1
    assert body["students"][0]["school"] == "SchoolA"


def test_list_students_includes_zero_session_students(client, db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_student("G1", "S04", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u1",
        start_time=datetime(2026, 7, 8, 14, 30, 0),
    )

    response = client.get("/api/students", params={"school": "測試場域"})

    assert response.json()["students"] == [
        {
            "studentKey": "G1_S03",
            "grade": "G1",
            "caseId": "S03",
            "school": "測試場域",
            "sessionCount": 1,
            "lastPlayedAt": "2026-07-08 14:30:00",
        },
        {
            "studentKey": "G1_S04",
            "grade": "G1",
            "caseId": "S04",
            "school": "測試場域",
            "sessionCount": 0,
            "lastPlayedAt": None,
        },
    ]


def test_list_students_blank_school_is_treated_as_not_given(client, db):
    db.insert_student("G1", "S03", "SchoolA")
    db.insert_student("G1", "S03", "SchoolB")

    response = client.get("/api/students", params={"school": "   "})

    body = response.json()
    assert body["school"] is None
    assert body["studentCount"] == 2


def test_list_students_of_unknown_school_is_200_with_empty_list(client, db):
    db.insert_student("G1", "S03", "測試場域")

    response = client.get("/api/students", params={"school": "不存在的場域"})

    assert response.status_code == 200
    assert response.json() == {
        "school": "不存在的場域",
        "studentCount": 0,
        "students": [],
    }


def test_list_students_student_count_matches_list_length(client, db):
    for index in range(3):
        db.insert_student("G1", f"S0{index}", "測試場域")

    body = client.get("/api/students").json()

    assert body["studentCount"] == len(body["students"]) == 3


def test_list_students_db_error_returns_500_without_leaking_exception(
    client, db, break_query
):
    break_query("fetch_students")

    response = client.get("/api/students")

    assert response.status_code == 500
    assert response.json() == {"detail": "資料庫查詢失敗"}
    assert "43.163.233.40" not in response.text


def test_report_includes_trends_ascending_by_time(client, db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u_old", game_type="DCCS",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
    )
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u_new", game_type="DCCS",
        start_time=datetime(2026, 7, 8, 9, 0, 0),
    )
    db.insert_result(
        "dccs_result", "G1", "S03", "測試場域", "u_old",
        correct_count=8, wrong_count=2, accuracy=0.8, duration=12000.0, stage=10,
    )
    db.insert_result(
        "dccs_result", "G1", "S03", "測試場域", "u_new",
        correct_count=15, wrong_count=1, accuracy=0.95, duration=9000.0, stage=12,
    )

    body = client.get(
        "/api/students/G1_S03/report", params={"school": "測試場域"}
    ).json()

    assert body["trends"] == [
        {
            "gameType": "DCCS",
            "mode": "single",
            "items": [
                {
                    "type": "correctCount",
                    "stats": [
                        {"time": "2026-07-01 09:00:00", "value": 8},
                        {"time": "2026-07-08 09:00:00", "value": 15},
                    ],
                },
                {
                    "type": "wrongCount",
                    "stats": [
                        {"time": "2026-07-01 09:00:00", "value": 2},
                        {"time": "2026-07-08 09:00:00", "value": 1},
                    ],
                },
                {
                    "type": "accuracy",
                    "stats": [
                        {"time": "2026-07-01 09:00:00", "value": 0.8},
                        {"time": "2026-07-08 09:00:00", "value": 0.95},
                    ],
                },
            ],
        }
    ]


def _seed_single_and_double_dat(db):
    """DAT 單人 3 場、DAT 雙人 2 場，皆帶 stats。"""
    db.insert_student("G1", "S03", "測試場域")
    for i in range(3):
        uuid = f"s{i}"
        db.insert_session(
            "G1", "S03", "測試場域", uuid=uuid, game_type="DAT", mode="single",
            start_time=datetime(2026, 7, 1 + i, 9, 0, 0),
        )
        db.insert_result(
            "dat_result", "G1", "S03", "測試場域", uuid,
            correct_count=5 + i, wrong_count=2, accuracy=0.7, duration=1000.0, stage=10,
        )
    for i in range(2):
        uuid = f"d{i}"
        db.insert_session(
            "G1", "S03", "測試場域", uuid=uuid, game_type="DAT", mode="double",
            pair_id="pair-x", start_time=datetime(2026, 7, 10 + i, 9, 0, 0),
        )
        db.insert_result(
            "dat_result", "G1", "S03", "測試場域", uuid,
            correct_count=9, wrong_count=1, accuracy=0.9, duration=1000.0, stage=10,
        )


def test_report_summary_splits_single_and_double(client, db):
    _seed_single_and_double_dat(db)

    body = client.get(
        "/api/students/G1_S03/report", params={"school": "測試場域"}
    ).json()

    summary = {(s["gameType"], s["mode"]): s for s in body["summaryByGame"]}
    assert summary[("DAT", "single")]["sessionCount"] == 3
    assert summary[("DAT", "double")]["sessionCount"] == 2
    assert [r["mode"] for r in body["records"]].count("double") == 2


def test_report_trends_split_by_mode_contain_only_that_mode(client, db):
    _seed_single_and_double_dat(db)

    body = client.get(
        "/api/students/G1_S03/report", params={"school": "測試場域"}
    ).json()

    trends = {(t["gameType"], t["mode"]): t for t in body["trends"]}
    single_correct = next(
        i for i in trends[("DAT", "single")]["items"] if i["type"] == "correctCount"
    )
    assert [p["value"] for p in single_correct["stats"]] == [5, 6, 7]
    double_correct = next(
        i for i in trends[("DAT", "double")]["items"] if i["type"] == "correctCount"
    )
    assert [p["value"] for p in double_correct["stats"]] == [9, 9]


def test_report_mode_filter_returns_only_that_mode(client, db):
    _seed_single_and_double_dat(db)

    body = client.get(
        "/api/students/G1_S03/report",
        params={"school": "測試場域", "mode": "double"},
    ).json()

    assert {r["mode"] for r in body["records"]} == {"double"}
    assert [(s["gameType"], s["mode"]) for s in body["summaryByGame"]] == [
        ("DAT", "double")
    ]


def test_report_game_type_and_mode_filters_combine(client, db):
    _seed_single_and_double_dat(db)
    db.insert_session(
        "G1", "S03", "測試場域", uuid="dccs1", game_type="DCCS", mode="single",
        start_time=datetime(2026, 8, 1, 9, 0, 0),
    )

    body = client.get(
        "/api/students/G1_S03/report",
        params={"school": "測試場域", "game_type": "DAT", "mode": "single"},
    ).json()

    assert body["totalSessions"] == 3
    assert {(s["gameType"], s["mode"]) for s in body["summaryByGame"]} == {
        ("DAT", "single")
    }


def test_sessions_mode_filter(client, db):
    _seed_single_and_double_dat(db)

    body = client.get(
        "/api/students/G1_S03/sessions",
        params={"school": "測試場域", "mode": "double"},
    ).json()

    assert [s["mode"] for s in body["sessions"]] == ["double", "double"]


def test_report_session_without_stats_has_empty_trends(client, db):
    db.insert_student("G1", "S03", "測試場域")
    db.insert_session(
        "G1", "S03", "測試場域", uuid="u1", game_type="DCCS",
        start_time=datetime(2026, 7, 1, 9, 0, 0),
    )  # 無對應 dccs_result 列

    body = client.get(
        "/api/students/G1_S03/report", params={"school": "測試場域"}
    ).json()

    assert body["trends"] == []
