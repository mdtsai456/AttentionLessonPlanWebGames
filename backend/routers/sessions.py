"""接收 Unity GameData 並建立遊戲場次。"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid5

import pymysql
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, field_validator

import writes
from converters import normalize_game_type_for_db, to_float, to_int
from models import GameItem, GameListResponse
from routers.identity import Identity, get_current_identity, require_student

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sessions"])

KNOWN_GAME_NAMES = frozenset({"DCCS", "DAT", "EFT", "IM", "TGame"})
# 指令出擊沒有雙人模式。勇闖迷宮雙人模式可在第 3 關後返回選單，須寫入成績以顯示 50% 進度。
DOUBLE_CAPABLE_GAMES = frozenset({"DCCS", "DAT", "EFT", "TGame"})
PAIR_ID_MAX_LENGTH = 36
# 由 submissionId 推導場次 UUID 用的固定命名空間（uuid5）。改了它，已寫入的場次
# 重送時就推導不出同一個 UUID，會多寫一列 —— 不要改。
SUBMISSION_SESSION_NAMESPACE = UUID("6f1c2a4e-8b3d-4e5f-9a7b-1c2d3e4f5a6b")
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

    @field_validator("currentDay")
    @classmethod
    def current_day_in_range(cls, value: int) -> int:
        if value < 1 or value > 24:
            raise ValueError("第幾天必須是 1 到 24")
        return value

    startTime: int
    endTime: int
    stats: list[UnityStat]
    mode: str = "single"
    pairId: str | None = None
    # 前端為每筆成績產生一次的 UUID；逾時後重送同一筆時沿用。後端用「學生身分 +
    # submissionId」推導場次 UUID（見 submission_session_id），重複寫入撞主鍵就當作
    # 已收過（見 create_session）。沒帶就由後端產生。
    submissionId: str | None = None

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
    """Unity timestamp 無法轉為可寫入的 datetime。"""


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


def format_level_accuracy(value: Any) -> str | None:
    """將每關正確率轉為逗號分隔的 0–1 字串，最多包含六關。"""
    if value is None:
        return None
    if isinstance(value, str):
        parts = [part.strip() for part in value.split(",")]
    elif isinstance(value, (list, tuple)):
        parts = [str(part).strip() for part in value]
    else:
        parts = [str(value).strip()]

    numbers: list[str] = []
    for part in parts:
        if part == "":
            continue
        try:
            number = float(part)
        except (TypeError, ValueError) as exc:
            raise ValueError("levelAccuracy 必須是 0 到 1 的數字") from exc
        if number != number or number < 0 or number > 1:
            raise ValueError("levelAccuracy 必須是 0 到 1 的數字")
        numbers.append(f"{round(number, 4):.4f}")
    if not numbers:
        return None
    if len(numbers) > 6:
        raise ValueError("levelAccuracy 最多 6 關")
    return ",".join(numbers)


def optional_float(value: Any, name: str) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} 必須是數字") from exc
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{name} 必須是不小於 0 的數字")
    return number


def optional_ratio(value: Any) -> float | None:
    number = optional_float(value, "aimRatio")
    if number is not None and number > 1:
        raise ValueError("aimRatio 必須是 0 到 1")
    return number


def optional_count(value: Any) -> int | None:
    number = optional_float(value, "questionCount")
    if number is None:
        return None
    if not number.is_integer():
        raise ValueError("questionCount 必須是整數")
    return int(number)


def unity_core_stats(game_name: str, stats: list[UnityStat]) -> dict[str, Any]:
    by_name = {item.apiname: item.value for item in stats}
    result: dict[str, Any] = {}
    for suffix, column, cast in UNITY_CORE_STATS:
        key = f"{game_name}_{suffix}"
        if key not in by_name:
            raise ValueError(f"缺少必要統計：{key}")
        try:
            result[column] = cast(by_name[key])
        except ValueError as exc:
            raise ValueError(f"{key} 必須是數字") from exc
    level_key = f"{game_name}_levelAccuracy"
    if level_key in by_name:
        result["level_accuracy"] = format_level_accuracy(by_name[level_key])
    optional_fields = (
        ("avgReactionMs", "avg_reaction_ms", lambda value: optional_float(value, "avgReactionMs")),
        ("questionCount", "question_count", optional_count),
        ("aimRatio", "aim_ratio", optional_ratio),
        ("focusMs", "focus_ms", lambda value: optional_float(value, "focusMs")),
    )
    for suffix, column, cast in optional_fields:
        key = f"{game_name}_{suffix}"
        if key in by_name:
            result[column] = cast(by_name[key])
    return result


def normalize_submission_id(value: str | None) -> str | None:
    """submissionId 必須是 UUID；統一成小寫標準格式，重送時大小寫不同也認得出來。"""
    if value is None:
        return None
    try:
        return str(UUID(value.strip()))
    except (AttributeError, ValueError) as exc:
        raise ValueError("submissionId 格式錯誤") from exc


def submission_session_id(data: UnityGamePayload) -> str | None:
    """由學生身分與 submissionId 推導場次 UUID；沒帶 submissionId 回 None（由寫入層產生）。

    不直接拿 submissionId 當 uuid：assessment_result 主鍵是 (grade, case_id, school, uuid)，
    別的學生送同一個 submissionId 不會撞主鍵，會出現兩列同 uuid；而報表
    （queries.fetch_game_stats_by_uuids）把 uuid 當全域唯一，會配錯學生的成績。
    uuid5 是確定性的：同一位學生重送得到同一個 UUID（撞主鍵 → 冪等），
    不同學生得到不同 UUID。用 JSON 陣列編碼身分欄位，欄位內容含分隔符也不會混淆。
    """
    submission_id = normalize_submission_id(data.submissionId)
    if submission_id is None:
        return None
    name = json.dumps([data.grade, data.caseId, data.school, submission_id], ensure_ascii=False)
    return str(uuid5(SUBMISSION_SESSION_NAMESPACE, name))


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
        raise ValueError("雙人版僅支援 DAT／DCCS／EFT／TGame")

    if mode == "single":
        # 單人模式忽略傳入的 pairId，固定儲存為 NULL。
        pair_id = None
    elif pair_id is not None and len(pair_id) > PAIR_ID_MAX_LENGTH:
        raise ValueError("pairId 格式錯誤")
    elif not pair_id:
        # 雙人成績缺少 pairId 時，仍接受資料，但無法連結搭檔，並記錄一筆警告。
        pair_id = None
        logger.warning("雙人版場次缺 pairId：school=%s grade=%s caseId=%s",
                       data.school, data.grade, data.caseId)

    session_id = writes.insert_session_with_stats(
        session_id=submission_session_id(data),
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
def create_session(
    payload: UnityGameDataRequest,
    identity: Identity = Depends(require_student),
    x_partner_authorization: str | None = Header(default=None),
) -> SessionAcceptResponse:
    data = payload.data
    if (identity.grade, identity.case_id, identity.school) != (data.grade, data.caseId, data.school):
        raise HTTPException(status_code=403, detail="成績身分與登入學生不符")
    if data.mode == "double":
        partner = get_current_identity(x_partner_authorization)
        if partner.subject_type != "student":
            raise HTTPException(status_code=403, detail="搭檔必須是學生")
    try:
        response = persist_unity_session(payload)
    except InvalidTimestampError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except pymysql.IntegrityError as exc:
        if exc.args and exc.args[0] == 1062 and data.submissionId is not None:
            # 場次 UUID 由學生身分 + submissionId 推導，撞到的一定是這位學生先前已寫入的
            # 同一筆（例如上次回應逾時）。
            session_id = submission_session_id(data)
            logger.info("重送的場次已存在，視為已接收：sessionId=%s", session_id)
            return SessionAcceptResponse(sessionId=session_id)
        if exc.args and exc.args[0] == 1062:
            logger.exception("場次 UUID 重複")
            raise HTTPException(status_code=409, detail="場次已存在") from exc
        if exc.args and exc.args[0] == 1452:
            # Unity 傳入的場域未登記，student.school 指向 school 的外鍵因此拒絕寫入。
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
    """遊戲大廳使用的靜態遊戲清單。公開端點，不包含學生資料。

    使用 KNOWN_GAME_NAMES／DOUBLE_CAPABLE_GAMES 作為來源。
    前端使用此清單，避免重複設定而與後端不同步。
    """
    return GameListResponse(
        games=[
            GameItem(gameType=name, doubleCapable=name in DOUBLE_CAPABLE_GAMES)
            for name in sorted(KNOWN_GAME_NAMES)
        ]
    )
