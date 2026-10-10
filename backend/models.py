"""所有 API 回應模型。"""

from __future__ import annotations

from datetime import datetime

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
    levelAccuracy: list[float] | None = None  # 第 1 關起，每一關的正確率（0–1）
    avgReactionMs: float | None = None
    questionCount: int | None = None  # 指令出擊不送出此欄位。
    aimRatio: float | None = None  # 瓢蟲追擊令：準心瞄準時間 ÷ 有效遊戲時間。
    focusMs: float | None = None  # 瓢蟲追擊令：準心與目標重疊的累計時間。


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
    type: str  # 指標識別名稱：correctCount／wrongCount／accuracy。
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
    school: str  # 此欄位是主鍵的一部分。不同場域的 G1_S03 代表不同學生。
    sessionCount: int  # 含未完成的場次
    lastPlayedAt: str | None = None  # MAX(start_time)；零場次為 None


class StudentListResponse(BaseModel):
    school: str | None = None  # 回顯查詢參數；未指定時為 None
    studentCount: int
    students: list[StudentListItem] = Field(default_factory=list)


# 參照資料：場域與老師名錄，用於選單式登入。


class SchoolItem(BaseModel):
    school: str  # 場域識別字串，等同 student.school。前端後續請求須傳回相同值。
    displayName: str  # 下拉選單的顯示文字，可與 school 相同。


class SchoolListResponse(BaseModel):
    schools: list[SchoolItem] = Field(default_factory=list)


class TeacherItem(BaseModel):
    teacherId: int
    name: str


class TeacherListResponse(BaseModel):
    school: str  # 回顯路徑參數
    teachers: list[TeacherItem] = Field(default_factory=list)


class TeacherStudentsResponse(BaseModel):
    teacherId: int
    teacherName: str
    school: str
    studentCount: int  # 由 Python 計算，等於 students 的長度。
    students: list[StudentListItem] = Field(default_factory=list)


class GameItem(BaseModel):
    gameType: str
    doubleCapable: bool


class GameListResponse(BaseModel):
    games: list[GameItem] = Field(default_factory=list)


# 帳號與密碼登入，見 docs/adr/0004-teacher-student-password-login.md。


class TeacherLoginRequest(BaseModel):
    account: str
    password: str


class StudentLoginRequest(BaseModel):
    account: str
    password: str


class TeacherLoginResponse(BaseModel):
    token: str
    teacherId: int
    teacherName: str
    school: str
    expiresAt: datetime


class StudentLoginResponse(BaseModel):
    token: str
    studentKey: str
    grade: str
    caseId: str
    school: str
    expiresAt: datetime


class AttentionResponse(BaseModel):
    result: int  # 1 = 專心；0 = 不專心／資料過期／找不到
    subject: str | None = None  # 傳給手錶平台的受試者編號，例如 S001。
    reason: str | None = None
    source: str | None = None  # "mock" 表示 WATCH_PREDICT_MOCK 提供的模擬資料。
