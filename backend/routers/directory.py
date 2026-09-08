"""場域／老師名錄（directory）的唯讀 API。

命名為 directory（通訊錄／名錄），不叫 auth／login：這支 router 不驗證任何身分、
不發任何憑證，只回傳場域與老師的清單。廠商定調「下拉選人、無密碼」。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

import queries
from models import (
    SchoolItem,
    SchoolListResponse,
    TeacherItem,
    TeacherListResponse,
    TeacherStudentsResponse,
)
from routers.students import build_student_list_items, db_error

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


@router.get("/api/teachers/{teacher_id}/students", response_model=TeacherStudentsResponse)
def list_teacher_students(teacher_id: int) -> TeacherStudentsResponse:
    """某位老師名下的學生（= 該老師所屬場域的全部學生）。

    未知 teacherId 回 404：/api/teachers/{teacherId} 指名一個特定實體。
    """
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
