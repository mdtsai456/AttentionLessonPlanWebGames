"""CORS 設定的測試。不碰資料庫（只打 /health）。"""

from __future__ import annotations

from fastapi.testclient import TestClient

import main


# --- _cors_origins 純函式 ---


def test_cors_origins_default_is_localhost_dev_servers(monkeypatch):
    monkeypatch.delenv("CORS_ALLOW_ORIGINS", raising=False)
    origins = main._cors_origins()
    assert origins  # 非空
    assert all("localhost" in o or "127.0.0.1" in o for o in origins)


def test_cors_origins_parses_comma_separated_list(monkeypatch):
    monkeypatch.setenv(
        "CORS_ALLOW_ORIGINS", " https://a.example , https://b.example "
    )
    assert main._cors_origins() == ["https://a.example", "https://b.example"]


def test_cors_origins_wildcard(monkeypatch):
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "*")
    assert main._cors_origins() == ["*"]


def test_cors_origins_blank_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "   ")
    assert main._cors_origins() == main._DEFAULT_DEV_ORIGINS


# --- 實際的 CORS 回應 header（app 以預設 origin 清單建立） ---


def test_cors_echoes_allowed_origin_on_simple_request():
    with TestClient(main.app) as client:
        response = client.get(
            "/health", headers={"Origin": "http://localhost:5173"}
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_preflight_request_is_allowed():
    with TestClient(main.app) as client:
        response = client.options(
            "/api/sessions",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
    assert response.status_code in (200, 204)
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_does_not_echo_unknown_origin():
    with TestClient(main.app) as client:
        response = client.get(
            "/health", headers={"Origin": "https://evil.example"}
        )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") != "https://evil.example"
