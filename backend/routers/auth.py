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

from fastapi import APIRouter, Header, HTTPException

import queries
import writes
from auth import TOKEN_TTL, generate_token, verify_password
from errors import db_error
from models import (
    StudentLoginRequest,
    StudentLoginResponse,
    TeacherLoginRequest,
    TeacherLoginResponse,
)
from routers.identity import extract_bearer_token

router = APIRouter(tags=["auth"])

_LOGIN_FAILED = HTTPException(status_code=401, detail="帳號或密碼錯誤")


@router.post("/api/auth/teacher/login", response_model=TeacherLoginResponse)
def teacher_login(payload: TeacherLoginRequest) -> TeacherLoginResponse:
    try:
        teacher = queries.fetch_teacher_by_account(payload.account.strip())
    except Exception as exc:
        raise db_error(exc) from exc

    if teacher is None or not verify_password(payload.password, teacher["password_hash"]):
        raise _LOGIN_FAILED

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
    )


@router.post("/api/auth/student/login", response_model=StudentLoginResponse)
def student_login(payload: StudentLoginRequest) -> StudentLoginResponse:
    try:
        student = queries.fetch_student_by_account(payload.account.strip())
    except Exception as exc:
        raise db_error(exc) from exc

    if student is None or not verify_password(payload.password, student["password_hash"]):
        raise _LOGIN_FAILED

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
