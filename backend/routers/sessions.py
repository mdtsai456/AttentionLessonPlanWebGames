"""接收 Unity GameData 並建立遊戲場次。"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import pymysql
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, field_validator

import writes
from converters import normalize_game_type_for_db, to_float, to_int
from models import GameItem, GameListResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sessions"])

KNOWN_GAME_NAMES = frozenset({"DCCS", "DAT", "EFT", "IM", "TGame"})
# 廠商只做這三款的雙人版（Q4）。IM／TGame 若日後也要雙人版，放寬這裡即可。
DOUBLE_CAPABLE_GAMES = frozenset({"DCCS", "DAT", "EFT"})
PAIR_ID_MAX_LENGTH = 36
UNITY_CORE_STATS = (
    ("correct", "correct_count", to_int),
    ("wrong", "wrong_count", to_int),
    ("accuracy", "accuracy", to_float),
    ("duration", "duration", to_float),
    ("stage", "stage", to_int),
)


class UnityStat(BaseModel):
    model_config = ConfigDict(extra="ignore")

    apiname: str
    value: Any


class UnityGamePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    grade: str
    caseId: str
    school: str
    currentDay: int
    startTime: int
    endTime: int
    stats: list[UnityStat]
    mode: str = "single"
    pairId: str | None = None

    @field_validator("grade", "caseId", "school")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("不可為空白")
        return stripped

    @field_validator("mode")
    @classmethod
    def normalize_mode(cls, value: str) -> str:
        normalized = (value or "single").strip().lower()
        if normalized not in {"single", "double"}:
            raise ValueError("mode 必須是 single 或 double")
        return normalized


class UnityGameDataRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    lessonId: str
    data: UnityGamePayload


class SessionAcceptResponse(BaseModel):
    sessionId: str
    message: str = "已接收"


class InvalidTimestampError(ValueError):
    """Unity timestamp 無法轉成可寫入的 datetime。"""


def parse_game_name(lesson_id: str) -> str:
    stripped = lesson_id.strip()
    if not stripped:
        raise ValueError("lessonId 不可為空")
    if "_" not in stripped:
        return stripped
    return stripped.rsplit("_", 1)[-1]


def ms_to_datetime(ms: int) -> datetime:
    """將 Unix 毫秒轉成 MariaDB 使用的 UTC naive datetime。"""
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).replace(tzinfo=None)
    except (ValueError, OverflowError, OSError) as exc:
        raise InvalidTimestampError("時間戳記無效") from exc


def unity_core_stats(game_name: str, stats: list[UnityStat]) -> dict[str, Any]:
    by_name = {item.apiname: item.value for item in stats}
    result: dict[str, Any] = {}
    for suffix, column, cast in UNITY_CORE_STATS:
        key = f"{game_name}_{suffix}"
        if key not in by_name:
            raise ValueError(f"缺少必要統計：{key}")
        result[column] = cast(by_name[key])
    return result


def persist_unity_session(payload: UnityGameDataRequest) -> SessionAcceptResponse:
    game_name = parse_game_name(payload.lessonId)
    if game_name not in KNOWN_GAME_NAMES:
        raise ValueError(f"不支援的遊戲：{game_name}")

    db_game_type = normalize_game_type_for_db(game_name)
    if db_game_type is None:
        raise ValueError(f"不支援的遊戲：{game_name}")

    data = payload.data
    start_time = ms_to_datetime(data.startTime)
    end_time = ms_to_datetime(data.endTime)
    if end_time < start_time:
        raise ValueError("endTime 不可早於 startTime")

    mode = data.mode
    pair_id: str | None = data.pairId

    if mode == "double" and game_name not in DOUBLE_CAPABLE_GAMES:
        raise ValueError("雙人版僅支援 DAT／DCCS／EFT")

    if mode == "single":
        # 單人版忽略誤帶的 pairId，一律存 NULL。
        pair_id = None
    elif pair_id is not None and len(pair_id) > PAIR_ID_MAX_LENGTH:
        raise ValueError("pairId 格式錯誤")
    elif not pair_id:
        # 缺 pairId 的雙人筆仍是有效成績，只是少了搭檔連結 —— 接受，記一筆 warning。
        pair_id = None
        logger.warning("雙人版場次缺 pairId：school=%s grade=%s caseId=%s",
                       data.school, data.grade, data.caseId)

    session_id = writes.insert_session_with_stats(
        grade=data.grade,
        case_id=data.caseId,
        school=data.school,
        start_time=start_time,
        game_type=db_game_type,
        current_day=data.currentDay,
        end_time=end_time,
        stats=unity_core_stats(game_name, data.stats),
        mode=mode,
        pair_id=pair_id,
    )
    return SessionAcceptResponse(sessionId=session_id)


@router.post("/api/sessions", response_model=SessionAcceptResponse, status_code=201)
def create_session(payload: UnityGameDataRequest) -> SessionAcceptResponse:
    try:
        response = persist_unity_session(payload)
    except InvalidTimestampError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except pymysql.IntegrityError as exc:
        if exc.args and exc.args[0] == 1062:
            logger.exception("場次 UUID 重複")
            raise HTTPException(status_code=409, detail="場次已存在") from exc
        if exc.args and exc.args[0] == 1452:
            # student.school → school 的外鍵擋下：Unity 送來的場域字串沒登記。
            logger.warning("未知場域，拒絕寫入：school=%s", payload.data.school)
            raise HTTPException(
                status_code=400, detail="未知的場域（school 尚未登記）"
            ) from exc
        logger.exception("資料庫完整性檢查失敗")
        raise HTTPException(status_code=500, detail="資料庫寫入失敗") from exc
    except Exception as exc:
        logger.exception("資料庫寫入失敗")
        raise HTTPException(status_code=500, detail="資料庫寫入失敗") from exc

    logger.info("寫入 Unity 場次：sessionId=%s", response.sessionId)
    return response


@router.get("/api/games", response_model=GameListResponse)
def list_games() -> GameListResponse:
    """靜態遊戲清單，給遊戲大廳頁用。公開端點，不含任何學生資料。

    直接重用 KNOWN_GAME_NAMES / DOUBLE_CAPABLE_GAMES —— 前端不該自己另外寫死一份
    遊戲清單，重演 school 曾經在前端寫死、後端一改前端就跟著壞的教訓。
    """
    return GameListResponse(
        games=[
            GameItem(gameType=name, doubleCapable=name in DOUBLE_CAPABLE_GAMES)
            for name in sorted(KNOWN_GAME_NAMES)
        ]
    )
