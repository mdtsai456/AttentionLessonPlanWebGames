"""場域／老師名錄（directory）的 API。

`GET /api/schools` 與 `GET /api/schools/{school}/teachers` 維持公開——登入頁要先
讓使用者選場域、選老師姓名，這兩支只回傳非敏感的名錄資訊。查得到「哪個學生玩了
什麼」的端點（`/api/me/students`、`/api/teachers/{id}/students`）都要求帳密登入後
的 token，且老師只能查自己場域（見 docs/adr/0004-teacher-student-password-login.md，
翻轉了原本「下拉選人、無密碼」的決定）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

import queries
from models import (
    SchoolItem,
    SchoolListResponse,
    TeacherItem,
    TeacherListResponse,
    TeacherStudentsResponse,
)
from errors import db_error
from routers.identity import Identity, require_teacher
from routers.students import build_student_list_items

router = APIRouter(tags=["directory"])


@router.get("/api/schools", response_model=SchoolListResponse)
def list_schools() -> SchoolListResponse:
    """場域清單，供第一層下拉。永遠回 200；沒有場域時回空陣列。"""
    try:
        rows = queries.fetch_schools()
    except Exception as exc:
        raise db_error(exc) from exc

    return SchoolListResponse(
        schools=[
            SchoolItem(school=row["school"], displayName=row["display_name"])
            for row in rows
        ]
    )


@router.get("/api/schools/{school}/teachers", response_model=TeacherListResponse)
def list_teachers(school: str) -> TeacherListResponse:
    """某場域的老師清單。未知場域回 200 + 空陣列（集合資源存在，篩選後為空）。"""
    try:
        rows = queries.fetch_teachers(school.strip())
    except Exception as exc:
        raise db_error(exc) from exc

    return TeacherListResponse(
        school=school,
        teachers=[
            TeacherItem(teacherId=row["teacher_id"], name=row["name"]) for row in rows
        ],
    )


@router.get("/api/me/students", response_model=TeacherStudentsResponse)
def list_my_students(
    identity: Identity = Depends(require_teacher),
) -> TeacherStudentsResponse:
    """登入中的老師名下的學生（= 該老師所屬場域的全部學生）。

    身份完全來自 token，不接受任何路徑/查詢參數指定別人——這是前端登入後應該
    改叫的端點，取代原本要自己帶 teacherId 的 /api/teachers/{teacherId}/students。
    """
    try:
        rows = queries.fetch_students(identity.school)
    except Exception as exc:
        raise db_error(exc) from exc

    students = build_student_list_items(rows)
    return TeacherStudentsResponse(
        teacherId=identity.teacher_id,
        teacherName=identity.teacher_name,
        school=identity.school,
        studentCount=len(students),
        students=students,
    )


@router.get("/api/teachers/{teacher_id}/students", response_model=TeacherStudentsResponse)
def list_teacher_students(
    teacher_id: int, identity: Identity = Depends(require_teacher)
) -> TeacherStudentsResponse:
    """某位老師名下的學生（= 該老師所屬場域的全部學生）。

    保留給既有呼叫端相容用；新前端請改打 /api/me/students。呼叫者必須是本人
    （token 的 teacherId 要等於路徑參數），否則 403——不能靠改 URL 看別人的學生。
    未知 teacherId 回 404：/api/teachers/{teacherId} 指名一個特定實體。
    """
    if identity.teacher_id != teacher_id:
        raise HTTPException(status_code=403, detail="無權查看其他場域資料")

    try:
        teacher = queries.fetch_teacher(teacher_id)
        if teacher is None:
            raise HTTPException(status_code=404, detail="查無此老師")
        rows = queries.fetch_students(teacher["school"])
    except HTTPException:
        raise
    except Exception as exc:
        raise db_error(exc) from exc

    students = build_student_list_items(rows)
    return TeacherStudentsResponse(
        teacherId=teacher["teacher_id"],
        teacherName=teacher["name"],
        school=teacher["school"],
        studentCount=len(students),
        students=students,
    )
