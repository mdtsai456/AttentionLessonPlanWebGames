"""所有 API 回應模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class SessionItem(BaseModel):
    sessionId: str
    gameType: str
    mode: str  # "single" | "double"；取自 assessment_result.mode
    currentDay: int
    startTime: str
    endTime: str


class SessionsResponse(BaseModel):
    studentKey: str
    grade: str
    caseId: str
    school: str
    sessions: list[SessionItem] = Field(default_factory=list)


class GameStats(BaseModel):
    correctCount: int
    wrongCount: int
    accuracy: float
    duration: float  # 毫秒
    stage: int  # 本場實際作答題數／關卡數


class PlayRecord(SessionItem):
    stats: GameStats | None = None


class GameSummary(BaseModel):
    gameType: str
    mode: str  # 該彙總列的模式；(gameType, mode) 為分組鍵
    sessionCount: int
    totalCorrect: int
    totalWrong: int
    avgAccuracy: float
    totalDuration: float


class TrendPoint(BaseModel):
    time: str
    value: int | float  # 計數保持 int，accuracy 保持 float


class TrendItem(BaseModel):
    type: str  # 機器鍵：correctCount / wrongCount / accuracy
    stats: list[TrendPoint] = Field(default_factory=list)


class GameTrend(BaseModel):
    gameType: str
    mode: str  # 該趨勢群的模式
    items: list[TrendItem] = Field(default_factory=list)


class StudentReportResponse(BaseModel):
    studentKey: str
    grade: str
    caseId: str
    school: str
    totalSessions: int
    records: list[PlayRecord] = Field(default_factory=list)
    summaryByGame: list[GameSummary] = Field(default_factory=list)
    trends: list[GameTrend] = Field(default_factory=list)


class StudentListItem(BaseModel):
    studentKey: str
    grade: str
    caseId: str
    school: str  # 主鍵的一部分：不同場域的 G1_S03 是不同的學生
    sessionCount: int  # 含未完成的場次
    lastPlayedAt: str | None = None  # MAX(start_time)；零場次為 None


class StudentListResponse(BaseModel):
    school: str | None = None  # 回顯查詢參數；未指定時為 None
    studentCount: int
    students: list[StudentListItem] = Field(default_factory=list)
