"""灌『參照資料』:場域(school)與老師(teacher)名錄。

與 seed.py 的分工(見 docs/superpowers/specs/2026-09-08-teacher-directory-login-design.md):

- seed.py          灌『可重現的假成績』,心態是「先清空再灌、隨時可丟」。
- seed_directory.py 灌『要跟著正式庫走的真參照資料』,心態是「冪等補齊、絕不清空」。

冪等:以 INSERT ... ON DUPLICATE KEY UPDATE 補齊,不 DELETE。重跑不會產生重複,
也不會清掉既有資料(例如手動加的老師)。

安全閘:預設只碰 TEST_DB_NAME 指的 `_test` 庫(守衛拒非 `_test`)。只有明確加上
`--prod` 才讀 DB_NAME 改灌正式庫,且依 ADR-0001「正式庫寫入走 root」。

    uv run python seed_directory.py                       # 預設:_test 庫
    DB_USER=root DB_PASSWORD=... uv run python seed_directory.py --prod   # 正式庫

--- 待廠商確認 ---
下面 SCHOOLS 的第一欄(school 字串)是六張既有表的 join key、Unity POST 的
payload 欄位、所有查詢的參數。定案前先放佔位代碼(KMU / NTHU-01..07),中文放
display_name。字串定案後只改這裡的常數、重跑腳本即可,不動任何邏輯。
"""

from __future__ import annotations

import os
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

# (場域 school 字串, 老師名稱)。每場域 2 位,共 16 位。顯示名稱待廠商提供實際名單。
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
  PRIMARY KEY (`teacher_id`),
  UNIQUE KEY `uq_teacher_school_name` (`school`, `name`),
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


def seed(connection) -> tuple[int, int]:
    """冪等灌入 SCHOOLS / TEACHERS。回傳 (school 總筆數, teacher 總筆數)。"""
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

        cursor.execute("SELECT COUNT(*) AS n FROM school")
        school_count = cursor.fetchone()["n"]
        cursor.execute("SELECT COUNT(*) AS n FROM teacher")
        teacher_count = cursor.fetchone()["n"]
    connection.commit()
    return school_count, teacher_count


def main() -> None:
    target_db = _resolve_target()
    os.environ["DB_NAME"] = target_db
    from db import get_connection

    with get_connection() as connection:
        school_count, teacher_count = seed(connection)

    print(f"已補齊 {target_db}：school {school_count} 筆、teacher {teacher_count} 筆。")


if __name__ == "__main__":
    main()
