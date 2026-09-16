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


def normalize_mode_for_db(mode: str | None) -> str | None:
    """把查詢用的 ?mode= 參數正規化成 DB 值。

    鏡像 normalize_game_type_for_db 的角色：None／空白 → None（不加篩選條件）。
    其他值一律 strip().lower() 後原樣傳回 —— 打錯的值（如 "foo"）會讓 SQL
    查不到任何列、回空結果，不報錯，與 ?game_type=亂打 的既有行為一致。
    """
    if not mode or not mode.strip():
        return None
    return mode.strip().lower()


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
