"""手錶 Xsens DOT 專心判定的轉發端點。

手錶平台 https://xsensdotdata2server.zeabur.app 提供
GET /remote/predict/{subject_id}，回傳 {"result": 1 | 0, ...}。
該平台不提供 CORS 標頭，瀏覽器無法直接呼叫。此後端代為呼叫，前端只存取此後端。

手錶資料超過 24 小時時，固定回傳 0。
測試設為 WATCH_PREDICT_MOCK=1 時，不呼叫手錶平台，直接回傳 result=1。
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends

from models import AttentionResponse
from routers.identity import Identity, require_student

logger = logging.getLogger(__name__)

router = APIRouter(tags=["attention"])

_DEFAULT_WATCH_API_BASE = "https://xsensdotdata2server.zeabur.app"
_TIMEOUT_SECONDS = 5
_CASE_ID_PATTERN = re.compile(r"^([A-Za-z]+)(\d+)$")


def watch_subject_id(case_id: str | None) -> str | None:
    """將 S01 轉為 S001。格式不符時，回傳 None，視為查無資料。"""
    match = _CASE_ID_PATTERN.match((case_id or "").strip())
    if not match:
        return None
    prefix, number = match.groups()
    return f"{prefix.upper()}{int(number):03d}"


def _mock_enabled() -> bool:
    return (os.getenv("WATCH_PREDICT_MOCK") or "").strip().lower() in ("1", "true", "yes")


def _watch_api_base() -> str:
    return (os.getenv("WATCH_API_BASE") or _DEFAULT_WATCH_API_BASE).rstrip("/")


def fetch_watch_prediction(subject: str) -> dict:
    url = f"{_watch_api_base()}/remote/predict/{urllib.parse.quote(subject)}"
    with urllib.request.urlopen(url, timeout=_TIMEOUT_SECONDS) as response:
        return json.load(response)


@router.get("/api/attention/me", response_model=AttentionResponse)
def my_attention(identity: Identity = Depends(require_student)) -> AttentionResponse:
    """查詢目前登入學生的專心狀態。失敗時回傳 result=0，不阻止前端顯示。"""
    subject = watch_subject_id(identity.case_id)
    if _mock_enabled():
        return AttentionResponse(result=1, subject=subject, source="mock")
    if subject is None:
        return AttentionResponse(result=0, reason="學號格式無法對應手錶受試者")

    try:
        body = fetch_watch_prediction(subject)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        logger.warning("watch predict failed for %s: %s", subject, exc)
        return AttentionResponse(result=0, subject=subject, reason="手錶平台連線失敗")

    result = 1 if isinstance(body, dict) and body.get("result") == 1 else 0
    reason = body.get("reason") if isinstance(body, dict) else None
    source = body.get("source") if isinstance(body, dict) else None
    return AttentionResponse(
        result=result,
        subject=subject,
        reason=reason if isinstance(reason, str) else None,
        source=source if isinstance(source, str) else None,
    )
