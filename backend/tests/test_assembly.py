"""rows → models 的組裝邏輯。純函式，不碰資料庫。"""

from __future__ import annotations

from datetime import datetime

import pytest
from fastapi import HTTPException

from routers.students import (
    build_game_stats,
    build_play_records,
    build_summary_by_game,
    build_trends,
    parse_student_key,
    session_fields_from_row,
)


def _assessment_row(uuid: str = "u1", game_type: str = "DCCS") -> dict:
    return {
        "uuid": uuid,
        "game_type": game_type,
        "current_day": 1,
        "start_time": datetime(2026, 7, 1, 9, 0, 0),
        "end_time": datetime(2026, 7, 1, 9, 30, 0),
    }


def _stats_row(uuid: str = "u1", correct: int = 8, accuracy: float = 0.8) -> dict:
    return {
        "uuid": uuid,
        "correct_count": correct,
        "wrong_count": 2,
        "accuracy": accuracy,
        "duration": 1000.0,
        "stage": 10,
    }


def test_parse_student_key_splits_on_first_underscore():
    assert parse_student_key("G1_S03") == ("G1", "S03")


def test_parse_student_key_keeps_later_underscores_in_case_id():
    assert parse_student_key("G1_S0_3") == ("G1", "S0_3")


@pytest.mark.parametrize("given", ["G1", "_S03", "G1_", "", "_"])
def test_parse_student_key_rejects_malformed_input(given):
    with pytest.raises(HTTPException) as exc_info:
        parse_student_key(given)
    assert exc_info.value.status_code == 400


def test_session_fields_from_row_normalizes_tgame():
    fields = session_fields_from_row(_assessment_row(game_type="TGAME"))

    assert fields["gameType"] == "TGame"
    assert fields["startTime"] == "2026-07-01 09:00:00"
    assert fields["endTime"] == "2026-07-01 09:30:00"


def test_session_fields_from_row_of_unfinished_session_has_empty_end_time():
    row = _assessment_row()
    row["end_time"] = None

    assert session_fields_from_row(row)["endTime"] == ""


def test_build_game_stats_of_none_is_none():
    assert build_game_stats(None) is None


def test_build_game_stats_converts_null_columns_to_zero():
    stats = build_game_stats(
        {
            "correct_count": None,
            "wrong_count": None,
            "accuracy": None,
            "duration": None,
            "stage": None,
        }
    )

    assert stats.correctCount == 0
    assert stats.accuracy == 0.0
    assert stats.duration == 0.0


def test_build_play_records_attaches_matching_stats():
    records = build_play_records([_assessment_row()], {"u1": _stats_row()})

    assert records[0].stats.correctCount == 8


def test_build_play_records_leaves_stats_none_when_uuid_missing():
    records = build_play_records([_assessment_row()], {})

    assert records[0].stats is None


def test_build_summary_by_game_aggregates_and_rounds_average():
    """0.1 與 0.2 是刻意挑的：它們的平均是 0.15000000000000002，不等於 0.15。

    若改用 0.8 與 0.5，平均恰好是 0.65，這個測試就無法分辨 round(..., 2)
    存不存在 —— 拿掉那行照樣通過。
    """
    records = build_play_records(
        [_assessment_row("u1"), _assessment_row("u2")],
        {
            "u1": _stats_row("u1", correct=8, accuracy=0.1),
            "u2": _stats_row("u2", correct=4, accuracy=0.2),
        },
    )

    summaries = build_summary_by_game(records)

    assert len(summaries) == 1
    assert summaries[0].gameType == "DCCS"
    assert summaries[0].sessionCount == 2
    assert summaries[0].totalCorrect == 12
    assert summaries[0].totalWrong == 4
    assert summaries[0].avgAccuracy == 0.15
    assert summaries[0].totalDuration == 2000.0


def test_build_summary_by_game_of_records_without_stats_is_all_zero():
    records = build_play_records([_assessment_row()], {})

    summaries = build_summary_by_game(records)

    assert summaries[0].sessionCount == 1
    assert summaries[0].totalCorrect == 0
    assert summaries[0].avgAccuracy == 0.0


