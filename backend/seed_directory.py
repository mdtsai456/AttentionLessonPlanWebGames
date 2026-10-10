"""插入場域 school 與老師 teacher 的名錄資料。

分工見 docs/superpowers/specs/2026-09-08-teacher-directory-login-design.md。
seed.py 先清空遊戲資料，再插入可重現的模擬成績。
seed_directory.py 以冪等操作補齊名錄，不清空既有資料。

使用 INSERT ... ON DUPLICATE KEY UPDATE，不執行 DELETE。
重複執行不會增加重複資料，也不刪除手動加入的老師。

預設使用 TEST_DB_NAME，且名稱須以 _test 結尾。
只有使用 --prod 時，才讀取 DB_NAME，並依 ADR-0001 使用 root 寫入正式資料庫。

    uv run python seed_directory.py                       # 預設：_test 資料庫
    DB_USER=root DB_PASSWORD=... uv run python seed_directory.py --prod   # 正式資料庫

場域字串：
SCHOOLS 的第一欄是既有六張表的 join key、Unity POST 的 payload 欄位與查詢參數。
使用短 ASCII 代碼 KMU、NTHU-01 … NTHU-07。三方共用定義見 docs/school-directory.md。
廠商可調整 display_name 與老師名稱。顯示名稱修改常數後，重新執行腳本即可更新。
display_name 使用 ON DUPLICATE KEY UPDATE。修改老師名稱時，須先清除 teacher 表再重新執行。
"""

from __future__ import annotations

import os
import secrets
import sys

from dotenv import load_dotenv

load_dotenv()

# (school 字串, 顯示名稱, 排序)
SCHOOLS: list[tuple[str, str, int]] = [
    ("KMU", "高雄醫學大學", 0),
    ("NTHU-01", "清華大學（第一場）", 1),
    ("NTHU-02", "清華大學（第二場）", 2),
    ("NTHU-03", "清華大學（第三場）", 3),
    ("NTHU-04", "清華大學（第四場）", 4),
    ("NTHU-05", "清華大學（第五場）", 5),
    ("NTHU-06", "清華大學（第六場）", 6),
    ("NTHU-07", "清華大學（第七場）", 7),
]

# (場域 school 字串, 老師名稱)。每場域兩位，共 16 位。名稱為預留值，待廠商提供正式名單。
TEACHERS: list[tuple[str, str]] = [
    ("KMU", "吳老師"), ("KMU", "林老師"),
    ("NTHU-01", "王老師"), ("NTHU-01", "陳老師"),
    ("NTHU-02", "張老師"), ("NTHU-02", "李老師"),
    ("NTHU-03", "黃老師"), ("NTHU-03", "劉老師"),
    ("NTHU-04", "蔡老師"), ("NTHU-04", "楊老師"),
    ("NTHU-05", "許老師"), ("NTHU-05", "鄭老師"),
    ("NTHU-06", "謝老師"), ("NTHU-06", "郭老師"),
    ("NTHU-07", "洪老師"), ("NTHU-07", "曾老師"),
]

CREATE_SCHOOL = """
CREATE TABLE IF NOT EXISTS `school` (
  `school` varchar(100) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`school`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

CREATE_TEACHER = """
CREATE TABLE IF NOT EXISTS `teacher` (
  `teacher_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL DEFAULT '',
  `account` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`teacher_id`),
  UNIQUE KEY `uq_teacher_school_name` (`school`, `name`),
  UNIQUE KEY `uq_teacher_account` (`account`),
  CONSTRAINT `fk_teacher_school` FOREIGN KEY (`school`)
    REFERENCES `school` (`school`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def _assert_test_database(name: str) -> None:
    if not name.endswith("_test"):
        raise SystemExit(f"拒絕在非測試資料庫上執行：{name}")


def _resolve_target() -> str:
    if "--prod" in sys.argv:
        name = os.getenv("DB_NAME")
        if not name:
            raise SystemExit("未設定 DB_NAME，無法定位正式庫。")
        print(f"--prod：將以冪等方式補齊正式庫 {name} 的 school / teacher（不清空）。")
        return name

    name = os.getenv("TEST_DB_NAME")
    if not name:
        raise SystemExit("未設定 TEST_DB_NAME，拒絕執行（不會去猜正式庫）。")
    _assert_test_database(name)
    return name


def _generate_readable_password() -> str:
    """產生長度適合人工抄寫的隨機密碼，供管理者交給老師。"""
    return secrets.token_urlsafe(9)


def seed(connection) -> tuple[int, int, list[tuple[str, str, str, str]]]:
    """以冪等操作插入 SCHOOLS／TEACHERS。

    回傳 (school 總筆數, teacher 總筆數, 新指派的帳密清單)。
    帳密清單只包含此次建立的帳號，來源為 account 原為 NULL 的老師。
    不覆寫既有帳號，因此重複執行不會使既有帳號或密碼失效。

    帳號格式為 T0001，使用插入時才產生的 teacher_id（AUTO_INCREMENT）。
    先 upsert school/name，再為 account 為 NULL 的列補上 account 與密碼。
    """
    from auth import hash_password

    with connection.cursor() as cursor:
        cursor.execute(CREATE_SCHOOL)
        cursor.execute(CREATE_TEACHER)

        cursor.executemany(
            """
            INSERT INTO school (school, display_name, sort_order)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE
                display_name = VALUES(display_name),
                sort_order = VALUES(sort_order)
            """,
            SCHOOLS,
        )
        cursor.executemany(
            """
            INSERT INTO teacher (school, name)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE name = VALUES(name)
            """,
            TEACHERS,
        )

        cursor.execute(
            "SELECT teacher_id, name, school FROM teacher WHERE account IS NULL"
        )
        teachers_needing_credentials = cursor.fetchall()
        new_credentials: list[tuple[str, str, str, str]] = []
        for row in teachers_needing_credentials:
            account = f"T{row['teacher_id']:04d}"
            plaintext = _generate_readable_password()
            cursor.execute(
                "UPDATE teacher SET account = %s, password_hash = %s WHERE teacher_id = %s",
                [account, hash_password(plaintext), row["teacher_id"]],
            )
            new_credentials.append((row["school"], row["name"], account, plaintext))

        cursor.execute("SELECT COUNT(*) AS n FROM school")
        school_count = cursor.fetchone()["n"]
        cursor.execute("SELECT COUNT(*) AS n FROM teacher")
        teacher_count = cursor.fetchone()["n"]
    connection.commit()
    return school_count, teacher_count, new_credentials


def main() -> None:
    target_db = _resolve_target()
    os.environ["DB_NAME"] = target_db
    from db import get_connection

    with get_connection() as connection:
        school_count, teacher_count, new_credentials = seed(connection)

    print(f"已補齊 {target_db}：school {school_count} 筆、teacher {teacher_count} 筆。")

    if new_credentials:
        print()
        print(f"新指派了 {len(new_credentials)} 組老師帳密（只印一次，請自行記錄；")
        print("這個腳本不會把明碼寫進任何檔案）：")
        print(f"{'場域':<10} {'姓名':<8} {'帳號':<8} 密碼")
        for school, name, account, plaintext in new_credentials:
            print(f"{school:<10} {name:<8} {account:<8} {plaintext}")


if __name__ == "__main__":
    main()
