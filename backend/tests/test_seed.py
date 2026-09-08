"""seed.py 的純邏輯測試,完全不碰資料庫。

只斷言產生資料的不變式,讓日後調整 seed 常數時若弄壞這些性質會立刻亮紅。
tuple 欄位順序沿用 seed.generate():
  session: (grade, case_id, school, uuid, start_time, game_type, current_day, end_time)
  detail : (grade, case_id, school, uuid, correct, wrong, accuracy, duration, stage)
"""

import seed


def test_generate_is_deterministic():
    # 固定 seed → 兩次產生完全相同,重灌才會可重現。
    assert seed.generate() == seed.generate()


def test_row_counts():
    students, sessions, details = seed.generate()
    n_students = len(seed.SCHOOLS) * len(seed.STUDENTS)
    n_sessions = n_students * len(seed.GAMES) * 24  # 24 個施測日

    assert n_students == 18
    assert len(students) == n_students
    assert len(sessions) == n_sessions == 2160
    assert sum(len(rows) for rows in details.values()) == n_sessions
    for rows in details.values():           # 每張明細表場次相同(18*24)
        assert len(rows) == n_students * 24 == 432


def test_game_type_keys_match_result_tables():
    # game_type 必須精確對上 queries 的白名單鍵,含全大寫 TGAME,否則 report 查不到 stats。
    from queries import GAME_RESULT_TABLES

    _, sessions, _ = seed.generate()
    game_types = {row[5] for row in sessions}
    assert game_types == set(seed.GAMES)
    assert game_types <= set(GAME_RESULT_TABLES)
    assert "TGAME" in game_types


def test_current_day_covers_1_to_24():
    _, sessions, _ = seed.generate()
    assert {row[6] for row in sessions} == set(range(1, 25))


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
    uuids = [row[3] for row in sessions]
    assert len(set(uuids)) == len(uuids)  # 全域唯一

    once = seed.make_uuid("陽光國小", "G1", "S01", "DCCS", 1)
    twice = seed.make_uuid("陽光國小", "G1", "S01", "DCCS", 1)
    assert once == twice
    assert len(once) == 36  # 符合 varchar(36)


def test_round_b_beats_round_a_overall():
    # 整體淨進步:Round B(current_day 13..24)平均 accuracy 高於 Round A(1..12)。
    _, sessions, details = seed.generate()
    day_by_uuid = {row[3]: row[6] for row in sessions}

    a_vals, b_vals = [], []
    for rows in details.values():
        for row in rows:
            bucket = a_vals if day_by_uuid[row[3]] <= 12 else b_vals
            bucket.append(row[6])  # accuracy

    assert sum(b_vals) / len(b_vals) > sum(a_vals) / len(a_vals)


def test_daily_timeline_starts_noon_and_ends_before_one():
    _, sessions, _ = seed.generate()
    for row in sessions:
        start, end = row[4], row[7]
        assert start.hour == 12   # 每天中午 12:00 開始
        assert end > start        # 有時長
        assert end.hour < 13      # 整套落在 13:00 前


def test_play_days_are_mon_wed_fri_across_two_rounds():
    days = seed.build_play_days()
    assert len(days) == 24
    assert [d["current_day"] for d in days] == list(range(1, 25))
    assert all(d["date"].weekday() in (0, 2, 4) for d in days)  # 一/三/五
    assert {d["round"] for d in days} == {"A", "B"}
    assert all(d["date"].month == 1 for d in days if d["round"] == "A")
    assert all(d["date"].month == 3 for d in days if d["round"] == "B")
