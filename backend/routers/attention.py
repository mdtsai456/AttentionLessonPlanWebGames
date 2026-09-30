"""手錶（Xsens DOT）專心判定的轉發端點。

手錶平台 https://xsensdotdata2server.zeabur.app 提供
`GET /remote/predict/{subject_id}`，回 `{"result": 1 | 0, ...}`。該服務沒有送 CORS
標頭，瀏覽器無法直接呼叫，所以由這裡代打，前端只打同一個後端。

測試：手錶端資料超過 24 小時一律回 0，沒辦法測到 1。設 WATCH_PREDICT_MOCK=1
時不呼叫手錶平台，直接回 result=1。
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
    """S01 → S001。格式不符時回 None（當成找不到資料）。"""
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
    """目前登入學生是否專心。任何失敗都回 result=0，不讓前端因此卡住。"""
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
