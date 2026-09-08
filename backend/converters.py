"""純轉換工具。不依賴 FastAPI，也不碰資料庫。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

# Unity 的 TGame 在 DB 存為 TGAME
GAME_TYPE_TO_DB = {"TGame": "TGAME", "TGAME": "TGAME"}
GAME_TYPE_FROM_DB = {"TGAME": "TGame"}


def normalize_game_type_for_db(game_type: str | None) -> str | None:
    if not game_type or not game_type.strip():
        return None

    normalized = game_type.strip()
    return GAME_TYPE_TO_DB.get(normalized, normalized.upper())


def normalize_game_type_from_db(game_type: str) -> str:
    return GAME_TYPE_FROM_DB.get(game_type, game_type)


def format_datetime(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    return str(value)


def to_int(value: Any) -> int:
    return 0 if value is None else int(value)


def to_float(value: Any) -> float:
    return 0.0 if value is None else float(value)


def format_optional_datetime(value: Any) -> str | None:
    """給可為空的日期欄位使用。

    與 format_datetime 不同：None 就回傳 None，不回傳空字串。
    空字串會假裝有值，讓呼叫端無法乾淨地判斷「沒有這個時間點」。
    """
    if value is None:
        return None
    return format_datetime(value)


def normalize_school(school: str | None) -> str | None:
    """空字串或全為空白的 school 視同未提供。

    沒有人會想查詢「場域名稱是空字串的學生」，把它當成篩選條件只會
    回傳一個對使用者毫無幫助的空名單。
    """
    if school is None:
        return None
    return school.strip() or None
