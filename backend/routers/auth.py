"""帳密登入／登出端點。

見 docs/adr/0004-teacher-student-password-login.md：廠商從「選單式登入、無密碼」
改口為帳密登入，登入頁前端 mockup（圖2～圖4）確認登入表單**只有帳號＋密碼兩欄**，
沒有選場域這一步。teacher.name 只在 school 內唯一、studentKey（grade_caseId）
每個場域都會重複，都不能直接當登入帳號，所以 teacher／student 表另外各自加了
全域唯一的 account 欄位（見 tests/schema.sql），登入一律用 account 查人。

「每次 API 呼叫都驗身份」的 dependency（Identity／get_current_identity 等）在
routers/identity.py，不在這裡。
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
