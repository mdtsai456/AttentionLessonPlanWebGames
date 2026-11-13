"""POST /api/auth/heartbeat 的測試（不存取資料庫）。

用 monkeypatch 取代 queries／writes，只驗證端點本身的判斷：
誰可以延長、延長後回什麼、什麼情況要回 401。
真的 SQL（延長多久、8 小時上限、不縮短）在 test_heartbeat_db.py 用測試資料庫驗證。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import main
import queries
import writes
from auth import SESSION_IDLE_TIMEOUT, SESSION_MAX_LIFETIME

HEADERS = {"Authorization": "Bearer tok"}


def student_row(expires_at):
    return {
        "subject_type": "student", "grade": "G1", "case_id": "S01",
        "school": "A", "expires_at": expires_at,
    }


class FakeStore:
    """記住 extend_login_session 的呼叫；extend 後 fetch 會讀到新的到期時間。"""

    def __init__(self, expires_at, extended_to=None, extend_result=True):
        self.expires_at = expires_at
        self.extended_to = extended_to
        self.extend_result = extend_result
        self.extend_calls = []

    def fetch(self, token):
        if token != "tok" or self.expires_at is None:
            return None
        return student_row(self.expires_at)

    def extend(self, token, now, idle_timeout, max_lifetime):
        self.extend_calls.append((token, now, idle_timeout, max_lifetime))
        if self.extend_result and self.extended_to is not None:
            self.expires_at = self.extended_to
        return self.extend_result


@pytest.fixture
def store(monkeypatch):
    def install(**kwargs):
        fake = FakeStore(**kwargs)
        monkeypatch.setattr(queries, "fetch_login_session", fake.fetch)
        monkeypatch.setattr(writes, "extend_login_session", fake.extend)
        return fake

    return install


def post(headers=HEADERS):
    with TestClient(main.app) as client:
        return client.post("/api/auth/heartbeat", headers=headers)


# 規則常數


def test_idle_timeout_is_30_minutes_and_cap_is_8_hours():
    assert SESSION_IDLE_TIMEOUT == timedelta(minutes=30)
    assert SESSION_MAX_LIFETIME == timedelta(hours=8)


# 成功延長


def test_valid_token_is_extended_and_returns_new_lifetime(store):
    now = datetime.now(timezone.utc)
    store(expires_at=now + timedelta(minutes=5), extended_to=now + timedelta(minutes=30))

    response = post()

    assert response.status_code == 200
    body = response.json()
    assert 30 * 60 - 5 <= body["expiresIn"] <= 30 * 60
    expires_at = datetime.fromisoformat(body["expiresAt"])
    assert abs((expires_at - (now + timedelta(minutes=30))).total_seconds()) < 1


def test_extend_receives_token_current_time_and_rules(store):
    now = datetime.now(timezone.utc)
    fake = store(expires_at=now + timedelta(minutes=5),
                 extended_to=now + timedelta(minutes=30))

    post()

    assert len(fake.extend_calls) == 1
    token, called_now, idle_timeout, max_lifetime = fake.extend_calls[0]
    assert token == "tok"
    assert abs((called_now - now).total_seconds()) < 5
    assert called_now.tzinfo is not None  # 跟 expires_at 一樣用 UTC
    assert idle_timeout == SESSION_IDLE_TIMEOUT
    assert max_lifetime == SESSION_MAX_LIFETIME


def test_response_is_not_cached(store):
    now = datetime.now(timezone.utc)
    store(expires_at=now + timedelta(minutes=5), extended_to=now + timedelta(minutes=30))

    response = post()

    assert response.headers["Cache-Control"] == "no-store"


def test_naive_datetime_from_database_is_treated_as_utc(store):
    """MySQL 的 datetime 讀回來沒有時區；要當 UTC 算剩餘秒數，不能當本機時間。"""
    now = datetime.now(timezone.utc)
    naive = (now + timedelta(minutes=30)).replace(tzinfo=None)
    store(expires_at=now + timedelta(minutes=10), extended_to=naive)

    response = post()

    assert response.status_code == 200
    assert 30 * 60 - 5 <= response.json()["expiresIn"] <= 30 * 60


# 回 401 的情況


def test_missing_token_is_rejected(store):
    fake = store(expires_at=datetime.now(timezone.utc) + timedelta(minutes=5))

    response = post(headers={})

    assert response.status_code == 401
    assert response.json() == {"detail": "請重新登入"}
    assert fake.extend_calls == []


def test_non_bearer_header_is_rejected(store):
    fake = store(expires_at=datetime.now(timezone.utc) + timedelta(minutes=5))

    response = post(headers={"Authorization": "Basic tok"})

    assert response.status_code == 401
    assert fake.extend_calls == []


def test_unknown_token_is_rejected(store):
    fake = store(expires_at=datetime.now(timezone.utc) + timedelta(minutes=5))

    response = post(headers={"Authorization": "Bearer not-a-real-token"})

    assert response.status_code == 401
    assert fake.extend_calls == []


def test_expired_token_is_not_extended(store):
    """已過期的登入不能靠 heartbeat 復活。"""
    fake = store(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))

    response = post()

    assert response.status_code == 401
    assert fake.extend_calls == []


def test_token_expiring_between_check_and_update_is_rejected(store):
    """驗證通過後、UPDATE 前剛好過期：UPDATE 沒更新任何列，要回 401 而不是 200。"""
    now = datetime.now(timezone.utc)
    store(expires_at=now + timedelta(seconds=30), extend_result=False)

    response = post()

    assert response.status_code == 401
    assert response.json() == {"detail": "請重新登入"}


def test_token_deleted_after_update_is_rejected(store, monkeypatch):
    """UPDATE 之後 token 被登出刪掉，重新讀取讀不到，回 401。"""
    now = datetime.now(timezone.utc)
    fake = store(expires_at=now + timedelta(minutes=5))

    def extend_then_logout(*args):
        fake.extend_calls.append(args)
        fake.expires_at = None
        return True

    monkeypatch.setattr(writes, "extend_login_session", extend_then_logout)

    response = post()

    assert response.status_code == 401


def test_extended_time_already_in_the_past_is_rejected(store):
    """8 小時上限早於現在（資料異常）時，不回傳負的 expiresIn，而是 401。"""
    now = datetime.now(timezone.utc)
    store(expires_at=now + timedelta(minutes=5), extended_to=now - timedelta(minutes=1))

    response = post()

    assert response.status_code == 401


def test_deleted_teacher_cannot_extend(monkeypatch):
    """老師帳號已刪除時，get_current_identity 先擋下，不延長。"""
    calls = []
    monkeypatch.setattr(queries, "fetch_login_session", lambda token: {
        "subject_type": "teacher", "teacher_id": 7,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
    })
    monkeypatch.setattr(queries, "fetch_teacher", lambda teacher_id: None)
    monkeypatch.setattr(writes, "extend_login_session", lambda *args: calls.append(args))

    response = post()

    assert response.status_code == 401
    assert calls == []


def test_teacher_token_can_extend(monkeypatch):
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(queries, "fetch_login_session", lambda token: {
        "subject_type": "teacher", "teacher_id": 7,
        "expires_at": now + timedelta(minutes=30),
    })
    monkeypatch.setattr(queries, "fetch_teacher", lambda teacher_id: {
        "teacher_id": 7, "name": "吳老師", "school": "A",
    })
    monkeypatch.setattr(writes, "extend_login_session", lambda *args: True)

    response = post()

    assert response.status_code == 200
    assert response.json()["expiresIn"] > 0


# 資料庫錯誤


def test_database_error_returns_generic_500(store, monkeypatch):
    """不把 PyMySQL 的錯誤訊息（可能含主機、帳號）回給前端。"""
    store(expires_at=datetime.now(timezone.utc) + timedelta(minutes=5))

    def broken(*args):
        raise RuntimeError("secret-host user=game_writer")

    monkeypatch.setattr(writes, "extend_login_session", broken)

    response = post()

    assert response.status_code == 500
    assert response.json() == {"detail": "資料庫查詢失敗"}
    assert "secret-host" not in response.text


def test_get_method_is_not_allowed():
    """heartbeat 會改資料，只接受 POST。"""
    with TestClient(main.app) as client:
        response = client.get("/api/auth/heartbeat", headers=HEADERS)

    assert response.status_code == 405


# writes.extend_login_session（假連線，檢查 SQL 參數順序）


class RecordingCursor:
    """rowcount 是 UPDATE 回傳的「值有改變」列數；alive 是之後 SELECT 查到的 token 是否仍有效。"""

    def __init__(self, rowcount, alive=True):
        self.rowcount = rowcount
        self.alive = alive
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params):
        self.calls.append((sql, params))
        return self.rowcount

    def fetchone(self):
        return {"1": 1} if self.alive else None


class RecordingConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.committed = False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.committed = True


def install_connection(monkeypatch, rowcount, alive=True):
    from contextlib import contextmanager

    cursor = RecordingCursor(rowcount, alive)
    connection = RecordingConnection(cursor)

    @contextmanager
    def fake_connection():
        yield connection

    monkeypatch.setattr(writes, "get_write_connection", fake_connection)
    return cursor, connection


def test_extend_sql_uses_idle_deadline_cap_and_only_live_tokens(monkeypatch):
    cursor, connection = install_connection(monkeypatch, rowcount=1)
    now = datetime(2026, 11, 12, 8, 0, tzinfo=timezone.utc)

    result = writes.extend_login_session(
        "tok", now, timedelta(minutes=30), timedelta(hours=8)
    )

    assert result is True
    assert connection.committed
    sql, params = cursor.calls[0]
    assert "GREATEST(expires_at, CAST(%s AS DATETIME))" in sql  # 不縮短
    assert "created_at + INTERVAL %s SECOND" in sql  # 8 小時上限
    assert "expires_at > %s" in sql  # 已過期不復活
    assert params == [now + timedelta(minutes=30), 8 * 3600, "tok", now]


def test_extend_returns_false_when_token_is_not_alive(monkeypatch):
    install_connection(monkeypatch, rowcount=0, alive=False)
    now = datetime.now(timezone.utc)

    assert writes.extend_login_session(
        "tok", now, timedelta(minutes=30), timedelta(hours=8)
    ) is False


def test_extend_returns_true_when_update_changes_nothing_but_token_is_alive(monkeypatch):
    """同一秒送兩次、已到 8 小時上限時，UPDATE 算出的值不變、影響列數是 0，登入仍有效。"""
    cursor, _ = install_connection(monkeypatch, rowcount=0, alive=True)
    now = datetime(2026, 11, 12, 8, 0, tzinfo=timezone.utc)

    assert writes.extend_login_session(
        "tok", now, timedelta(minutes=30), timedelta(hours=8)
    ) is True
    sql, params = cursor.calls[1]
    assert sql.startswith("SELECT 1 FROM login_session")
    assert "expires_at > %s" in sql
    assert params == ["tok", now]


def test_insert_login_session_writes_utc_created_at(monkeypatch):
    cursor, _ = install_connection(monkeypatch, rowcount=1)
    before = datetime.now(timezone.utc)

    writes.insert_login_session("tok", "student", before + timedelta(hours=1),
                                grade="G1", case_id="S01", school="A")

    sql, params = cursor.calls[0]
    assert "NOW()" not in sql
    created_at = params[6]
    assert created_at.tzinfo is not None
    assert abs((created_at - before).total_seconds()) < 5
