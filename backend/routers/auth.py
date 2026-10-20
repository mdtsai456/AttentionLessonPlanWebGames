"""帳號與密碼登入、登出端點。

登入表單只包含帳號與密碼，不選擇場域，見 docs/adr/0004-teacher-student-password-login.md。
teacher.name 僅在 school 內唯一，studentKey（grade_caseId）也可能在不同場域重複。
teacher／student 表各有全域唯一的 account，登入使用此欄位查詢，見 tests/schema.sql。

routers/identity.py 提供 Identity／get_current_identity 等依賴，驗證每次 API 請求的身分。
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Response

import queries
import writes
from auth import (
    DUMMY_PASSWORD_HASH,
    TOKEN_TTL,
    generate_token,
    is_usable_password_hash,
    verify_password,
)
from errors import db_error
from models import (
    StudentLoginRequest,
    StudentLoginResponse,
    TeacherLoginRequest,
    TeacherLoginResponse,
)
from routers.identity import Identity, extract_bearer_token, get_current_identity

router = APIRouter(tags=["auth"])


def _login_failed() -> HTTPException:
    # 每次建新的例外物件：重複 raise 同一個模組層級實例會讓 __traceback__ 一路累加，
    # frame 還會留住登入失敗時的明碼密碼。
    return HTTPException(status_code=401, detail="帳號或密碼錯誤")


def _already_logged_in() -> HTTPException:
    # 見 docs/adr/0005-block-duplicate-login.md：擋掉新登入，不影響原本的登入。
    return HTTPException(status_code=409, detail="此帳號已在別處登入中，請先登出")


def _has_active_session(rows: list[dict]) -> bool:
    """依 expires_at 判斷這些登入憑證裡是否還有未過期的，和 get_current_identity 同一套慣例：
    在 Python 比較 UTC 時間，不在 SQL 用 NOW()（見 fetch_login_sessions_for_teacher 的說明）。
    """
    now = datetime.now(timezone.utc)
    for row in rows:
        expires_at = row["expires_at"]
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at > now:
            return True
    return False


def _password_matches(account: dict | None, password: str) -> bool:
    """每次登入都恰好跑一次 PBKDF2，失敗原因不同、回應時間一致。

    帳號不存在，或帳號存在但 password_hash 是空的／NULL／格式錯誤／演算法不符／
    迭代次數不合法（verify_password 會立刻回 False、不跑 PBKDF2），都改比對假雜湊
    並一律登入失敗；否則回應時間差會洩漏哪些帳號存在。
    """
    stored = None if account is None else account.get("password_hash")
    if not is_usable_password_hash(stored):
        verify_password(password, DUMMY_PASSWORD_HASH)
        return False
    return verify_password(password, stored)


def _token_lifetime_seconds() -> int:
    return int(TOKEN_TTL.total_seconds())


@router.post("/api/auth/teacher/login", response_model=TeacherLoginResponse)
def teacher_login(payload: TeacherLoginRequest) -> TeacherLoginResponse:
    try:
        teacher = queries.fetch_teacher_by_account(payload.account.strip())
    except Exception as exc:
        raise db_error(exc) from exc

    if not _password_matches(teacher, payload.password):
        raise _login_failed()

    try:
        if _has_active_session(queries.fetch_login_sessions_for_teacher(teacher["teacher_id"])):
            raise _already_logged_in()
    except HTTPException:
        raise
    except Exception as exc:
        raise db_error(exc) from exc

    token = generate_token()
    expires_at = datetime.now(timezone.utc) + TOKEN_TTL
    try:
        writes.insert_login_session(
            token, "teacher", expires_at, teacher_id=teacher["teacher_id"]
        )
    except Exception as exc:
        raise db_error(exc) from exc

    return TeacherLoginResponse(
        token=token,
        teacherId=teacher["teacher_id"],
        teacherName=teacher["name"],
        school=teacher["school"],
        expiresAt=expires_at,
        expiresIn=_token_lifetime_seconds(),
    )


@router.post("/api/auth/student/login", response_model=StudentLoginResponse)
def student_login(payload: StudentLoginRequest) -> StudentLoginResponse:
    try:
        student = queries.fetch_student_by_account(payload.account.strip())
    except Exception as exc:
        raise db_error(exc) from exc

    if not _password_matches(student, payload.password):
        raise _login_failed()

    grade, case_id, school = student["grade"], student["case_id"], student["school"]

    try:
        sessions = queries.fetch_login_sessions_for_student(grade, case_id, school)
        if _has_active_session(sessions):
            raise _already_logged_in()
    except HTTPException:
        raise
    except Exception as exc:
        raise db_error(exc) from exc

    token = generate_token()
    expires_at = datetime.now(timezone.utc) + TOKEN_TTL
    try:
        writes.insert_login_session(
            token, "student", expires_at, grade=grade, case_id=case_id, school=school
        )
    except Exception as exc:
        raise db_error(exc) from exc

    return StudentLoginResponse(
        token=token,
        studentKey=f"{grade}_{case_id}",
        grade=grade,
        caseId=case_id,
        school=school,
        expiresAt=expires_at,
        expiresIn=_token_lifetime_seconds(),
    )


@router.post("/api/auth/logout", status_code=204)
def logout(authorization: str | None = Header(default=None)) -> None:
    token = extract_bearer_token(authorization)
    if token is None:
        return
    try:
        writes.delete_login_session(token)
    except Exception as exc:
        raise db_error(exc) from exc


@router.get("/api/auth/me")
def auth_me(response: Response, identity: Identity = Depends(get_current_identity)) -> dict:
    """由有效登入紀錄取得身分，不接受前端宣告角色或學生欄位。"""
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    # expiresIn：伺服器時鐘算出的剩餘秒數，前端以「收到回應的本機時間 + expiresIn」
    # 當到期時間，不受裝置時鐘快慢影響。
    remaining = (identity.expires_at - datetime.now(timezone.utc)).total_seconds()
    body = {"role": identity.subject_type, "school": identity.school,
            "expiresAt": identity.expires_at, "expiresIn": max(0, int(remaining))}
    if identity.subject_type == "student":
        body.update(grade=identity.grade, caseId=identity.case_id,
                    studentKey=f"{identity.grade}_{identity.case_id}")
    else:
        body.update(teacherId=identity.teacher_id, teacherName=identity.teacher_name)
    return body
