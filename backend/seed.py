"""灌 mock data,供本機開發/demo 肉眼看 API。

設計見 docs/superpowers/plans/2026-07-10-seed-mock-data.md。

安全:預設只灌 TEST_DB_NAME 指的 `_test` 庫(守衛拒非 `_test`),此路徑不讀
DB_NAME。只有明確加上 `--prod` 才會讀 DB_NAME 改灌正式庫。兩種模式都是
先清空再灌,固定亂數種子 → 完全可重現。

    .venv/bin/python seed.py           # 預設:_test 庫
    .venv/bin/python seed.py --prod    # 正式庫(先清空!)
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

# --- 產生參數(全是常數,調這裡就能放大縮小) ---

SEED = 20260710
SCHEMA_PATH = pathlib.Path(__file__).parent / "tests" / "schema.sql"

SCHOOLS = ["陽光國小", "西門國小", "民富國小"]
STUDENTS = [("G1", "S01"), ("G1", "S02"), ("G1", "S03"),
            ("G2", "S04"), ("G2", "S05"), ("G2", "S06")]

# 每日固定順序;game_type 必須精確對上 queries.GAME_RESULT_TABLES 的鍵(TGAME 全大寫)。
GAMES = ["DCCS", "DAT", "EFT", "IM", "TGAME"]

# 廠商只做這三款的雙人版。這些遊戲在下列 day_in_round 額外多灌一場 mode='double',
# 讓報告頁「單/雙人並陳」的畫面有東西可畫(每 Round 3 場雙人)。
DOUBLE_GAMES = {"DCCS", "DAT", "EFT"}
DOUBLE_DAYS_IN_ROUND = {2, 6, 9}  # 0..11
GAME_TABLE = {
    "DCCS": "dccs_result",
    "DAT": "dat_result",
    "EFT": "eft_result",
    "IM": "im_result",
    "TGAME": "tgame_result",
}

# 由子表往父表刪,避開外鍵限制。
TABLES_CHILD_FIRST = (
    "dat_result", "dccs_result", "eft_result", "im_result", "tgame_result",
    "assessment_result", "student",
)

# 日曆:兩個 Round,各連續 4 週、每週一/三/五。B 隔約一個月才開始。
ROUND_STARTS = [("A", date(2026, 1, 5)), ("B", date(2026, 3, 2))]  # 皆為週一
WEEKDAY_OFFSETS = (0, 2, 4)  # 一、三、五
WEEKS = 4
DAILY_START = (12, 0)  # 每天 12:00 開始


def build_play_days() -> list[dict]:
    """展開成 24 個施測日:current_day 1..24(A 為 1-12、B 為 13-24)。"""
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
    """每個(學生 × 遊戲)的軌跡:回 (Round A 均值, Round B 均值)。

    進步 60% / 持平 25% / 略退 15%,整體淨進步。
    """
    a0 = rng.uniform(0.45, 0.70)
    roll = rng.random()
    if roll < 0.60:                         # 進步
        b_mean = min(a0 + rng.uniform(0.08, 0.20), 0.98)
    elif roll < 0.85:                       # 持平
        b_mean = a0 + rng.uniform(-0.02, 0.02)
    else:                                   # 略退
        b_mean = max(a0 - rng.uniform(0.02, 0.06), 0.30)
    return a0, b_mean


def session_accuracy(rng: random.Random, round_label: str, day_in_round: int,
                     a0: float, b_mean: float) -> float:
    """單場 accuracy(0-1):Round 均值 + 12 天微升趨勢 + 每場雜訊。"""
    mean = a0 if round_label == "A" else b_mean
    drift = (day_in_round / 11 - 0.5) * 0.04  # 微升
    noise = rng.uniform(-0.03, 0.03)
    return min(0.99, max(0.02, mean + drift + noise))


def make_uuid(school: str, grade: str, case_id: str, game: str, current_day: int,
              mode: str = "single") -> str:
    """確定性 uuid(uuid5,同輸入永遠同輸出),36 字元,符合 varchar(36)。"""
    key = f"{school}|{grade}|{case_id}|{game}|{current_day}"
    if mode == "double":
        key += "|double"
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, key))


def make_pair_id(school: str, grade: str, case_id: str, game: str, current_day: int) -> str:
    """雙人局識別碼。假資料裡一場雙人局只有這位學生一筆,pair_id 仍給確定性值。"""
    key = f"{school}|{grade}|{case_id}|{game}|{current_day}|double"
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, key))


def generate() -> tuple[list, list, dict[str, list]]:
    """產生 (student_rows, session_rows, detail_rows_by_table)。"""
    rng = random.Random(SEED)
    play_days = build_play_days()

    student_rows: list[tuple] = []
    session_rows: list[tuple] = []
    detail_rows: dict[str, list] = {table: [] for table in GAME_TABLE.values()}

    for school in SCHOOLS:
        for grade, case_id in STUDENTS:
            student_rows.append((grade, case_id, school))
            trajectory = {game: make_trajectory(rng) for game in GAMES}

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
                    accuracy = correct / stage  # 由計數回算,完全一致
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

                    session_rows.append((
                        grade, case_id, school, game_uuid,
                        start_dt, game, mode, pair_id, day["current_day"], end_dt,
                    ))
                    # 只填核心 5 欄;其餘遊戲專屬欄位留 NULL。
                    detail_rows[GAME_TABLE[game]].append((
                        grade, case_id, school, game_uuid,
                        correct, wrong, accuracy, duration_ms, stage,
                    ))
                    return end_dt + timedelta(minutes=rng.uniform(0, 2))  # 小空檔

                # 上午 12:00:5 款單人版一款接一款(整套約 30 分鐘)。
                clock = datetime(day["date"].year, day["date"].month, day["date"].day,
                                 DAILY_START[0], DAILY_START[1])
                for game in GAMES:
                    clock = emit(game, "single", clock, 0.0)

                # 下午另一時段:DAT/DCCS/EFT 在特定施測日多一場雙人版。
                # 雙人版通常較簡單 → accuracy 略高,讓圖上看得出單/雙人差異。
                if day["day_in_round"] in DOUBLE_DAYS_IN_ROUND:
                    clock = datetime(day["date"].year, day["date"].month,
                                     day["date"].day, 14, 0)
                    for game in GAMES:
                        if game in DOUBLE_GAMES:
                            clock = emit(game, "double", clock, 0.08)

    return student_rows, session_rows, detail_rows


def _assert_test_database(name: str) -> None:
    assert name.endswith("_test"), f"拒絕在非測試資料庫上執行:{name}"


def _schema_statements() -> list[str]:
    raw = SCHEMA_PATH.read_text(encoding="utf-8")
    lines = [line for line in raw.splitlines() if not line.strip().startswith("--")]
    return [stmt.strip() for stmt in "\n".join(lines).split(";") if stmt.strip()]


def _resolve_target() -> str:
    """回傳要灌的庫名。

    預設灌 TEST_DB_NAME 指的 `_test` 庫,並要求名字以 `_test` 結尾。
    只有明確加上 `--prod` 才會改灌 DB_NAME 指的正式庫(一樣先清空再灌)——
    這道 opt-in 讓正式庫不會被手滑波及。
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

    # 讓 db.get_db_config() 連到解析出的目標庫。
    os.environ["DB_NAME"] = target_db
    from db import get_connection

    student_rows, session_rows, detail_rows = generate()

    with get_connection() as connection:
        with connection.cursor() as cursor:
            # 建表(若不存在),讓腳本在全新 _test 庫上也能跑。
            for statement in _schema_statements():
                cursor.execute(statement)

            # 先清空再灌。非 --prod 時,最後再確認一次目標確實是 `_test`。
            if "--prod" not in sys.argv:
                _assert_test_database(os.environ["DB_NAME"])
            for table in TABLES_CHILD_FIRST:
                cursor.execute(f"DELETE FROM {table}")

            cursor.executemany(
                "INSERT INTO student (grade, case_id, school) VALUES (%s, %s, %s)",
                student_rows,
            )
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


if __name__ == "__main__":
    main()
