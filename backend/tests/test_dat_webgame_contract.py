"""動物追擊令網頁版沿用 EFT 寫入契約；所有寫入皆替換成記錄器。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import main
from routers import sessions


@pytest.fixture
def write_calls(monkeypatch):
    calls = []

    def record_write(**kwargs):
        calls.append(kwargs)
        return f"00000000-0000-4000-8000-{len(calls):012d}"

    monkeypatch.setattr(sessions.writes, "insert_session_with_stats", record_write)
    return calls


def webgame_payload(case_id="S03", mode="single", pair_id=None):
    data = {
        "grade": "G1",
        "caseId": case_id,
        "school": "網頁版契約測試",
        "currentDay": 1,
        "startTime": 1782877200000,
        "endTime": 1782877560000,
        "mode": mode,
        "stats": [
            {"apiname": "EFT_correct", "value": 27},
            {"apiname": "EFT_wrong", "value": 9},
            {"apiname": "EFT_accuracy", "value": 0.75},
            {"apiname": "EFT_duration", "value": 360000},
            {"apiname": "EFT_stage", "value": 6},
            {"apiname": "EFT_levelAccuracy", "value": "1,0.5,1,0.5,1,0.5"},
            {"apiname": "EFT_avgReactionMs", "value": 1250},
            {"apiname": "EFT_questionCount", "value": 36},
            {"apiname": "EFT_aimRatio", "value": 0.8},
            {"apiname": "EFT_focusMs", "value": 288000},
        ],
    }
    if pair_id is not None:
        data["pairId"] = pair_id
    return {"lessonId": "1140908_EFT", "data": data}


def assert_six_stage_eft_write(call):
    assert call["game_type"] == "EFT"
    assert call["stats"] == {
        "correct_count": 27,
        "wrong_count": 9,
        "accuracy": 0.75,
        "duration": 360000.0,
        "stage": 6,
        "level_accuracy": "1.0000,0.5000,1.0000,0.5000,1.0000,0.5000",
        "avg_reaction_ms": 1250.0,
        "question_count": 36,
        "aim_ratio": 0.8,
        "focus_ms": 288000.0,
    }


def test_dat_single_webgame_is_accepted_as_six_stage_eft(write_calls):
    with TestClient(main.app) as client:
        response = client.post("/api/sessions", json=webgame_payload())

    assert response.status_code == 201, response.text
    assert len(write_calls) == 1
    assert write_calls[0]["case_id"] == "S03"
    assert write_calls[0]["mode"] == "single"
    assert write_calls[0]["pair_id"] is None
    assert_six_stage_eft_write(write_calls[0])


def test_dat_double_webgame_stores_each_player_with_shared_pair_id(write_calls):
    pair_id = "6f1c8e2a-3b7d-4e11-9a52-0c9d7f2b1e44"
    with TestClient(main.app) as client:
        responses = [
            client.post(
                "/api/sessions", json=webgame_payload(case_id, "double", pair_id)
            )
            for case_id in ("S01", "S02")
        ]

    assert [response.status_code for response in responses] == [201, 201]
    assert len({response.json()["sessionId"] for response in responses}) == 2
    assert [call["case_id"] for call in write_calls] == ["S01", "S02"]
    for call in write_calls:
        assert call["mode"] == "double"
        assert call["pair_id"] == pair_id
        assert_six_stage_eft_write(call)
