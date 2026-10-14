"""純轉換工具，不依賴 FastAPI，也不存取資料庫。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

# Unity 的 TGame 在資料庫中儲存為 TGAME。
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
    """將查詢參數 ?mode= 正規化為資料庫值。

    與 normalize_game_type_for_db 相同，None 或空白值回傳 None，不加入篩選條件。
    其他值執行 strip().lower() 後回傳。無效值如 "foo" 會使 SQL 回傳空結果，不拋出錯誤。
    此行為與 ?game_type= 的既有處理相同。
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
    """格式化可為空的日期欄位。

    輸入為 None 時，回傳 None，讓呼叫端識別日期不存在。format_datetime 則回傳空字串。
    """
    if value is None:
        return None
    return format_datetime(value)


def normalize_school(school: str | None) -> str | None:
    """school 為空字串或只有空白時，視為未提供，不加入場域篩選條件。"""
    if school is None:
        return None
    return school.strip() or None
