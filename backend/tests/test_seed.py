"""seed.py 的純邏輯測試,完全不碰資料庫。

只斷言產生資料的不變式,讓日後調整 seed 常數時若弄壞這些性質會立刻亮紅。
tuple 欄位順序沿用 seed.generate():
  session: (grade, case_id, school, uuid, start_time, game_type,
            mode, pair_id, current_day, end_time)
  detail : (grade, case_id, school, uuid, correct, wrong, accuracy, duration, stage)
"""

import seed

# session tuple 欄位索引
S_UUID = 3
S_START = 4
S_GAME_TYPE = 5
S_MODE = 6
S_PAIR_ID = 7
S_CURRENT_DAY = 8
S_END = 9


def _expected_double_session_count() -> int:
    n_students = len(seed.SCHOOLS) * len(seed.STUDENTS)
    # 每個 day_in_round 值在 24 個施測日裡出現兩次(A、B 各一)。
    double_days = len(seed.DOUBLE_DAYS_IN_ROUND) * 2
    return n_students * len(seed.DOUBLE_GAMES) * double_days


def test_generate_is_deterministic():
    # 固定 seed → 兩次產生完全相同,重灌才會可重現。
    assert seed.generate() == seed.generate()


def test_row_counts():
    students, sessions, details = seed.generate()
    n_students = len(seed.SCHOOLS) * len(seed.STUDENTS)
    n_single = n_students * len(seed.GAMES) * 24  # 24 個施測日
    n_double = _expected_double_session_count()

    assert n_students == 18
    assert len(students) == n_students
    assert n_single == 2160
    assert n_double == 324
    assert len(sessions) == n_single + n_double == 2484
    assert sum(len(rows) for rows in details.values()) == len(sessions)


def test_single_and_double_session_split():
    _, sessions, _ = seed.generate()
    by_mode: dict[str, int] = {}
    for row in sessions:
        by_mode[row[S_MODE]] = by_mode.get(row[S_MODE], 0) + 1

    assert by_mode == {"single": 2160, "double": 324}


def test_double_sessions_only_for_capable_games_and_carry_pair_id():
    _, sessions, _ = seed.generate()
    for row in sessions:
        if row[S_MODE] == "double":
            assert row[S_GAME_TYPE] in seed.DOUBLE_GAMES
            assert row[S_PAIR_ID] is not None
            assert len(row[S_PAIR_ID]) == 36
        else:
            assert row[S_PAIR_ID] is None


def test_game_type_keys_match_result_tables():
    # game_type 必須精確對上 queries 的白名單鍵,含全大寫 TGAME,否則 report 查不到 stats。
    from queries import GAME_RESULT_TABLES

    _, sessions, _ = seed.generate()
    game_types = {row[S_GAME_TYPE] for row in sessions}
    assert game_types == set(seed.GAMES)
    assert game_types <= set(GAME_RESULT_TABLES)
    assert "TGAME" in game_types


def test_current_day_covers_1_to_24():
    _, sessions, _ = seed.generate()
    assert {row[S_CURRENT_DAY] for row in sessions} == set(range(1, 25))


def test_stats_are_internally_consistent():
    _, _, details = seed.generate()
    for rows in details.values():
        for (_g, _c, _s, _u, correct, wrong, accuracy, duration, stage) in rows:
            assert 15 <= stage <= 40
            assert 0 <= correct <= stage
            assert stage == correct + wrong
            assert accuracy == correct / stage
            assert 340000 <= duration <= 380000  # 360000 ± 20000 ms


def test_uuids_unique_and_deterministic():
    _, sessions, _ = seed.generate()
    uuids = [row[S_UUID] for row in sessions]
    assert len(set(uuids)) == len(uuids)  # 全域唯一

    once = seed.make_uuid("陽光國小", "G1", "S01", "DCCS", 1)
    twice = seed.make_uuid("陽光國小", "G1", "S01", "DCCS", 1)
    assert once == twice
    assert len(once) == 36  # 符合 varchar(36)
    # 同一 (學生,遊戲,施測日) 的單人與雙人 uuid 不同
    assert seed.make_uuid("陽光國小", "G1", "S01", "DCCS", 1, "double") != once


def test_round_b_beats_round_a_overall():
    # 整體淨進步:Round B(current_day 13..24)平均 accuracy 高於 Round A(1..12)。
    _, sessions, details = seed.generate()
    day_by_uuid = {row[S_UUID]: row[S_CURRENT_DAY] for row in sessions}

    a_vals, b_vals = [], []
    for rows in details.values():
        for row in rows:
            bucket = a_vals if day_by_uuid[row[3]] <= 12 else b_vals
            bucket.append(row[6])  # accuracy

    assert sum(b_vals) / len(b_vals) > sum(a_vals) / len(a_vals)


def test_daily_timeline_single_block_noon_double_block_afternoon():
    _, sessions, _ = seed.generate()
    for row in sessions:
        start, end = row[S_START], row[S_END]
        assert end > start        # 有時長
        if row[S_MODE] == "single":
            assert start.hour == 12   # 上午 12:00 開始
            assert end.hour < 13      # 整套單人版落在 13:00 前
        else:
            assert start.hour == 14   # 雙人版另一時段
            assert end.hour < 15


def test_play_days_are_mon_wed_fri_across_two_rounds():
    days = seed.build_play_days()
    assert len(days) == 24
    assert [d["current_day"] for d in days] == list(range(1, 25))
    assert all(d["date"].weekday() in (0, 2, 4) for d in days)  # 一/三/五
    assert {d["round"] for d in days} == {"A", "B"}
    assert all(d["date"].month == 1 for d in days if d["round"] == "A")
    assert all(d["date"].month == 3 for d in days if d["round"] == "B")
