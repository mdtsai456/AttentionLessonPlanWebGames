"""供管理者設定或重設單一老師或學生的密碼。

seed_directory.py 用於批次指派帳號。本腳本用於忘記密碼、人員變更或新增學生等單筆操作。

預設使用 TEST_DB_NAME 指定的資料庫，名稱須以 _test 結尾。
操作正式資料庫時，須加入 --prod，改讀 DB_NAME，並依 ADR-0001 使用 root 寫入。

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
    """更新老師密碼。尚未有 account 時，建立帳號。
    回傳 account。查無老師時，回傳 None。
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
    """使用與 set_teacher_password 相同的流程更新學生密碼。查無學生時，回傳 None。"""
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
