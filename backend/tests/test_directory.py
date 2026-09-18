"""場域／老師名錄端點的測試。

不碰資料庫：回應模型的欄位與型別。
碰測試資料庫：排序、場域隔離、404 vs 空陣列、外鍵與 UNIQUE 約束。
"""

from __future__ import annotations

from datetime import datetime

import pymysql
import pytest

from models import SchoolListResponse, TeacherListResponse, TeacherStudentsResponse


# --- 不碰資料庫 ---


def test_school_list_response_shape():
    resp = SchoolListResponse.model_validate(
        {"schools": [{"school": "KMU", "displayName": "高雄醫學大學"}]}
    )
    assert resp.schools[0].school == "KMU"


def test_teacher_students_response_counts_match():
    resp = TeacherStudentsResponse.model_validate(
        {
            "teacherId": 1,
            "teacherName": "吳老師",
            "school": "KMU",
            "studentCount": 1,
            "students": [
                {
                    "studentKey": "G1_S01",
                    "grade": "G1",
                    "caseId": "S01",
                    "school": "KMU",
                    "sessionCount": 0,
                    "lastPlayedAt": None,
                }
            ],
        }
    )
    assert resp.studentCount == len(resp.students) == 1


# --- 碰測試資料庫 ---


def test_schools_are_ordered_by_sort_order(client, db):
    db.insert_school("C", "場域C", sort_order=0)
    db.insert_school("A", "場域A", sort_order=1)
    db.insert_school("B", "場域B", sort_order=2)

    body = client.get("/api/schools").json()

    assert [s["school"] for s in body["schools"]] == ["C", "A", "B"]
    assert body["schools"][0]["displayName"] == "場域C"


def test_schools_empty_is_200_with_empty_list(client, db):
    body = client.get("/api/schools").json()
    assert body == {"schools": []}


def test_teachers_are_scoped_to_their_school(client, db):
    db.insert_school("A")
    db.insert_school("B")
    a_wu = db.insert_teacher("吳老師", "A")
    b_wu = db.insert_teacher("吳老師", "B")

    body = client.get("/api/schools/A/teachers").json()

    assert body["school"] == "A"
    assert [t["teacherId"] for t in body["teachers"]] == [a_wu]
    assert b_wu not in [t["teacherId"] for t in body["teachers"]]


def test_teachers_ordered_by_teacher_id(client, db):
    db.insert_school("A")
    first = db.insert_teacher("林老師", "A")
    second = db.insert_teacher("吳老師", "A")

    body = client.get("/api/schools/A/teachers").json()

    assert [t["teacherId"] for t in body["teachers"]] == [first, second]


def test_unknown_school_teachers_is_200_empty_not_404(client, db):
    response = client.get("/api/schools/不存在/teachers")
    assert response.status_code == 200
    assert response.json() == {"school": "不存在", "teachers": []}


def test_teacher_students_lists_whole_school_including_zero_session(
    client, db, login_as_teacher
):
    db.insert_school("A", "場域A")
    teacher_id, headers = login_as_teacher(name="吳老師", school="A")
    db.insert_student("G1", "S01", "A")
    db.insert_student("G1", "S02", "A")
    db.insert_session(
        "G1", "S01", "A", uuid="u1", start_time=datetime(2026, 9, 1, 12, 0, 0)
    )

    body = client.get(f"/api/teachers/{teacher_id}/students", headers=headers).json()

    assert body["teacherName"] == "吳老師"
    assert body["school"] == "A"
    assert body["studentCount"] == 2
    by_key = {s["studentKey"]: s for s in body["students"]}
    assert by_key["G1_S01"]["sessionCount"] == 1
    assert by_key["G1_S02"]["sessionCount"] == 0
    assert by_key["G1_S02"]["lastPlayedAt"] is None


def test_teacher_students_excludes_other_school_same_case_id(
    client, db, login_as_teacher
):
    db.insert_school("A")
    db.insert_school("B")
    teacher_id, headers = login_as_teacher(name="吳老師", school="A")
    db.insert_student("G1", "S03", "A")
    db.insert_student("G1", "S03", "B")

    body = client.get(f"/api/teachers/{teacher_id}/students", headers=headers).json()

    assert [(s["studentKey"], s["school"]) for s in body["students"]] == [
        ("G1_S03", "A")
    ]


def test_teacher_students_rejects_other_teachers_id(client, db, login_as_teacher):
    """老師只能查自己名下的學生——改 URL 裡的 teacherId 查別人要 403。"""
    db.insert_school("A")
    other_teacher_id = db.insert_teacher("林老師", "A")
    _, headers = login_as_teacher(name="吳老師", school="A")

    response = client.get(
        f"/api/teachers/{other_teacher_id}/students", headers=headers
    )

    assert response.status_code == 403


def test_teachers_students_requires_login(client, db):
    """沒帶 token 一律 401——不管 teacherId 存不存在，先過身份這關。

    「未知 teacherId」本身的 404 分支現在只在極端情況下才會走到（自己的
    teacherId 剛好被刪掉），登入的老師永遠查得到自己，所以不容易單獨測；
    「查別人」已經在 test_teacher_students_rejects_other_teachers_id 涵蓋（403）。
    """
    response = client.get("/api/teachers/99999/students")
    assert response.status_code == 401


def test_teacher_with_nonexistent_school_is_rejected_by_foreign_key(db):
    with pytest.raises(pymysql.IntegrityError):
        db.execute(
            "INSERT INTO teacher (name, school) VALUES (%s, %s)", ["吳老師", "沒登記"]
        )


def test_student_with_nonexistent_school_is_rejected_by_foreign_key(db):
    with pytest.raises(pymysql.IntegrityError):
        db.execute(
            "INSERT INTO student (grade, case_id, school) VALUES (%s, %s, %s)",
            ["G1", "S01", "沒登記"],
        )


def test_duplicate_teacher_in_same_school_is_rejected(db):
    db.insert_school("A")
    db.insert_teacher("吳老師", "A")
    with pytest.raises(pymysql.IntegrityError):
        db.insert_teacher("吳老師", "A")


def test_directory_db_error_returns_500_without_leaking(client, db, break_query):
    break_query("fetch_schools")

    response = client.get("/api/schools")

    assert response.status_code == 500
    assert response.json() == {"detail": "資料庫查詢失敗"}
    assert "43.163.233.40" not in response.text
