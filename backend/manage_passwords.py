"""管理者手動設定/重設單一老師或學生的密碼。

給 seed_directory.py（批次指派）之外的日常操作用：某位老師忘記密碼、要換人、
或廠商晚點才給的某個學生要單獨設密碼，都用這支。

安全閘沿用 seed_directory.py 的模式：預設只碰 TEST_DB_NAME 指的 `_test` 庫，
要碰正式庫要明確加 `--prod`（讀 DB_NAME，依 ADR-0001「正式庫寫入走 root」）。

    uv run python manage_passwords.py teacher <school> <name> <new_password>
    uv run python manage_passwords.py student <school> <studentKey> <new_password>
    uv run python manage_passwords.py teacher <school> <name> <new_password> --prod
"""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

load_dotenv()


def _assert_test_database(name: str) -> None:
    if not name.endswith("_test"):
        raise SystemExit(f"拒絕在非測試資料庫上執行：{name}")


def _resolve_target(argv: list[str]) -> str:
    if "--prod" in argv:
        name = os.getenv("DB_NAME")
        if not name:
            raise SystemExit("未設定 DB_NAME，無法定位正式庫。")
        return name

    name = os.getenv("TEST_DB_NAME")
    if not name:
        raise SystemExit("未設定 TEST_DB_NAME，拒絕執行（不會去猜正式庫）。")
    _assert_test_database(name)
    return name


def _parse_student_key(student_key: str) -> tuple[str, str]:
    parts = student_key.strip().split("_", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise SystemExit(f"studentKey 格式應為 G1_S03（grade_caseId），收到：{student_key}")
    return parts[0], parts[1]


def set_teacher_password(connection, school: str, name: str, new_password: str) -> str | None:
    """更新密碼；若這位老師還沒有 account（例如手動建的、沒走過 seed_directory.py），
    順便補一個。回傳最終的 account，None 表示查無此老師。
    """
    from auth import hash_password

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT teacher_id, account FROM teacher WHERE school = %s AND name = %s",
            [school, name],
        )
        row = cursor.fetchone()
        if row is None:
            return None

        account = row["account"] or f"T{row['teacher_id']:04d}"
        cursor.execute(
            "UPDATE teacher SET password_hash = %s, account = %s WHERE teacher_id = %s",
            [hash_password(new_password), account, row["teacher_id"]],
        )
    connection.commit()
    return account


def set_student_password(
    connection, school: str, student_key: str, new_password: str
) -> str | None:
    """同 set_teacher_password，但對象是學生；查無此學生回傳 None。"""
    from auth import hash_password

    grade, case_id = _parse_student_key(student_key)
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT student_id, account FROM student "
            "WHERE grade = %s AND case_id = %s AND school = %s",
            [grade, case_id, school],
        )
        row = cursor.fetchone()
        if row is None:
            return None

        account = row["account"] or f"S{row['student_id']:04d}"
        cursor.execute(
            "UPDATE student SET password_hash = %s, account = %s "
            "WHERE grade = %s AND case_id = %s AND school = %s",
            [hash_password(new_password), account, grade, case_id, school],
        )
    connection.commit()
    return account


def main() -> None:
    argv = [arg for arg in sys.argv[1:] if arg != "--prod"]
    if len(argv) != 4:
        raise SystemExit(__doc__)

    role, school, identifier, new_password = argv
    if role not in ("teacher", "student"):
        raise SystemExit(f"第一個參數要是 teacher 或 student，收到：{role}")

    target_db = _resolve_target(sys.argv[1:])
    os.environ["DB_NAME"] = target_db
    from db import get_connection

    with get_connection() as connection:
        if role == "teacher":
            account = set_teacher_password(connection, school, identifier, new_password)
        else:
            account = set_student_password(connection, school, identifier, new_password)

    if account is None:
        raise SystemExit(f"查無此{'老師' if role == 'teacher' else '學生'}：{school} / {identifier}")

    print(f"已在 {target_db} 更新 {role} {school}/{identifier} 的密碼。登入帳號：{account}")


if __name__ == "__main__":
    main()
