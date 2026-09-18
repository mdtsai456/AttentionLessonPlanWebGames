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


# --- 參照資料：場域／老師名錄（選單式登入） ---


class SchoolItem(BaseModel):
    school: str  # 場域識別字串，等同 student.school；前端後續呼叫要原樣帶回
    displayName: str  # 下拉顯示文字，可與 school 相同


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
    studentCount: int  # 等同 students 長度，Python 端計算
    students: list[StudentListItem] = Field(default_factory=list)


class GameItem(BaseModel):
    gameType: str
    doubleCapable: bool


class GameListResponse(BaseModel):
    games: list[GameItem] = Field(default_factory=list)


# --- 帳密登入（見 docs/adr/0004-teacher-student-password-login.md） ---


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


class StudentLoginResponse(BaseModel):
    token: str
    studentKey: str
    grade: str
    caseId: str
    school: str
