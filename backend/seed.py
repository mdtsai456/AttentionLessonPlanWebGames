"""插入模擬資料，供本機開發與展示時檢查 API。

設計見 docs/superpowers/plans/2026-07-10-seed-mock-data.md。

預設使用 TEST_DB_NAME，名稱須以 _test 結尾，此模式不讀取 DB_NAME。
使用 --prod 時，改用 DB_NAME 指定的正式資料庫。
兩種模式皆先清空資料，再插入資料。固定亂數種子使結果可重現。

    .venv/bin/python seed.py           # 預設：_test 資料庫
    .venv/bin/python seed.py --prod    # 正式資料庫，先清空資料
"""

from __future__ import annotations

import os
import pathlib
import random
import sys
import uuid
from datetime import date, datetime, timedelta

from dotenv import load_dotenv

load_dotenv()

# 資料產生參數。修改常數可調整資料量。

SEED = 20260710
SCHEMA_PATH = pathlib.Path(__file__).parent / "tests" / "schema.sql"

# 使用 seed_directory.py 的前三個預留場域代碼，支援老師、學生與報告的驗收流程。
# 老師隸屬這些場域。場域字串變更時，須同步修改兩個腳本。
SCHOOLS = ["KMU", "NTHU-01", "NTHU-02"]
STUDENTS = [("G1", "S01"), ("G1", "S02"), ("G1", "S03"),
            ("G2", "S04"), ("G2", "S05"), ("G2", "S06")]

# 每日使用固定順序。game_type 須符合 queries.GAME_RESULT_TABLES 的鍵，TGAME 須使用大寫。
GAMES = ["DCCS", "DAT", "EFT", "IM", "TGAME"]

# 模擬學生使用此密碼登入，僅供測試與本機展示。
# 正式老師的密碼由 seed_directory.py 隨機產生。
TEST_STUDENT_PASSWORD = "test1234"
# hash_password() 每次呼叫皆產生新的隨機 salt。若在 generate() 中計算，
# 相同 SEED 的兩次 generate() 結果將不同，造成 test_seed.py 的
# test_generate_is_deterministic 失敗。此處使用預先計算的固定雜湊值，
# 等同 hash_password(TEST_STUDENT_PASSWORD)，避免每次重新計算。
TEST_STUDENT_PASSWORD_HASH = (
    "pbkdf2_sha256$260000$6d14c6d77b17caf8da908e6e35bf1787$"
    "0aa3fbae00fe840815feecee3ec4a5a7ba703e8a62feb369a6edc08042b780e9"
)

# 這三款遊戲支援雙人模式。在指定的 day_in_round，額外加入 mode='double' 的場次，
# 供報告頁顯示單人與雙人結果。每個 Round 有三場雙人遊戲。
DOUBLE_GAMES = {"DCCS", "DAT", "EFT"}
DOUBLE_DAYS_IN_ROUND = {2, 6, 9}  # 0..11

# 每位學生最多有 24 個施測日，與 build_play_days() 的結果相同。
# 實際到課與遊玩情況可能未涵蓋每日五款單人遊戲，因此從所有可能場次中抽樣。
# 每位學生的單人與雙人總場次數，限制在下列常數指定的區間，
# 以模擬實際使用量。修改兩個常數可調整資料量。
MIN_SESSIONS_PER_STUDENT = 10
MAX_SESSIONS_PER_STUDENT = 20
GAME_TABLE = {
    "DCCS": "dccs_result",
    "DAT": "dat_result",
    "EFT": "eft_result",
    "IM": "im_result",
    "TGAME": "tgame_result",
}

# 先刪除子表，再刪除父表，避免違反外鍵約束。
TABLES_CHILD_FIRST = (
    "dat_result", "dccs_result", "eft_result", "im_result", "tgame_result",
    "assessment_result", "student",
)

# 施測日曆包含兩個 Round。每個 Round 連續四週，於週一、三、五施測。B 約隔一個月開始。
ROUND_STARTS = [("A", date(2026, 1, 5)), ("B", date(2026, 3, 2))]  # 皆為週一
WEEKDAY_OFFSETS = (0, 2, 4)  # 一、三、五
WEEKS = 4
DAILY_START = (12, 0)  # 每天 12:00 開始


def build_play_days() -> list[dict]:
    """產生 24 個施測日。current_day 為 1..24，A 為 1–12，B 為 13–24。"""
    days: list[dict] = []
    current_day = 0
    for label, start in ROUND_STARTS:
        for week in range(WEEKS):
            for offset in WEEKDAY_OFFSETS:
                current_day += 1
                days.append({
                    "round": label,
                    "current_day": current_day,
                    "day_in_round": (current_day - 1) % 12,  # 0..11
                    "date": start + timedelta(days=week * 7 + offset),
                })
    return days


