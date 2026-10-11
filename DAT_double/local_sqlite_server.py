"""DAT_double 本地獨立 SQLite 後端（只供本機開發）。

用法見 DAT_double/README.md 的「本地 SQLite 後端」。遊戲頁從 /app/ 開啟時，
shared/api.js 與 shared/require-student.js 會把 API 指向同一個來源的 /api，
所以成績會送到這台伺服器，不會送到 5001 的正式開發後端。
登入與身分查詢（/api/auth/* 等其他 /api 路徑）轉送到 DAT_LOCAL_UPSTREAM（預設 5001 的開發後端）。
"""
import json
import os
import sqlite3
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import List, Optional, Union
from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, field_validator

app = FastAPI(title="DAT_double 本地獨立 SQLite 後端", version="1.0.0")

# 設定 CORS 跨網域放行
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 自動定位當前檔案所在的 DAT_double 目錄，並在該目錄生成 local_test.db
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.environ.get("DAT_LOCAL_DB") or os.path.join(CURRENT_DIR, "local_test.db")
REPO_ROOT = Path(CURRENT_DIR).parent.resolve()
PORT = int(os.environ.get("DAT_LOCAL_PORT", "5002"))
UPSTREAM = os.environ.get("DAT_LOCAL_UPSTREAM", "http://127.0.0.1:5001").rstrip("/")

# 1. 初始化建立 SQLite 本地資料庫表格
def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # 建立場次紀錄主表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS assessment_result (
        session_id TEXT PRIMARY KEY,
        lesson_id TEXT,
        grade TEXT,
        case_id TEXT,
        school TEXT,
        current_day INTEGER,
        start_time INTEGER,
        end_time INTEGER,
        mode TEXT,
        pair_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)
    
    # 建立統計指標明細表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS session_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        apiname TEXT,
        value REAL,
        FOREIGN KEY(session_id) REFERENCES assessment_result(session_id)
    )
    """)
    
    conn.commit()
    conn.close()

init_db()

# 2. Pydantic 數據模型驗證
class StatItem(BaseModel):
    apiname: str
    # DAT_levelAccuracy 是逗號分隔字串（例如 "1,0.5,0.75"），其餘為數值
    value: Union[float, str]

class SessionData(BaseModel):
    grade: str
    caseId: str
    school: str
    currentDay: int
    startTime: int
    endTime: int
    mode: Optional[str] = "double"
    pairId: Optional[str] = None
    # 遊戲為每筆成績產生一次的 UUID；結果不明時重送沿用（#42）。
    submissionId: Optional[str] = None
    stats: List[StatItem]

    @field_validator("submissionId")
    @classmethod
    def normalize_submission_id(cls, value: Optional[str]) -> Optional[str]:
        # 統一成小寫標準格式，重送時大小寫不同也認得出來
        if value is None:
            return None
        return str(uuid.UUID(value.strip()))

class SessionPayload(BaseModel):
    lessonId: str
    data: SessionData

# ----------------------------------------------------
# 3. API 路由接口
# ----------------------------------------------------

# 首頁路由：恢復原本 API 狀態 JSON 訊息（不會強行開啟 DAT_double.html）
@app.get("/")
def root() -> dict[str, str]:
    return {
        "status": "ok",
        "message": "DAT_double API is running",
        "docs": "/docs",
        "health": "/health",
        "game": "/app/DAT_double/DAT_double.html",
    }

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

# 與正式後端（backend/routers/sessions.py）相同的推導方式：學生身分 + submissionId → 場次 UUID。
# 同一位學生重送同一筆得到同一個 UUID，不會多寫一列；不同學生不會撞在一起。
SUBMISSION_SESSION_NAMESPACE = uuid.UUID("6f1c2a4e-8b3d-4e5f-9a7b-1c2d3e4f5a6b")


def submission_session_id(d: "SessionData") -> Optional[str]:
    if d.submissionId is None:
        return None
    name = json.dumps([d.grade, d.caseId, d.school, d.submissionId], ensure_ascii=False)
    return str(uuid.uuid5(SUBMISSION_SESSION_NAMESPACE, name))


# POST /api/sessions: 接收遊戲數據寫入本地 local_test.db
@app.post("/api/sessions", status_code=status.HTTP_201_CREATED)
def create_session(payload: SessionPayload):
    d = payload.data
    session_id = submission_session_id(d) or str(uuid.uuid4())
    
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        if d.submissionId is not None and cursor.execute(
            "SELECT 1 FROM assessment_result WHERE session_id = ?", (session_id,)
        ).fetchone():
            # 上次回應逾時、遊戲重送同一筆：已收過，回同一個 sessionId
            conn.close()
            print(f"ℹ️ [DAT_double/local_test.db] 重送的場次已存在: {session_id}")
            return {"sessionId": session_id, "message": "這筆成績已經寫入過"}
        
        cursor.execute("""
        INSERT INTO assessment_result 
        (session_id, lesson_id, grade, case_id, school, current_day, start_time, end_time, mode, pair_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (session_id, payload.lessonId, d.grade, d.caseId, d.school, d.currentDay, d.startTime, d.endTime, d.mode, d.pairId))
        
        for stat in d.stats:
            cursor.execute("""
            INSERT INTO session_stats (session_id, apiname, value)
            VALUES (?, ?, ?)
            """, (session_id, stat.apiname, stat.value))
            
        conn.commit()
        conn.close()
        
        print(f"✅ [DAT_double/local_test.db] 成功寫入場次: {session_id} | 學生: {d.caseId} | PairID: {d.pairId}")
        return {"sessionId": session_id, "message": "已成功寫入 DAT_double 目錄下的 SQLite 資料庫"}
    except Exception as e:
        print(f"❌ [SQLite] 寫入失敗: {e}")
        raise HTTPException(status_code=500, detail="本地資料庫寫入失敗")

