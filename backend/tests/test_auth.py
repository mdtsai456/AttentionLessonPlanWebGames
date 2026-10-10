"""帳號與密碼登入端點，以及每次 API 請求身分驗證的測試。

見 docs/adr/0004-teacher-student-password-login.md。
純函式測試驗證 hash_password／verify_password，不存取資料庫。
資料庫測試驗證登入成功與失敗、401（缺少、無效或過期的 token）、403（跨場域或跨角色）。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from auth import generate_token, hash_password, verify_password

# 不存取資料庫


def test_hash_and_verify_round_trip():
    stored = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", stored)


def test_verify_rejects_wrong_password():
    stored = hash_password("correct horse battery staple")
    assert not verify_password("wrong", stored)


def test_hash_password_uses_random_salt_each_time():
    # 相同明文密碼的兩次雜湊須使用不同 salt 並產生不同結果，避免資料外洩後可用彩虹表比對。
    assert hash_password("test1234") != hash_password("test1234")


def test_verify_password_rejects_garbage_stored_value():
    # password_hash 的預設值為空字串，表示尚未指派密碼。格式無效時，回傳 False，
    # 避免未設定密碼的帳號產生 500，並顯示「帳號或密碼錯誤」。
    assert not verify_password("anything", "")
    assert not verify_password("anything", "not-a-valid-format")


def test_generate_token_is_unique_and_url_safe():
    tokens = {generate_token() for _ in range(50)}
    assert len(tokens) == 50
    for token in tokens:
        assert all(c.isalnum() or c in "-_" for c in token)


# 測試資料庫：登入


def test_teacher_login_succeeds_with_correct_password(client, db):
    db.insert_school("A")
    db.insert_teacher("吳老師", "A", password="right-password", account="T0001")

    response = client.post(
        "/api/auth/teacher/login",
        json={"account": "T0001", "password": "right-password"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["teacherName"] == "吳老師"
    assert body["school"] == "A"
    assert "token" in body and len(body["token"]) > 20


def test_teacher_login_rejects_wrong_password(client, db):
    db.insert_school("A")
    db.insert_teacher("吳老師", "A", password="right-password", account="T0001")

    response = client.post(
        "/api/auth/teacher/login",
        json={"account": "T0001", "password": "wrong"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "帳號或密碼錯誤"}


def test_teacher_login_rejects_unknown_account(client, db):
    response = client.post(
        "/api/auth/teacher/login",
        json={"account": "T9999", "password": "whatever"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "帳號或密碼錯誤"}


def test_teacher_login_account_is_global_not_scoped_to_a_school(client, db):
    """account 為全域唯一。teacher.name 僅在 school 內唯一。