def make_trajectory(rng: random.Random) -> tuple[float, float]:
    """回傳每位學生與每款遊戲的 (Round A 均值, Round B 均值)。

    60% 模擬進步，25% 模擬持平，15% 模擬略為下降，整體均值上升。
    """
    a0 = rng.uniform(0.45, 0.70)
    roll = rng.random()
    if roll < 0.60:                         # 進步
        b_mean = min(a0 + rng.uniform(0.08, 0.20), 0.98)
    elif roll < 0.85:                       # 持平
        b_mean = a0 + rng.uniform(-0.02, 0.02)
    else:                                   # 略為下降
        b_mean = max(a0 - rng.uniform(0.02, 0.06), 0.30)
    return a0, b_mean


def session_accuracy(rng: random.Random, round_label: str, day_in_round: int,
                     a0: float, b_mean: float) -> float:
    """單場 accuracy 為 0–1，由 Round 均值、12 天的上升趨勢與每場雜訊組成。"""
    mean = a0 if round_label == "A" else b_mean
    drift = (day_in_round / 11 - 0.5) * 0.04  # 略為上升
    noise = rng.uniform(-0.03, 0.03)
    return min(0.99, max(0.02, mean + drift + noise))


def make_uuid(school: str, grade: str, case_id: str, game: str, current_day: int,
              mode: str = "single") -> str:
    """使用 uuid5 產生確定性的 uuid。相同輸入產生相同結果，共 36 字元，符合 varchar(36)。"""
    key = f"{school}|{grade}|{case_id}|{game}|{current_day}"
    if mode == "double":
        key += "|double"
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, key))


def make_pair_id(school: str, grade: str, case_id: str, game: str, current_day: int) -> str:
    """雙人場次的識別碼。模擬資料中，每場雙人遊戲只包含一位學生的成績，pair_id 仍使用確定性值。"""
    key = f"{school}|{grade}|{case_id}|{game}|{current_day}|double"
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, key))


def generate() -> tuple[list, list, dict[str, list]]:
    """產生 (student_rows, session_rows, detail_rows_by_table)。

    先建立每位學生的所有可能場次，包含 24 個施測日的五款單人遊戲與指定日期的雙人遊戲。
    再隨機抽樣，使單人與雙人總場次數位於 MIN_SESSIONS_PER_STUDENT..MAX_SESSIONS_PER_STUDENT。
    依時間排序後插入資料，以模擬實際到課與遊玩情況。
    """
    rng = random.Random(SEED)
    play_days = build_play_days()

    student_rows: list[tuple] = []
    session_rows: list[tuple] = []
    detail_rows: dict[str, list] = {table: [] for table in GAME_TABLE.values()}

    for school in SCHOOLS:
        for grade, case_id in STUDENTS:
            student_rows.append((grade, case_id, school, TEST_STUDENT_PASSWORD_HASH))
            trajectory = {game: make_trajectory(rng) for game in GAMES}

            possible_sessions: list[tuple] = []
            possible_details: dict[str, tuple[str, tuple]] = {}  # uuid -> (table, row)

            for day in play_days:
                def emit(game: str, mode: str, clock: datetime, acc_bonus: float) -> datetime:
                    a0, b_mean = trajectory[game]
                    acc = session_accuracy(
                        rng, day["round"], day["day_in_round"], a0, b_mean
                    )
                    acc = min(0.99, acc + acc_bonus)

                    stage = rng.randint(15, 40)
                    correct = max(0, min(stage, round(acc * stage)))
                    wrong = stage - correct
                    accuracy = correct / stage  # 由計數重新計算，使結果一致。
                    duration_ms = 360000 + rng.uniform(-20000, 20000)

                    start_dt = clock
                    end_dt = start_dt + timedelta(milliseconds=duration_ms)
                    game_uuid = make_uuid(
                        school, grade, case_id, game, day["current_day"], mode
                    )
                    pair_id = (
                        make_pair_id(school, grade, case_id, game, day["current_day"])
                        if mode == "double"
                        else None
                    )

                    possible_sessions.append((
                        grade, case_id, school, game_uuid,
                        start_dt, game, mode, pair_id, day["current_day"], end_dt,
                    ))
                    # 只填入五個核心欄位，其餘遊戲專用欄位維持 NULL。
                    possible_details[game_uuid] = (GAME_TABLE[game], (
                        grade, case_id, school, game_uuid,
                        correct, wrong, accuracy, duration_ms, stage,
                    ))
                    return end_dt + timedelta(minutes=rng.uniform(0, 2))  # 場次間隔

                # 12:00 開始依序執行五款單人遊戲，總時長約 30 分鐘。
                clock = datetime(day["date"].year, day["date"].month, day["date"].day,
                                 DAILY_START[0], DAILY_START[1])
                for game in GAMES:
                    clock = emit(game, "single", clock, 0.0)

                # DAT／DCCS／EFT 在指定施測日的下午時段，額外安排一場雙人遊戲。
                # 模擬雙人模式的 accuracy 略高，以顯示單人與雙人的差異。
                if day["day_in_round"] in DOUBLE_DAYS_IN_ROUND:
                    clock = datetime(day["date"].year, day["date"].month,
                                     day["date"].day, 14, 0)
                    for game in GAMES:
                        if game in DOUBLE_GAMES:
                            clock = emit(game, "double", clock, 0.08)

            # 從所有可能場次中抽樣，作為該學生的實際遊玩場次。
            target = rng.randint(MIN_SESSIONS_PER_STUDENT, MAX_SESSIONS_PER_STUDENT)
            target = min(target, len(possible_sessions))
            chosen = rng.sample(possible_sessions, target)
            chosen.sort(key=lambda row: row[4])  # 按 start_time 排序，使場次依時間排列。

            session_rows.extend(chosen)
            for row in chosen:
                table, detail_row = possible_details[row[3]]  # row[3] = uuid
                detail_rows[table].append(detail_row)

    return student_rows, session_rows, detail_rows


