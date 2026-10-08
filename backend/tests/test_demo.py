"""/demo 驗收畫面。不碰資料庫。"""

from __future__ import annotations

from fastapi.testclient import TestClient

import main


def test_demo_redirects_to_teacher_page():
    with TestClient(main.app) as client:
        response = client.get("/demo", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "/app/Teacher_platform/index.html"


def test_demo_is_hidden_from_openapi_schema():
    assert "/demo" not in main.app.openapi()["paths"]