登入只使用 account 與 password，不接受 school。
"""
    db.insert_school("A")
    db.insert_school("B")
    db.insert_teacher("吳老師", "A", password="right-password", account="T0001")
    db.insert_teacher("陳老師", "B", password="other-password", account="T0002")

    response = client.post(
        "/api/auth/teacher/login",
        json={"account": "T0002", "password": "other-password"},
    )

    assert response.status_code == 200
    assert response.json()["school"] == "B"


def test_student_login_succeeds_with_correct_password(client, db):
    db.insert_student("G1", "S01", "A", password="right-password", account="S0001")

    response = client.post(
        "/api/auth/student/login",
        json={"account": "S0001", "password": "right-password"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["studentKey"] == "G1_S01"
    assert body["grade"] == "G1"
    assert body["caseId"] == "S01"
    assert body["school"] == "A"


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def test_teacher_and_student_login_expire_after_one_hour(client, db):
    """登入憑證 1 小時後失效。回應的 expiresAt 與 login_session 一致。"""
    db.insert_school("A")
    db.insert_teacher("吳老師", "A", password="right-password", account="T0001")
    db.insert_student("G1", "S01", "A", password="right-password", account="S0001")

    before = datetime.now(timezone.utc)
    teacher = client.post(
        "/api/auth/teacher/login",
        json={"account": "T0001", "password": "right-password"},
    )
    student = client.post(
        "/api/auth/student/login",
        json={"account": "S0001", "password": "right-password"},
    )
    after = datetime.now(timezone.utc)

    assert teacher.status_code == 200
    assert student.status_code == 200

    for body in (teacher.json(), student.json()):
        expires_at = _as_utc(datetime.fromisoformat(body["expiresAt"]))
        assert before + timedelta(hours=1) - timedelta(seconds=5) <= expires_at
        assert expires_at <= after + timedelta(hours=1) + timedelta(seconds=5)
        rows = db.query(
            "SELECT expires_at FROM login_session WHERE token = %s",
            [body["token"]],
        )
        stored = _as_utc(rows[0]["expires_at"])
        assert abs((stored - expires_at).total_seconds()) < 2


def test_student_login_rejects_wrong_password(client, db):
    db.insert_student("G1", "S01", "A", password="right-password", account="S0001")

    response = client.post(
        "/api/auth/student/login",
        json={"account": "S0001", "password": "wrong"},
    )

    assert response.status_code == 401


def test_student_login_rejects_unknown_account(client, db):
    response = client.post(
        "/api/auth/student/login",
        json={"account": "S9999", "password": "x"},
    )

    assert response.status_code == 401


# 測試資料庫：401／403


def test_protected_endpoint_requires_token(client, db):
    response = client.get("/api/me/students")
    assert response.status_code == 401
    assert response.json() == {"detail": "請重新登入"}


def test_protected_endpoint_rejects_garbage_token(client, db):
    response = client.get(
        "/api/me/students", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert response.status_code == 401


def test_protected_endpoint_rejects_expired_token(client, db, login_as_teacher):
    _, headers = login_as_teacher(school="A")
    token = headers["Authorization"].removeprefix("Bearer ")
    # 將此登入憑證的 expires_at 設為過去時間，模擬 token 過期。
    db.execute(
        "UPDATE login_session SET expires_at = %s WHERE token = %s",
        [datetime.now(timezone.utc) - timedelta(hours=1), token],
    )

    response = client.get("/api/me/students", headers=headers)

    assert response.status_code == 401
    assert response.json() == {"detail": "請重新登入"}


def test_teacher_cannot_view_other_school_students(client, db, login_as_teacher):
    db.insert_school("B")
    db.insert_student("G1", "S01", "B")
    _, headers = login_as_teacher(school="A")

    response = client.get("/api/students", params={"school": "B"}, headers=headers)

    assert response.status_code == 403


def test_teacher_cannot_view_other_school_report(client, db, login_as_teacher):
    db.insert_school("B")
    db.insert_student("G1", "S01", "B")
    _, headers = login_as_teacher(school="A")

    response = client.get(
        "/api/students/G1_S01/report", params={"school": "B"}, headers=headers
    )

    assert response.status_code == 403


def test_student_cannot_view_another_students_report(client, db, login_as_student):
    db.insert_student("G1", "S02", "A", password="other-pw")
    _, headers = login_as_student(grade="G1", case_id="S01", school="A")

    response = client.get(
        "/api/students/G1_S02/report", params={"school": "A"}, headers=headers
    )

    assert response.status_code == 403


def test_student_can_view_own_report(client, db, login_as_student):
    _, headers = login_as_student(grade="G1", case_id="S01", school="A")

    response = client.get(
        "/api/students/G1_S01/report", params={"school": "A"}, headers=headers
    )

    assert response.status_code == 200


def test_student_token_rejected_on_teacher_only_endpoint(client, db, login_as_student):
    _, headers = login_as_student(school="A")

    response = client.get("/api/me/students", headers=headers)

    assert response.status_code == 403


def test_logout_invalidates_token(client, db, login_as_teacher):
    _, headers = login_as_teacher(school="A")

    logout_response = client.post("/api/auth/logout", headers=headers)
    assert logout_response.status_code == 204

    response = client.get("/api/me/students", headers=headers)
    assert response.status_code == 401


def test_logout_without_token_is_a_no_op(client, db):
    response = client.post("/api/auth/logout")
    assert response.status_code == 204