def _assert_test_database(name: str) -> None:
    assert name.endswith("_test"), f"拒絕在非測試資料庫上執行:{name}"


def _schema_statements() -> list[str]:
    raw = SCHEMA_PATH.read_text(encoding="utf-8")
    lines = [line for line in raw.splitlines() if not line.strip().startswith("--")]
    return [stmt.strip() for stmt in "\n".join(lines).split(";") if stmt.strip()]


def _resolve_target() -> str:
    """回傳資料插入的目標資料庫名稱。

    預設使用 TEST_DB_NAME，且名稱須以 _test 結尾。
    只有使用 --prod 時，才改用 DB_NAME 指定的正式資料庫。
    兩種模式皆先清空資料，再插入資料。
    """
    if "--prod" in sys.argv:
        name = os.getenv("DB_NAME")
        if not name:
            raise SystemExit("未設定 DB_NAME,無法定位正式庫。")
        print(f"⚠️  --prod:即將『先清空再灌』正式庫 {name}(所有現有資料會被刪除)。")
        return name

    name = os.getenv("TEST_DB_NAME")
    if not name:
        raise SystemExit("未設定 TEST_DB_NAME,拒絕執行(不會去猜正式庫)。")
    _assert_test_database(name)
    return name


def main() -> None:
    target_db = _resolve_target()

    # 讓 db.get_db_config() 連線至已解析的目標資料庫。
    os.environ["DB_NAME"] = target_db
    from db import get_connection

    student_rows, session_rows, detail_rows = generate()

    with get_connection() as connection:
        with connection.cursor() as cursor:
            # 資料表不存在時，建立資料表，讓腳本可在新的 _test 資料庫執行。
            for statement in _schema_statements():
                cursor.execute(statement)

            # 先清空資料，再插入新資料。未使用 --prod 時，再次確認目標名稱以 _test 結尾。
            if "--prod" not in sys.argv:
                _assert_test_database(os.environ["DB_NAME"])
            for table in TABLES_CHILD_FIRST:
                cursor.execute(f"DELETE FROM {table}")

            # student.school 的外鍵指向 school。插入模擬學生前，先以冪等操作補齊場域。
            # 保留 school 既有資料。seed_directory.py 負責顯示名稱與排序。
            cursor.executemany(
                "INSERT INTO school (school, display_name, sort_order) "
                "VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE school = school",
                [(name, name, order) for order, name in enumerate(SCHOOLS)],
            )
            cursor.executemany(
                "INSERT INTO student (grade, case_id, school, password_hash) "
                "VALUES (%s, %s, %s, %s)",
                student_rows,
            )

            # 模擬學生的 account 需在 INSERT 後產生。
            # 帳號格式為 S0001，使用 student_id。此 AUTO_INCREMENT 值在插入時才產生，
            # 因此插入後再以 UPDATE 補上帳號。seed_directory.py
            # 也使用此流程建立老師的 account。
            cursor.execute("SELECT grade, case_id, school, student_id FROM student")
            sample_account = None
            for row in cursor.fetchall():
                account = f"S{row['student_id']:04d}"
                cursor.execute(
                    "UPDATE student SET account = %s "
                    "WHERE grade = %s AND case_id = %s AND school = %s",
                    [account, row["grade"], row["case_id"], row["school"]],
                )
                if sample_account is None:
                    sample_account = account
            cursor.executemany(
                """
                INSERT INTO assessment_result
                    (grade, case_id, school, uuid, start_time, game_type,
                     mode, pair_id, current_day, end_time)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                session_rows,
            )
            for table, rows in detail_rows.items():
                cursor.executemany(
                    f"""
                    INSERT INTO {table}
                        (grade, case_id, school, uuid, correct_count, wrong_count, accuracy, duration, stage)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    rows,
                )
        connection.commit()

    detail_total = sum(len(rows) for rows in detail_rows.values())
    print(f"已灌入 {target_db}:")
    print(f"  student           {len(student_rows):>5}")
    print(f"  assessment_result {len(session_rows):>5}")
    print(f"  各遊戲明細合計      {detail_total:>5}")
    print(f"所有假學生密碼統一是：{TEST_STUDENT_PASSWORD}（測試/本機 demo 用）")
    print(f"帳號依 student_id 依序指派為 S0001、S0002……（帳號不會出現在任何 API 回應裡，")
    print(f"要看完整清單請直接查 DB 的 student.account 欄位）；隨便挑一個試登入，例如：{sample_account}")


if __name__ == "__main__":
    main()
