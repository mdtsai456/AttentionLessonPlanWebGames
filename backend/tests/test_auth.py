"""帳號與密碼登入端點，以及每次 API 請求身分驗證的測試。

見 docs/adr/0004-teacher-student-password-login.md。
純函式測試驗證 hash_password／verify_password，不存取資料庫。
資料庫測試驗證登入成功與失敗、401（缺少、無效或過期的 token）、403（跨場域或跨角色）。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import queries
import writes
from auth import (
    DUMMY_PASSWORD_HASH,
    TOKEN_TTL,
    generate_token,
    hash_password,
    is_usable_password_hash,
    verify_password,
)
from models import StudentLoginRequest, TeacherLoginRequest
from routers import auth as auth_router
from routers import identity as identity_router
from routers.identity import (
    Identity,
    get_current_identity,
    require_same_school,
    require_student,
    require_teacher,
)

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


# 資料庫裡的雜湊被改壞（迭代次數為 0、負數或超出範圍）時要當成登入失敗，不能變成 500。
@pytest.mark.parametrize("iterations", ["0", "-1", "2147483648"])
def test_verify_password_rejects_invalid_iterations(iterations):
    assert not verify_password("anything", f"pbkdf2_sha256${iterations}$00$00")
    assert not verify_password("anything", "not-a-valid-format")


def test_generate_token_is_unique_and_url_safe():
    tokens = {generate_token() for _ in range(50)}
    assert len(tokens) == 50
    for token in tokens:
        assert all(c.isalnum() or c in "-_" for c in token)


# 不存取資料庫。以 monkeypatch 取代查詢。


def _raise_twice(call):
    """呼叫兩次並收集拋出的 HTTPException，用來比對是否為同一個物件。"""
    raised = []
    for _ in range(2):
        with pytest.raises(HTTPException) as info:
            call()
        raised.append(info.value)
    return raised


def _traceback_depth(exc: BaseException) -> int:
    depth, tb = 0, exc.__traceback__
    while tb is not None:
        depth, tb = depth + 1, tb.tb_next
    return depth


def test_auth_errors_are_fresh_exception_objects_per_request(monkeypatch):
    """重複 raise 同一個模組層級 HTTPException，會讓 __traceback__ 一路累加
    （記憶體只增不減），而且 frame 會留住登入失敗時的明碼密碼。每次都要是新物件。"""
    monkeypatch.setattr(queries, "fetch_teacher_by_account", lambda account: None)
    monkeypatch.setattr(queries, "fetch_student_by_account", lambda account: None)
    student = Identity(subject_type="student", grade="G1", case_id="S01", school="A")
    teacher = Identity(subject_type="teacher", teacher_id=1, school="A")
    calls = {
        "未登入": lambda: get_current_identity(None),
        "老師端點擋學生": lambda: require_teacher(student),
        "學生端點擋老師": lambda: require_student(teacher),
        "跨場域": lambda: require_same_school(teacher, "B"),
        "老師登入失敗": lambda: auth_router.teacher_login(
            TeacherLoginRequest(account="T9999", password="secret-1")
        ),
        "學生登入失敗": lambda: auth_router.student_login(
            StudentLoginRequest(account="S9999", password="secret-2")
        ),
    }
    for label, call in calls.items():
        first, second = _raise_twice(call)
        assert first is not second, label
        assert _traceback_depth(second) == _traceback_depth(first), label


def test_auth_me_failures_do_not_grow_shared_traceback():
    """經過 FastAPI 的真實請求路徑：多次 401 之後，模組層級不得留下帶 traceback 的例外。"""
    with TestClient(main.app) as client:
        for _ in range(20):
            assert client.get("/api/auth/me").status_code == 401
    for module in (identity_router, auth_router):
        for name, value in vars(module).items():
            if isinstance(value, BaseException):
                assert value.__traceback__ is None, f"{module.__name__}.{name}"


@pytest.mark.parametrize(
    ("path", "fetch_name"),
    [
        ("/api/auth/teacher/login", "fetch_teacher_by_account"),
        ("/api/auth/student/login", "fetch_student_by_account"),
    ],
)
def test_login_unknown_account_still_runs_password_hash(monkeypatch, path, fetch_name):
    """帳號不存在時也要跑一次 PBKDF2，否則回應時間差會洩漏哪些帳號存在。"""
    monkeypatch.setattr(queries, fetch_name, lambda account: None)
    verified = []

    def spy_verify(password, stored):
        verified.append((password, stored))
        return verify_password(password, stored)

    monkeypatch.setattr(auth_router, "verify_password", spy_verify)

    with TestClient(main.app) as client:
        response = client.post(path, json={"account": "NOBODY", "password": "guess"})

    assert response.status_code == 401
    assert response.json() == {"detail": "帳號或密碼錯誤"}
    assert len(verified) == 1
    password, stored = verified[0]
    assert password == "guess"
    # 假雜湊要跟真密碼用同樣的演算法與迭代次數，花費的時間才會一樣。
    assert stored.split("$")[:2] == hash_password("x").split("$")[:2]


UNUSABLE_STORED_HASHES = [
    "",
    None,
    "garbage",
    "pbkdf2_sha256$0$00$00",
    "pbkdf2_sha256$-5$00$00",
    "pbkdf2_sha256$abc$00$00",
    "pbkdf2_sha256$99999999999999999999999$00$00",
    "pbkdf2_sha256$260000$zz$00",
    "md5$260000$00$00",
]


@pytest.mark.parametrize(
    ("path", "fetch_name", "row"),
    [
        ("/api/auth/teacher/login", "fetch_teacher_by_account",
         {"teacher_id": 7, "name": "吳老師", "school": "A"}),
        ("/api/auth/student/login", "fetch_student_by_account",
         {"grade": "G1", "case_id": "S01", "school": "A"}),
    ],
)
@pytest.mark.parametrize("stored", UNUSABLE_STORED_HASHES)
def test_login_with_unusable_stored_hash_still_runs_password_hash(
    monkeypatch, path, fetch_name, row, stored
):
    """帳號存在但 password_hash 是空的／壞掉的：verify_password 會立刻回 False、不跑
    PBKDF2，回應時間會比「帳號不存在」短，洩漏帳號存在。必須改跑一次假雜湊。"""
    monkeypatch.setattr(queries, fetch_name, lambda account: {**row, "password_hash": stored})
    verified = []

    def spy_verify(password, stored_hash):
        verified.append(stored_hash)
        return verify_password(password, stored_hash)

    monkeypatch.setattr(auth_router, "verify_password", spy_verify)

    with TestClient(main.app) as client:
        response = client.post(path, json={"account": "A1", "password": "guess"})

    assert response.status_code == 401
    assert response.json() == {"detail": "帳號或密碼錯誤"}
    assert verified == [DUMMY_PASSWORD_HASH]


@pytest.mark.parametrize("stored", UNUSABLE_STORED_HASHES)
def test_is_usable_password_hash_rejects_unusable_values(stored):
    assert not is_usable_password_hash(stored)


def test_is_usable_password_hash_accepts_real_hash():
    assert is_usable_password_hash(hash_password("pw"))
    assert is_usable_password_hash(DUMMY_PASSWORD_HASH)


@pytest.mark.parametrize(
    ("path", "fetch_name", "row"),
    [
        ("/api/auth/teacher/login", "fetch_teacher_by_account",
         {"teacher_id": 7, "name": "吳老師", "school": "A"}),
        ("/api/auth/student/login", "fetch_student_by_account",
         {"grade": "G1", "case_id": "S01", "school": "A"}),
    ],
)
def test_login_response_includes_relative_lifetime(monkeypatch, path, fetch_name, row):
    """expiresIn（秒）讓前端用自己的時鐘算到期時間，裝置時鐘快慢不影響登入長度。"""
    stored = hash_password("right-password")
    monkeypatch.setattr(queries, fetch_name, lambda account: {**row, "password_hash": stored})
    monkeypatch.setattr(writes, "insert_login_session", lambda *args, **kwargs: None)

    with TestClient(main.app) as client:
        before = datetime.now(timezone.utc)
        response = client.post(path, json={"account": "A1", "password": "right-password"})

    assert response.status_code == 200
    body = response.json()
    assert body["expiresIn"] == int(TOKEN_TTL.total_seconds())
    expires_at = datetime.fromisoformat(body["expiresAt"])
    assert abs((expires_at - before).total_seconds() - body["expiresIn"]) < 5


def test_auth_me_includes_remaining_lifetime(monkeypatch):
    """/api/auth/me 回傳剩餘秒數；與 expiresAt 減去伺服器現在時間一致。"""
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=20)
    monkeypatch.setattr(queries, "fetch_login_session", lambda token: {
        "subject_type": "student", "grade": "G1", "case_id": "S01",
        "school": "A", "expires_at": expires_at,
    })

    with TestClient(main.app) as client:
        response = client.get("/api/auth/me", headers={"Authorization": "Bearer t"})

    assert response.status_code == 200
    remaining = response.json()["expiresIn"]
    assert isinstance(remaining, int)
    assert 20 * 60 - 5 <= remaining <= 20 * 60


# 測試資料庫：登入


def test_teacher_login_succeeds_with_correct_password(client, db):
    db.insert_school("A")
    db.insert_teacher("吳老師", "A", password="right-password", account="T001")

    response = client.post(
        "/api/auth/teacher/login",
        json={"account": "T001", "password": "right-password"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["teacherName"] == "吳老師"
    assert body["school"] == "A"
    assert "token" in body and len(body["token"]) > 20


def test_teacher_login_rejects_wrong_password(client, db):
    db.insert_school("A")
    db.insert_teacher("吳老師", "A", password="right-password", account="T001")

    response = client.post(
        "/api/auth/teacher/login",
        json={"account": "T001", "password": "wrong"},
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
    db.insert_teacher("吳老師", "A", password="right-password", account="T001")
    db.insert_teacher("陳老師", "B", password="other-password", account="T002")

    response = client.post(
        "/api/auth/teacher/login",
        json={"account": "T002", "password": "other-password"},
    )

    assert response.status_code == 200
    assert response.json()["school"] == "B"


def test_student_login_succeeds_with_correct_password(client, db):
    db.insert_student("G1", "S01", "A", password="right-password", account="S001")

    response = client.post(
        "/api/auth/student/login",
        json={"account": "S001", "password": "right-password"},
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
    db.insert_teacher("吳老師", "A", password="right-password", account="T001")
    db.insert_student("G1", "S01", "A", password="right-password", account="S001")

    before = datetime.now(timezone.utc)
    teacher = client.post(
        "/api/auth/teacher/login",
        json={"account": "T001", "password": "right-password"},
    )
    student = client.post(
        "/api/auth/student/login",
        json={"account": "S001", "password": "right-password"},
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
    db.insert_student("G1", "S01", "A", password="right-password", account="S001")

    response = client.post(
        "/api/auth/student/login",
        json={"account": "S001", "password": "wrong"},
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


# 登入帳號格式：三位數（S001、T001），與目前資料庫裡實際指派的帳號一致；超過 999 自然變四位數。
def test_account_format_is_three_digits():
    from auth import student_account, teacher_account

    assert student_account(1) == "S001"
    assert student_account(18) == "S018"
    assert teacher_account(1) == "T001"
    assert teacher_account(329) == "T329"
    assert student_account(1000) == "S1000"
