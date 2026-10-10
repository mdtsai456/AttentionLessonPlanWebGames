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
from auth import TOKEN_TTL, generate_token, verify_password
from errors import db_error
from models import (
    StudentLoginRequest,
    StudentLoginResponse,
    TeacherLoginRequest,
    TeacherLoginResponse,
)
from routers.identity import Identity, extract_bearer_token, get_current_identity

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
        expiresAt=expires_at,
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
        expiresAt=expires_at,
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
    body = {"role": identity.subject_type, "school": identity.school,
            "expiresAt": identity.expires_at}
    if identity.subject_type == "student":
        body.update(grade=identity.grade, caseId=identity.case_id,
                    studentKey=f"{identity.grade}_{identity.case_id}")
    else:
        body.update(teacherId=identity.teacher_id, teacherName=identity.teacher_name)
    return body