def test_build_summary_by_game_sorts_by_game_type():
    records = build_play_records(
        [_assessment_row("u1", "TGAME"), _assessment_row("u2", "DCCS")], {}
    )

    summaries = build_summary_by_game(records)

    assert [s.gameType for s in summaries] == ["DCCS", "TGame"]


def test_build_student_list_items_composes_student_key():
    from routers.students import build_student_list_items

    items = build_student_list_items(
        [
            {
                "grade": "G1",
                "case_id": "S03",
                "school": "測試場域",
                "session_count": 12,
                "last_played_at": datetime(2026, 7, 8, 14, 30, 0),
            }
        ]
    )

    assert items[0].studentKey == "G1_S03"
    assert items[0].grade == "G1"
    assert items[0].caseId == "S03"
    assert items[0].school == "測試場域"
    assert items[0].sessionCount == 12
    assert items[0].lastPlayedAt == "2026-07-08 14:30:00"


def test_build_student_list_items_of_zero_session_student_has_null_last_played():
    from routers.students import build_student_list_items

    items = build_student_list_items(
        [
            {
                "grade": "G1",
                "case_id": "S04",
                "school": "測試場域",
                "session_count": 0,
                "last_played_at": None,
            }
        ]
    )

    assert items[0].sessionCount == 0
    assert items[0].lastPlayedAt is None


def test_build_student_list_items_of_empty_rows_is_empty():
    from routers.students import build_student_list_items

    assert build_student_list_items([]) == []


def test_build_trends_groups_by_game_type_sorted():
    records = build_play_records(
        [_assessment_row("u1", "TGAME"), _assessment_row("u2", "DCCS")],
        {"u1": _stats_row("u1"), "u2": _stats_row("u2")},
    )

    trends = build_trends(records)

    assert [t.gameType for t in trends] == ["DCCS", "TGame"]


def test_build_trends_has_three_metric_items_in_fixed_order():
    records = build_play_records([_assessment_row()], {"u1": _stats_row()})

    trends = build_trends(records)

    assert [i.type for i in trends[0].items] == [
        "correctCount",
        "wrongCount",
        "accuracy",
    ]


def test_build_trends_orders_points_old_to_new():
    row_old = _assessment_row("old")
    row_old["start_time"] = datetime(2026, 7, 1, 9, 0, 0)
    row_new = _assessment_row("new")
    row_new["start_time"] = datetime(2026, 7, 8, 9, 0, 0)
    # 刻意把新的排在輸入的前面，證明是 build_trends 在升冪排序
    records = build_play_records(
        [row_new, row_old],
        {"new": _stats_row("new"), "old": _stats_row("old")},
    )

    times = [p.time for p in build_trends(records)[0].items[0].stats]

    assert times == ["2026-07-01 09:00:00", "2026-07-08 09:00:00"]


def test_build_trends_skips_records_without_stats():
    records = build_play_records(
        [_assessment_row("u1"), _assessment_row("u2")],
        {"u1": _stats_row("u1")},  # u2 無 stats
    )

    trends = build_trends(records)

    # 兩筆都是 DCCS，只有 u1 有 stats：每條序列只剩 1 個點
    assert len(trends[0].items[0].stats) == 1


def test_build_trends_pulls_correct_value_per_metric_and_preserves_types():
    records = build_play_records(
        [_assessment_row("u1")],
        {"u1": _stats_row("u1", correct=8, accuracy=0.8)},
    )

    items = {i.type: i for i in build_trends(records)[0].items}

    assert items["correctCount"].stats[0].value == 8
    assert isinstance(items["correctCount"].stats[0].value, int)
    assert items["accuracy"].stats[0].value == 0.8
    assert isinstance(items["accuracy"].stats[0].value, float)


def test_build_trends_of_empty_records_is_empty():
    assert build_trends([]) == []


def test_build_trends_of_records_all_without_stats_is_empty():
    records = build_play_records([_assessment_row()], {})

    assert build_trends(records) == []
