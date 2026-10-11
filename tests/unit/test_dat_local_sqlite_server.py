"""DAT_double/local_sqlite_server.py 的本機後端行為（#25）。

執行：
    uv run --with fastapi --with httpx --with pytest pytest tests/unit/test_dat_local_sqlite_server.py
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER = REPO_ROOT / "DAT_double" / "local_sqlite_server.py"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # 測試用獨立資料庫，不碰 DAT_double/local_test.db
    monkeypatch.setenv("DAT_LOCAL_DB", str(tmp_path / "test.db"))
    # 不在 DAT_double/ 留下 __pycache__（該目錄是對外的遊戲資料夾）
    monkeypatch.setattr(sys, "dont_write_bytecode", True)
    spec = importlib.util.spec_from_file_location("dat_local_sqlite_server_under_test", SERVER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with TestClient(module.app) as test_client:
        test_client.app_module = module
        yield test_client


def payload():
    return {
        "lessonId": "1140908_DAT",
        "data": {
            "grade": "G1", "caseId": "S01", "school": "KMU", "currentDay": 1,
            "startTime": 1, "endTime": 2, "mode": "double", "pairId": "pair",
            "stats": [
                {"apiname": "DAT_correct", "value": 18},
                {"apiname": "DAT_accuracy", "value": 0.75},
                {"apiname": "DAT_levelAccuracy", "value": "1,0.5,0.75"},
            ],
        },
    }


def test_多關_levelAccuracy_字串可寫入並原樣讀回(client):
    res = client.post("/api/sessions", json=payload())
    assert res.status_code == 201, res.text
    assert res.json()["sessionId"]
    records = client.get("/api/sessions").json()["records"]
    stats = {s["apiname"]: s["value"] for s in records[0]["stats"]}
    assert stats["DAT_levelAccuracy"] == "1,0.5,0.75"
    assert stats["DAT_correct"] == 18
    assert stats["DAT_accuracy"] == 0.75


def test_health_回傳_JSON(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/json")
    assert res.json()["status"] == "ok"


def test_以_app_路徑提供整個前端並與遊戲同源送出成績(client):
    # 遊戲在 /app/ 底下時，shared/api.js 與 require-student.js 會把 API 指向同一個來源的 /api
    for path in ("/app/DAT_double/DAT_double.html", "/app/DAT_double/js/main.js", "/app/shared/dat-save.js",
                 "/app/DAT_double/assets/animals/rabbit.png", "/app/Select/index.html"):
        res = client.get(path)
        assert res.status_code == 200, path
    assert "javascript" in client.get("/app/DAT_double/js/main.js").headers["content-type"]
    assert client.get("/app/DAT_double/js/main.js").content == (REPO_ROOT / "DAT_double/js/main.js").read_bytes()
    api = (REPO_ROOT / "shared/api.js").read_text(encoding="utf-8")
    assert 'pathname.startsWith("/app/")' in api and 'origin + "/api"' in api


@pytest.mark.parametrize("path", [
    "/local_test.db",
    "/app/DAT_double/local_test.db",
    "/app/DAT_double/local_sqlite_server.py",
    "/app/backend/main.py",
    "/app/backend/pyproject.toml",
    "/app/tests/package.json",
    "/app/.gitignore",
    "/app/.context/bug-list.md",
    "/app/../README.md",
    "/app/%2e%2e/README.md",
    "/app/DAT_double/..%2f..%2fREADME.md",
    "/DAT_double.html",
    "/nonexistent.js",
])
def test_不提供資料庫_程式碼與_repo_外的檔案(client, path):
    res = client.get(path)
    assert res.status_code == 404, f"{path} -> {res.status_code}"


def test_預設連接埠與說明文件一致():
    source = SERVER.read_text(encoding="utf-8")
    readme = (REPO_ROOT / "DAT_double" / "README.md").read_text(encoding="utf-8")
    assert "local_sqlite_server.py" in readme
    assert "/app/DAT_double/DAT_double.html" in readme
    port = json.loads('"' + source.split('DAT_LOCAL_PORT", "')[1].split('"')[0] + '"')
    assert f"127.0.0.1:{port}/app/DAT_double/DAT_double.html" in readme


def test_登入與身分查詢轉送到開發後端_成績留在本地(client, monkeypatch):
    module = client.app_module
    seen = []

    class FakeResponse:
        status = 200
        headers = {"content-type": "application/json", "cache-control": "no-store"}

        def read(self):
            return b'{"role": "student"}'

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_urlopen(req, timeout):
        seen.append((req.get_method(), req.full_url, req.get_header("Authorization")))
        return FakeResponse()

    monkeypatch.setattr(module.urllib.request, "urlopen", fake_urlopen)
    res = client.get("/api/auth/me", headers={"Authorization": "Bearer t1"})
    assert res.status_code == 200
    assert res.json() == {"role": "student"}
    assert res.headers["cache-control"] == "no-store"
    assert seen == [("GET", f"{module.UPSTREAM}/api/auth/me", "Bearer t1")]
    # 成績寫入不轉送
    assert client.post("/api/sessions", json=payload()).status_code == 201
    assert len(seen) == 1


def test_開發後端連不上時回_502(client, monkeypatch):
    monkeypatch.setattr(client.app_module, "UPSTREAM", "http://127.0.0.1:9")
    res = client.get("/api/auth/me")
    assert res.status_code == 502


def test_同一位學生重送同一個_submissionId_回同一個_sessionId_不多寫一列(client):
    """#42：遊戲在結果不明時會用同一個 submissionId 重送，本機後端也要冪等。"""
    body = payload()
    body["data"]["submissionId"] = "6F9619FF-8B86-4D01-B42D-00CF4FC964FF"
    first = client.post("/api/sessions", json=body)
    body["data"]["submissionId"] = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff"
    second = client.post("/api/sessions", json=body)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["sessionId"] == second.json()["sessionId"]
    records = client.get("/api/sessions").json()["records"]
    assert len(records) == 1
    assert len(records[0]["stats"]) == 3, "重送不重複寫統計"


def test_不同學生同一個_submissionId_或沒帶_submissionId_各寫一列(client):
    body = payload()
    body["data"]["submissionId"] = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff"
    a = client.post("/api/sessions", json=body).json()["sessionId"]
    body["data"]["caseId"] = "S02"
    b = client.post("/api/sessions", json=body).json()["sessionId"]
    assert a != b
    plain = payload()
    client.post("/api/sessions", json=plain)
    client.post("/api/sessions", json=plain)
    assert len(client.get("/api/sessions").json()["records"]) == 4


def test_submissionId_格式錯誤回_422(client):
    body = payload()
    body["data"]["submissionId"] = "not-a-uuid"
    assert client.post("/api/sessions", json=body).status_code == 422
