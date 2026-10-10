"""場域與老師名錄的 API。

GET /api/schools 與 GET /api/schools/{school}/teachers 是公開端點，只回傳名錄資訊。
查詢學生資料的 /api/me/students 與 /api/teachers/{id}/students 需要登入 token。
老師只能查詢自己的場域，見 docs/adr/0004-teacher-student-password-login.md。
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
    """回傳場域清單，供第一層下拉選單使用。固定回傳 200，沒有場域時回傳空陣列。"""
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
    """回傳指定場域的老師清單。未知場域回傳 200 與空陣列，表示篩選後沒有資料。"""
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
    """回傳登入老師所屬場域的全部學生。

    身分僅由 token 決定，不接受路徑或查詢參數指定其他身分。
    前端登入後使用此端點，取代需提供 teacherId 的 /api/teachers/{teacherId}/students。
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
    """回傳指定老師所屬場域的全部學生，供既有呼叫端使用。

    新前端使用 /api/me/students。token 的 teacherId 須等於路徑參數，否則回傳 403。
    指定的 teacherId 不存在時，回傳 404。
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
