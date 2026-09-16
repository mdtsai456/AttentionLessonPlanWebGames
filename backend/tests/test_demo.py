"""/demo 驗收畫面。不碰資料庫。"""

from __future__ import annotations

from fastapi.testclient import TestClient

import main


def test_demo_page_is_served():
    with TestClient(main.app) as client:
        response = client.get("/demo")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "<title>" in response.text


def test_demo_is_hidden_from_openapi_schema():
    assert "/demo" not in main.app.openapi()["paths"]
