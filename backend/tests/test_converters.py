"""converters 的純函式測試。不碰資料庫。"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from converters import (
    format_datetime,
    format_optional_datetime,
    normalize_game_type_for_db,
    normalize_game_type_from_db,
    normalize_mode_for_db,
    normalize_school,
    to_float,
    to_int,
)


def test_format_datetime_of_none_is_empty_string():
    """既有行為，新端點不使用這個函式處理可空的日期。"""
    assert format_datetime(None) == ""


def test_format_datetime_uses_space_separator_and_second_precision():
    assert format_datetime(datetime(2026, 7, 1, 9, 0, 0)) == "2026-07-01 09:00:00"


def test_format_datetime_drops_microseconds():
    assert format_datetime(datetime(2026, 7, 1, 9, 0, 0, 123456)) == "2026-07-01 09:00:00"


def test_format_datetime_of_string_passes_through():
    assert format_datetime("2026-07-01") == "2026-07-01"


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("TGame", "TGAME"),
        ("TGAME", "TGAME"),
        ("dccs", "DCCS"),
        ("  DAT  ", "DAT"),
        (None, None),
        ("", None),
        ("   ", None),
    ],
)
def test_normalize_game_type_for_db(given, expected):
    assert normalize_game_type_for_db(given) == expected


def test_normalize_game_type_from_db_maps_tgame_back():
    assert normalize_game_type_from_db("TGAME") == "TGame"


def test_normalize_game_type_from_db_passes_others_through():
    assert normalize_game_type_from_db("DCCS") == "DCCS"


def test_to_int_of_none_is_zero():
    assert to_int(None) == 0


def test_to_int_converts():
    assert to_int("7") == 7


def test_to_float_of_none_is_zero():
    assert to_float(None) == 0.0


def test_to_float_converts():
    assert to_float(3) == 3.0


@pytest.mark.parametrize(
    "value", ["nan", "Infinity", "-inf", float("nan"), float("inf"), pytest.param(10**400, id="10**400"), [1], {"a": 1}, object()]
)
def test_to_int_and_to_float_reject_non_finite_or_non_numeric(value):
    """非有限數字與非數字型別一律 ValueError（API 層對應 400），不可拋 TypeError／OverflowError。"""
    with pytest.raises(ValueError):
        to_float(value)
    if not isinstance(value, int):
        with pytest.raises(ValueError):
            to_int(value)


def test_to_int_and_to_float_still_accept_db_numeric_types():
    """students.py 讀 DB 欄位也用這兩個函式：Decimal、負數照常轉換。"""
    assert to_int(Decimal("5")) == 5
    assert to_float(Decimal("0.83")) == 0.83
    assert to_float(-1) == -1.0
    assert to_int(7.9) == 7


def test_format_optional_datetime_of_none_is_none():
    """與 format_datetime 不同：不假裝有值。"""
    assert format_optional_datetime(None) is None


def test_format_optional_datetime_formats_like_format_datetime():
    assert format_optional_datetime(datetime(2026, 7, 8, 14, 30, 0)) == "2026-07-08 14:30:00"


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("測試場域", "測試場域"),
        ("  測試場域  ", "測試場域"),
        ("", None),
        ("   ", None),
        (None, None),
    ],
)
def test_normalize_school(given, expected):
    assert normalize_school(given) == expected


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        (None, None),
        ("", None),
        ("   ", None),
        ("Single", "single"),
        ("DOUBLE", "double"),
        ("  double  ", "double"),
        ("foo", "foo"),  # 打錯的值原樣傳回，讓 SQL 查空、不報錯
    ],
)
def test_normalize_mode_for_db(given, expected):
    assert normalize_mode_for_db(given) == expected
