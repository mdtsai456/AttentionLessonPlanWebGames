"""/app 靜態前端。不碰資料庫。

前端由本服務一併提供（見 main.py 結尾的 app.mount），目的是讓瀏覽器端與
/api/* 同源，省掉 CORS，也不必另外起一個靜態伺服器。
"""

from __future__ import annotations

from fastapi.testclient import TestClient

import main


def test_app_root_serves_login_page():
    """/app/ 應吐 frontend/index.html（html=True 的效果）。"""
    with TestClient(main.app) as client:
        response = client.get("/app/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "<title>" in response.text


def test_game_lobby_and_dccs_are_served():
    with TestClient(main.app) as client:
        lobby = client.get("/app/games.html")
        game = client.get("/app/dccs/index.html")
        module = client.get("/app/dccs/js/dccs.js")
    assert lobby.status_code == 200
    assert game.status_code == 200
    # ES module 必須以 JavaScript 的 content-type 提供，否則瀏覽器拒絕載入。
    assert module.status_code == 200
    assert "javascript" in module.headers["content-type"]


def test_api_routes_are_not_shadowed_by_the_mount():
    """掛載點是 /app，不得影響既有路由。"""
    with TestClient(main.app) as client:
        root = client.get("/")
        health = client.get("/health")
        games = client.get("/api/games")
    assert root.status_code == 200
    assert root.json()["status"] == "ok"
    assert health.status_code == 200
    assert games.status_code == 200


def test_backend_source_is_not_reachable_through_the_mount():
    """只掛 frontend/，後端原始碼與 .env 不在其中，任何寫法都拿不到。"""
    with TestClient(main.app) as client:
        for path in (
            "/app/../backend/main.py",
            "/app/../backend/.env",
            "/app/%2e%2e/backend/db.py",
            "/app/../.env",
        ):
            response = client.get(path)
            assert response.status_code in (403, 404), (path, response.status_code)
            assert "DB_PASSWORD" not in response.text
