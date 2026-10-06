import os

from dotenv import load_dotenv

load_dotenv()

from auth import verify_password
from db import get_read_connection

print("DB_NAME", repr(os.getenv("DB_NAME")))

with get_read_connection() as conn:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT student_id, account, grade, case_id, school, password_hash "
            "FROM student ORDER BY student_id"
        )
        rows = cur.fetchall()

print("students", len(rows))
for row in rows:
    stored = row["password_hash"] or ""
    matches = verify_password("test1234", stored)
    print(
        f"{row['account']}\t{row['grade']}_{row['case_id']}\t{row['school']}\t"
        f"id={row['student_id']}\ttest1234={matches}\tempty={not stored}"
    )
