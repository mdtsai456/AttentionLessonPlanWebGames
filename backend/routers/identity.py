"""「每次 API 呼叫都驗身份」用的 dependency。

獨立成一個模組（而非放在 routers/auth.py 裡）：routers/students.py 裡受保護的端點
（/api/students、/report、/sessions）需要這裡的 dependency，而 routers/auth.py
（登入端點）反過來需要 routers/students.py 的 parse_student_key。兩邊互相 import
會循環匯入，所以把 Identity／dependency 抽到這個不依賴 routers/students 的模組。

見 docs/adr/0004-teacher-student-password-login.md。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException

import queries
from errors import db_error

_NOT_AUTHENTICATED = HTTPException(status_code=401, detail="請重新登入")
_FORBIDDEN = HTTPException(status_code=403, detail="無權查看其他場域資料")


@dataclass(frozen=True)
class Identity:
    subject_type: str  # "teacher" | "student"
    teacher_id: int | None = None
    teacher_name: str | None = None
    grade: str | None = None
    case_id: str | None = None
    school: str | None = None


def extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[len("Bearer ") :].strip()
    return token or None


def get_current_identity(authorization: str | None = Header(default=None)) -> Identity:
    token = extract_bearer_token(authorization)
    if token is None:
        raise _NOT_AUTHENTICATED

    try:
        row = queries.fetch_login_session(token)
    except Exception as exc:
        raise db_error(exc) from exc

    if row is None:
        raise _NOT_AUTHENTICATED

    expires_at = row["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise _NOT_AUTHENTICATED

    if row["subject_type"] == "teacher":
        try:
            teacher = queries.fetch_teacher(row["teacher_id"])
        except Exception as exc:
            raise db_error(exc) from exc
        if teacher is None:
            raise _NOT_AUTHENTICATED
        return Identity(
            subject_type="teacher",
            teacher_id=teacher["teacher_id"],
            teacher_name=teacher["name"],
            school=teacher["school"],
        )

    return Identity(
        subject_type="student", grade=row["grade"], case_id=row["case_id"], school=row["school"]
    )


def require_teacher(identity: Identity = Depends(get_current_identity)) -> Identity:
    if identity.subject_type != "teacher":
        raise _FORBIDDEN
    return identity


def require_student(identity: Identity = Depends(get_current_identity)) -> Identity:
    if identity.subject_type != "student":
        raise _FORBIDDEN
    return identity


def require_same_school(identity: Identity, school: str) -> None:
    """老師只能查自己場域。學生走 require_own_student_or_same_school_teacher。"""
    if identity.school != school:
        raise _FORBIDDEN


def require_own_student_or_same_school_teacher(
    identity: Identity, grade: str, case_id: str, school: str
) -> None:
    """/report、/sessions 共用的授權規則：

    - 老師：學生所在的 school 必須等於老師自己的 school。
    - 學生：grade/case_id/school 必須完全等於自己（不能看別人的報告）。
    """
    if identity.subject_type == "teacher":
        require_same_school(identity, school)
        return
    if (identity.grade, identity.case_id, identity.school) != (grade, case_id, school):
        raise _FORBIDDEN