# GET /api/sessions: 開籤查詢 DAT_double 下的歷史場次紀錄
@app.get("/api/sessions")
def get_sessions():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM assessment_result ORDER BY created_at DESC")
    rows = cursor.fetchall()
    
    results = []
    for r in rows:
        row_dict = dict(r)
        cursor.execute("SELECT apiname, value FROM session_stats WHERE session_id = ?", (row_dict["session_id"],))
        stats = [dict(s) for s in cursor.fetchall()]
        row_dict["stats"] = stats
        results.append(row_dict)
        
    conn.close()
    return {"total": len(results), "records": results}

# 其他 /api 路徑（登入、/api/auth/me、學生報表）轉送到開發後端，
# 讓登入守門照常運作；成績寫入仍由上方 /api/sessions 存進本地 SQLite。
FORWARD_HEADERS = {"authorization", "content-type", "x-partner-authorization"}


def _forward(method: str, url: str, headers: dict, body: bytes) -> Response:
    req = urllib.request.Request(url, data=body or None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            status_code, res_headers, content = res.status, res.headers, res.read()
    except urllib.error.HTTPError as err:
        status_code, res_headers, content = err.code, err.headers, err.read()
    except (urllib.error.URLError, TimeoutError, OSError):
        raise HTTPException(status_code=502, detail=f"開發後端 {UPSTREAM} 連不上")
    passthrough = {k: v for k, v in res_headers.items() if k.lower() == "cache-control"}
    return Response(content, status_code=status_code, media_type=res_headers.get("content-type"), headers=passthrough)


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy_upstream(path: str, request: Request):
    url = f"{UPSTREAM}/api/{path}" + (f"?{request.url.query}" if request.url.query else "")
    headers = {k: v for k, v in request.headers.items() if k.lower() in FORWARD_HEADERS}
    body = await request.body()
    return await run_in_threadpool(_forward, request.method, url, headers, body)


# ----------------------------------------------------
# 4. 以 /app/ 託管整個前端（與正式後端相同路徑），只提供前端素材
# ----------------------------------------------------
STATIC_SUFFIXES = {
    ".html", ".js", ".mjs", ".css", ".json", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".ico", ".mp3", ".wav", ".ogg", ".woff", ".woff2", ".ttf",
}
# 後端、測試與工具不是遊戲頁面，不對外提供
BLOCKED_TOP_DIRS = {"backend", "tests", "tools", "node_modules"}


def _static_file(path: str) -> Optional[Path]:
    parts = Path(path).parts
    if not parts or parts[0] in BLOCKED_TOP_DIRS or any(part.startswith(".") for part in parts):
        return None
    target = (REPO_ROOT / path).resolve()
    if not target.is_relative_to(REPO_ROOT):
        return None
    if target.is_dir():
        target = target / "index.html"
    if target.suffix.lower() not in STATIC_SUFFIXES or not target.is_file():
        return None
    return target


@app.get("/app")
def app_home():
    return RedirectResponse("/app/Home/index.html")


@app.get("/app/{path:path}")
def serve_frontend(path: str):
    if not path:
        return RedirectResponse("/app/Home/index.html")
    target = _static_file(path)
    if target is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return FileResponse(target, headers={"Cache-Control": "no-store"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT)