"""同帳號雙分頁玩同一款遊戲的鎖定。見 docs/adr/0006-game-lock.md。

跟 docs/adr/0005-block-duplicate-login.md（擋重複登入）是兩個獨立問題：
那邊擋的是「兩次登入」產生兩個 token；這裡擋的是同一個 token 被兩個分頁
（例如「重複分頁」沿用同一份 sessionStorage）拿去各自進入同一款遊戲。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import writes
from errors import db_error
from routers.identity import Identity, require_student
from routers.sessions import KNOWN_GAME_NAMES

router = APIRouter(tags=["game-lock"])

# 持有者超過這段時間沒送心跳，視為分頁已關閉或當掉，鎖可以換人。
HEARTBEAT_TIMEOUT = timedelta(seconds=30)


def _already_in_progress() -> HTTPException:
    return HTTPException(status_code=409, detail="此遊戲已在另一個分頁進行中")


def _lock_lost() -> HTTPException:
    return HTTPException(status_code=409, detail="已在另一個分頁繼續這款遊戲")


def _unsupported_game() -> HTTPException:
    return HTTPException(status_code=400, detail="不支援的遊戲類型")


class GameLockRequest(BaseModel):
    gameId: str


class GameLockActionRequest(GameLockRequest):
    lockId: str


class GameLockResponse(BaseModel):
    lockId: str


@router.post("/api/game-lock/acquire", response_model=GameLockResponse)
def acquire(
    payload: GameLockRequest, identity: Identity = Depends(require_student)
) -> GameLockResponse:
    if payload.gameId not in KNOWN_GAME_NAMES:
        raise _unsupported_game()

    lock_id = token_urlsafe(16)
    now = datetime.now(timezone.utc)
    try:
        acquired = writes.acquire_game_lock(
            identity.grade,
            identity.case_id,
            identity.school,
            payload.gameId,
            lock_id,
            now,
            now - HEARTBEAT_TIMEOUT,
        )
    except Exception as exc:
        raise db_error(exc) from exc

    if not acquired:
        raise _already_in_progress()
    return GameLockResponse(lockId=lock_id)


@router.post("/api/game-lock/heartbeat", status_code=204)
def heartbeat(
    payload: GameLockActionRequest, identity: Identity = Depends(require_student)
) -> None:
    if payload.gameId not in KNOWN_GAME_NAMES:
        raise _unsupported_game()

    try:
        refreshed = writes.heartbeat_game_lock(
            identity.grade,
            identity.case_id,
            identity.school,
            payload.gameId,
            payload.lockId,
            datetime.now(timezone.utc),
        )
    except Exception as exc:
        raise db_error(exc) from exc

    if not refreshed:
        raise _lock_lost()


@router.post("/api/game-lock/release", status_code=204)
def release(
    payload: GameLockActionRequest, identity: Identity = Depends(require_student)
) -> None:
    if payload.gameId not in KNOWN_GAME_NAMES:
        raise _unsupported_game()

    try:
        writes.release_game_lock(
            identity.grade,
            identity.case_id,
            identity.school,
            payload.gameId,
            payload.lockId,
        )
    except Exception as exc:
        raise db_error(exc) from exc
