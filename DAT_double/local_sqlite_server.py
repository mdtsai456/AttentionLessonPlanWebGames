import os
import sqlite3
import uuid
from typing import List, Optional
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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
DB_FILE = os.path.join(CURRENT_DIR, "local_test.db")

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
    value: float

class SessionData(BaseModel):
    grade: str
    caseId: str
    school: str
    currentDay: int
    startTime: int
    endTime: int
    mode: Optional[str] = "double"
    pairId: Optional[str] = None
    stats: List[StatItem]

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
        "health": "/health"
    }

# POST /api/sessions: 接收遊戲數據寫入本地 local_test.db
@app.post("/api/sessions", status_code=status.HTTP_201_CREATED)
def create_session(payload: SessionPayload):
    d = payload.data
    session_id = str(uuid.uuid4())
    
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
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

# ----------------------------------------------------
# 4. 託管 DAT_double 目錄下的靜態素材與指定 HTML 檔
# ----------------------------------------------------
assets_dir = os.path.join(CURRENT_DIR, "assets")
if os.path.exists(assets_dir):
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

@app.get("/{filename}")
async def serve_static_file(filename: str):
    file_path = os.path.join(CURRENT_DIR, filename)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(CURRENT_DIR, "DAT_double.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("local_sqlite_server:app", host="127.0.0.1", port=5002, reload=True)