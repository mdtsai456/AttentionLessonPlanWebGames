"""學生相關的 API 路由，以及 rows → models 的組裝函式。"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query

import queries
from converters import (
    format_datetime,
    format_optional_datetime,
    normalize_game_type_for_db,
    normalize_game_type_from_db,
    normalize_school,
    to_float,
    to_int,
)
from models import (
    GameStats,
    GameSummary,
    GameTrend,
    PlayRecord,
    SessionItem,
    SessionsResponse,
    StudentListItem,
    StudentListResponse,
    StudentReportResponse,
    TrendItem,
    TrendPoint,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["students"])


# --- 工具函式 ---


def db_error(exc: Exception) -> HTTPException:
    """回給呼叫端一句通用訊息，完整例外寫進 server log。

    PyMySQL 的例外訊息可能包含表名、欄位名，連線失敗時甚至包含主機位址與
    使用者名稱。這個 API 部署在公開網路上，那些資訊不該出現在 HTTP 回應裡。
    """
    logger.exception("資料庫查詢失敗")
    return HTTPException(status_code=500, detail="資料庫查詢失敗")


def parse_student_key(student_key: str) -> tuple[str, str]:
    """G1_S03 → (G1, S03)"""
    parts = student_key.strip().split("_", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise HTTPException(
            status_code=400,
            detail="studentKey 格式應為 G1_S03（grade_caseId）",
        )
    return parts[0], parts[1]


def session_fields_from_row(row: dict[str, Any]) -> dict[str, Any]:
    """從 assessment_result 列取出場次共用欄位。"""
    return {
        "sessionId": row["uuid"],
        "gameType": normalize_game_type_from_db(row["game_type"]),
        "currentDay": to_int(row["current_day"]),
        "startTime": format_datetime(row["start_time"]),
        "endTime": format_datetime(row["end_time"]),
    }


def build_game_stats(row: dict[str, Any] | None) -> GameStats | None:
    """從遊戲細部表列取出遊戲統計欄位。"""
    if row is None:
        return None
    return GameStats(
        correctCount=to_int(row["correct_count"]),
        wrongCount=to_int(row["wrong_count"]),
        accuracy=to_float(row["accuracy"]),
        duration=to_float(row["duration"]),
        stage=to_int(row["stage"]),
    )


# --- report 組裝（純函式） ---


def build_play_records(
    rows: list[dict[str, Any]],
    stats_by_uuid: dict[str, dict[str, Any]],
) -> list[PlayRecord]:
    """合併場次索引與各遊戲細部統計。"""
    return [
        PlayRecord(
            **session_fields_from_row(row),
            stats=build_game_stats(stats_by_uuid.get(row["uuid"])),
        )
        for row in rows
    ]


def build_summary_by_game(records: list[PlayRecord]) -> list[GameSummary]:
    """依遊戲種類彙總多場次統計。"""
    grouped: dict[str, list[PlayRecord]] = {}
    for record in records:
        grouped.setdefault(record.gameType, []).append(record)

    summaries: list[GameSummary] = []
    for game_type, game_records in grouped.items():
        stats_list = [r.stats for r in game_records if r.stats is not None]
        if not stats_list:
            summaries.append(
                GameSummary(
                    gameType=game_type,
                    sessionCount=len(game_records),
                    totalCorrect=0,
                    totalWrong=0,
                    avgAccuracy=0.0,
                    totalDuration=0.0,
                )
            )
            continue

        summaries.append(
            GameSummary(
                gameType=game_type,
                sessionCount=len(game_records),
                totalCorrect=sum(s.correctCount for s in stats_list),
                totalWrong=sum(s.wrongCount for s in stats_list),
                avgAccuracy=round(
                    sum(s.accuracy for s in stats_list) / len(stats_list), 2
                ),
                totalDuration=sum(s.duration for s in stats_list),
            )
        )

    summaries.sort(key=lambda item: item.gameType)
    return summaries


TREND_METRICS = ("correctCount", "wrongCount", "accuracy")  # 固定順序


def build_trends(records: list[PlayRecord]) -> list[GameTrend]:
    """把 records 依 gameType × 指標 pivot 成時間序列。純函式。

    stats 為 None 的場次沒有數值可畫，整筆略過。gameType 依字母排序，
    每條序列由舊到新（startTime 為 YYYY-MM-DD HH:MM:SS，字典序即時間序）。
    """
    grouped: dict[str, list[PlayRecord]] = {}
    for record in records:
        if record.stats is None:
            continue
        grouped.setdefault(record.gameType, []).append(record)

    trends: list[GameTrend] = []
    for game_type in sorted(grouped):
        ordered = sorted(grouped[game_type], key=lambda r: r.startTime)
        items = [
            TrendItem(
                type=metric,
                stats=[
                    TrendPoint(time=r.startTime, value=getattr(r.stats, metric))
                    for r in ordered
                ],
            )
            for metric in TREND_METRICS
        ]
        trends.append(GameTrend(gameType=game_type, items=items))
    return trends


def build_student_list_items(rows: list[dict[str, Any]]) -> list[StudentListItem]:
    """把 fetch_students 的列組成回應項目。純函式。"""
    return [
        StudentListItem(
            studentKey=f"{row['grade']}_{row['case_id']}",
            grade=row["grade"],
            caseId=row["case_id"],
            school=row["school"],
            sessionCount=to_int(row["session_count"]),
            lastPlayedAt=format_optional_datetime(row["last_played_at"]),
        )
        for row in rows
    ]


# --- API 路由 ---


@router.get("/api/students", response_model=StudentListResponse)
def list_students(
    school: str | None = Query(
        default=None, description="可選，場域／學校，例如：測試場域。不給則回傳所有場域"
    ),
) -> StudentListResponse:
    normalized_school = normalize_school(school)

    try:
        rows = queries.fetch_students(normalized_school)
    except Exception as exc:
        raise db_error(exc) from exc

    items = build_student_list_items(rows)

    return StudentListResponse(
        school=normalized_school,
        studentCount=len(items),
        students=items,
    )


@router.get("/api/students/{student_key}/sessions", response_model=SessionsResponse)
def list_student_sessions(
    student_key: str,
    school: str = Query(..., description="場域／學校，例如：測試場域"),
    game_type: str | None = Query(
        default=None, description="可選，例如 DAT、EFT、TGame"
    ),
) -> SessionsResponse:
    grade, case_id = parse_student_key(student_key)

    try:
        rows = queries.fetch_assessment_rows(
            grade, case_id, school, normalize_game_type_for_db(game_type)
        )
    except Exception as exc:
        raise db_error(exc) from exc

    return SessionsResponse(
        studentKey=student_key,
        grade=grade,
        caseId=case_id,
        school=school,
        sessions=[SessionItem(**session_fields_from_row(row)) for row in rows],
    )


@router.get("/api/students/{student_key}/report", response_model=StudentReportResponse)
def get_student_report(
    student_key: str,
    school: str = Query(..., description="場域／學校，例如：測試場域"),
    game_type: str | None = Query(default=None, description="可選，例如 DCCS"),
) -> StudentReportResponse:
    grade, case_id = parse_student_key(student_key)

    try:
        rows = queries.fetch_assessment_rows(
            grade, case_id, school, normalize_game_type_for_db(game_type)
        )
        records = build_play_records(rows, queries.fetch_stats_for_rows(rows))
    except Exception as exc:
        raise db_error(exc) from exc

    return StudentReportResponse(
        studentKey=student_key,
        grade=grade,
        caseId=case_id,
        school=school,
        totalSessions=len(records),
        records=records,
        summaryByGame=build_summary_by_game(records),
        trends=build_trends(records),
    )
