"""POST /api/auth/heartbeat 的測試資料庫測試：驗證真的 SQL。

需要 TEST_DB_NAME（見 conftest.py）；沒設定時整份略過。
規則：延到「現在 + 30 分鐘」、不超過「登入後 8 小時」、不縮短、已過期不復活。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from auth import SESSION_IDLE_TIMEOUT, SESSION_MAX_LIFETIME, TOKEN_TTL

# 測試執行與資料庫 datetime 秒數截斷的誤差。
TOLERANCE = timedelta(seconds=5)


def as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def token_of(headers: dict) -> str:
    return headers["Authorization"].removeprefix("Bearer ")


def stored_session(db, headers: dict) -> dict:
    rows = db.query(
        "SELECT created_at, expires_at FROM login_session WHERE token = %s",
        [token_of(headers)],
    )
    assert len(rows) == 1
    return {key: as_utc(value) for key, value in rows[0].items()}


def set_times(db, headers: dict, *, created_at: datetime, expires_at: datetime) -> None:
    db.execute(
        "UPDATE login_session SET created_at = %s, expires_at = %s WHERE token = %s",
        [created_at, expires_at, token_of(headers)],
    )


def assert_close(actual: datetime, expected: datetime) -> None:
    assert abs(actual - expected) <= TOLERANCE, f"{actual} != {expected}"


# 登入時寫入的 created_at


def test_login_stores_created_at_in_utc(client, db, login_as_student):
    """created_at 改由 Python 寫入 UTC；用 NOW() 會受資料庫時區影響，8 小時上限就算錯。"""
    before = datetime.now(timezone.utc)
    _, headers = login_as_student()

    session = stored_session(db, headers)

    assert_close(session["created_at"], before)
    assert_close(session["expires_at"], session["created_at"] + TOKEN_TTL)


# 延長


def test_heartbeat_extends_to_idle_timeout_from_now(client, db, login_as_student):
    _, headers = login_as_student()
    now = datetime.now(timezone.utc)
    set_times(db, headers, created_at=now - timedelta(hours=1),
              expires_at=now + timedelta(minutes=5))

    response = client.post("/api/auth/heartbeat", headers=headers)

    assert response.status_code == 200
    stored = stored_session(db, headers)["expires_at"]
    assert_close(stored, now + SESSION_IDLE_TIMEOUT)
    assert_close(as_utc(datetime.fromisoformat(response.json()["expiresAt"])), stored)


def test_heartbeat_never_shortens_login(client, db, login_as_student):
    """剛登入時到期時間是 1 小時後，比 30 分鐘晚；heartbeat 要保留 1 小時。"""
    _, headers = login_as_student()
    before = stored_session(db, headers)["expires_at"]

    response = client.post("/api/auth/heartbeat", headers=headers)

    assert response.status_code == 200
    assert stored_session(db, headers)["expires_at"] == before


def test_heartbeat_stops_at_eight_hours_after_login(client, db, login_as_student):
    _, headers = login_as_student()
    now = datetime.now(timezone.utc)
    created_at = now - timedelta(hours=7, minutes=50)
    set_times(db, headers, created_at=created_at, expires_at=now + timedelta(minutes=5))

    response = client.post("/api/auth/heartbeat", headers=headers)

    assert response.status_code == 200
    stored = stored_session(db, headers)["expires_at"]
    assert_close(stored, created_at + SESSION_MAX_LIFETIME)  # 只剩 10 分鐘，不是 30 分鐘
    assert response.json()["expiresIn"] <= 10 * 60


def test_heartbeat_at_the_cap_keeps_login_until_the_cap(client, db, login_as_student):
    """已到 8 小時上限後再送一次：UPDATE 算出的值不變（影響 0 列），登入仍有效，要回 200。"""
    _, headers = login_as_student()
    now = datetime.now(timezone.utc)
    created_at = now - timedelta(hours=7, minutes=50)
    set_times(db, headers, created_at=created_at, expires_at=created_at + SESSION_MAX_LIFETIME)

    for _ in range(2):
        response = client.post("/api/auth/heartbeat", headers=headers)
        assert response.status_code == 200
    assert_close(stored_session(db, headers)["expires_at"], created_at + SESSION_MAX_LIFETIME)


def test_back_to_back_heartbeats_both_succeed(client, db, login_as_student):
    """同一秒內送兩次（例如換頁後第一次操作）：第二次算出的值和第一次一樣，仍要回 200。"""
    _, headers = login_as_student()
    now = datetime.now(timezone.utc)
    set_times(db, headers, created_at=now - timedelta(hours=1), expires_at=now + timedelta(minutes=5))

    first = client.post("/api/auth/heartbeat", headers=headers)
    second = client.post("/api/auth/heartbeat", headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200


def test_heartbeat_after_eight_hours_ends_login(client, db, login_as_student):
    """超過 8 小時上限：heartbeat 回 401，之後所有 API 也都 401。"""
    _, headers = login_as_student()
    now = datetime.now(timezone.utc)
    set_times(db, headers, created_at=now - timedelta(hours=9),
              expires_at=now + timedelta(minutes=5))

    response = client.post("/api/auth/heartbeat", headers=headers)

    assert response.status_code == 401
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_repeated_heartbeats_keep_login_alive(client, db, login_as_student):
    """模擬持續操作：每次 heartbeat 都從「當下」再往後 30 分鐘。"""
    _, headers = login_as_student()
    now = datetime.now(timezone.utc)
    for minutes_left in (5, 1):
        set_times(db, headers, created_at=now - timedelta(hours=2),
                  expires_at=now + timedelta(minutes=minutes_left))
        assert client.post("/api/auth/heartbeat", headers=headers).status_code == 200
        assert_close(stored_session(db, headers)["expires_at"], now + SESSION_IDLE_TIMEOUT)


def test_auth_me_reports_extended_lifetime(client, db, login_as_student):
    _, headers = login_as_student()
    now = datetime.now(timezone.utc)
    set_times(db, headers, created_at=now - timedelta(hours=1),
              expires_at=now + timedelta(minutes=5))

    client.post("/api/auth/heartbeat", headers=headers)
    me = client.get("/api/auth/me", headers=headers)

    assert me.status_code == 200
    assert me.json()["expiresIn"] > 25 * 60


def test_teacher_heartbeat_extends(client, db, login_as_teacher):
    _, headers = login_as_teacher()
    now = datetime.now(timezone.utc)
    set_times(db, headers, created_at=now - timedelta(hours=1),
              expires_at=now + timedelta(minutes=5))

    response = client.post("/api/auth/heartbeat", headers=headers)

    assert response.status_code == 200
    assert_close(stored_session(db, headers)["expires_at"], now + SESSION_IDLE_TIMEOUT)


def test_heartbeat_only_extends_its_own_token(client, db, login_as_student):
    """雙人模式兩個 token 各自延長；送一個不會動到另一個。"""
    _, first = login_as_student(case_id="S01")
    _, second = login_as_student(case_id="S02")
    now = datetime.now(timezone.utc)
    for headers in (first, second):
        set_times(db, headers, created_at=now - timedelta(hours=1),
                  expires_at=now + timedelta(minutes=5))

    client.post("/api/auth/heartbeat", headers=first)

    assert_close(stored_session(db, first)["expires_at"], now + SESSION_IDLE_TIMEOUT)
    assert_close(stored_session(db, second)["expires_at"], now + timedelta(minutes=5))


# 不能延長


def test_expired_login_is_not_revived(client, db, login_as_student):
    _, headers = login_as_student()
    now = datetime.now(timezone.utc)
    expired = (now - timedelta(minutes=1)).replace(microsecond=0)
    set_times(db, headers, created_at=now - timedelta(hours=1), expires_at=expired)

    response = client.post("/api/auth/heartbeat", headers=headers)

    assert response.status_code == 401
    assert stored_session(db, headers)["expires_at"] == expired


def test_logged_out_token_cannot_heartbeat(client, db, login_as_student):
    _, headers = login_as_student()
    assert client.post("/api/auth/logout", headers=headers).status_code == 204

    response = client.post("/api/auth/heartbeat", headers=headers)

    assert response.status_code == 401
