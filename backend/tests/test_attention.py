"""手錶專心判定轉發端點 GET /api/attention/me 的測試。

不存取資料庫。使用 dependency_overrides 替換學生身分，使用 monkeypatch 替換手錶平台。
"""

from __future__ import annotations

import urllib.error

import pytest
from fastapi.testclient import TestClient

import main
from routers import attention
from routers.identity import Identity, require_student


@pytest.fixture
def student_client():
    def fake_student() -> Identity:
        return Identity(subject_type="student", grade="G1", case_id="S01", school="A")

    main.app.dependency_overrides[require_student] = fake_student
    try:
        with TestClient(main.app) as test_client:
            yield test_client
    finally:
        main.app.dependency_overrides.pop(require_student, None)


@pytest.fixture(autouse=True)
def no_mock_env(monkeypatch):
    monkeypatch.delenv("WATCH_PREDICT_MOCK", raising=False)


# 學號對應


@pytest.mark.parametrize(
    ("case_id", "expected"),
    [("S01", "S001"), ("S6", "S006"), ("s12", "S012"), ("S100", "S100"), (" S03 ", "S003")],
)
def test_watch_subject_id_pads_number_to_three_digits(case_id, expected):
    assert attention.watch_subject_id(case_id) == expected


@pytest.mark.parametrize("case_id", [None, "", "S", "01", "S01A", "G1_S01"])
def test_watch_subject_id_rejects_unexpected_format(case_id):
    assert attention.watch_subject_id(case_id) is None


# 端點


def test_requires_login():
    with TestClient(main.app) as client:
        response = client.get("/api/attention/me")

    assert response.status_code == 401


def test_forwards_focused_result(student_client, monkeypatch):
    calls = []

    def fake_fetch(subject):
        calls.append(subject)
        return {"result": 1, "subject": subject, "file": "demo.csv", "source": "upload"}

    monkeypatch.setattr(attention, "fetch_watch_prediction", fake_fetch)

    response = student_client.get("/api/attention/me")

    assert response.status_code == 200
    assert calls == ["S001"]
    assert response.json() == {
        "result": 1,
        "subject": "S001",
        "reason": None,
        "source": "upload",
    }


def test_passes_through_zero_with_reason(student_client, monkeypatch):
    monkeypatch.setattr(
        attention,
        "fetch_watch_prediction",
        lambda subject: {"result": 0, "reason": "錄製檔已超過 24 小時，請重新錄製"},
    )

    body = student_client.get("/api/attention/me").json()

    assert body["result"] == 0
    assert body["reason"] == "錄製檔已超過 24 小時，請重新錄製"


def test_treats_unexpected_result_as_zero(student_client, monkeypatch):
    monkeypatch.setattr(attention, "fetch_watch_prediction", lambda subject: {"result": "1"})

    assert student_client.get("/api/attention/me").json()["result"] == 0


def test_watch_platform_failure_returns_zero(student_client, monkeypatch):
    def boom(subject):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(attention, "fetch_watch_prediction", boom)

    response = student_client.get("/api/attention/me")

    assert response.status_code == 200
    assert response.json()["result"] == 0


def test_mock_env_returns_one_without_calling_platform(student_client, monkeypatch):
    monkeypatch.setenv("WATCH_PREDICT_MOCK", "1")

    def should_not_be_called(subject):
        raise AssertionError("mock 模式不應呼叫手錶平台")

    monkeypatch.setattr(attention, "fetch_watch_prediction", should_not_be_called)

    body = student_client.get("/api/attention/me").json()

    assert body == {"result": 1, "subject": "S001", "reason": None, "source": "mock"}
