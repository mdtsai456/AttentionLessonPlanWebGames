"""學生遊戲場次與總覽報告 API。

啟動方式：
    cp .env.example .env   # 填入 DB_PASSWORD / DB_WRITE_PASSWORD
    uv sync --group dev
    uv run uvicorn main:app --reload --host 127.0.0.1 --port 5001

端點：
    POST /api/sessions
    GET /api/students?school=測試場域
    GET /api/students/{studentKey}/sessions?school=測試場域
    GET /api/students/{studentKey}/report?school=測試場域
    GET /api/schools
    GET /api/schools/{school}/teachers
    GET /api/teachers/{teacherId}/students

CORS：瀏覽器前端跨網域呼叫需要放行其 origin。用環境變數 CORS_ALLOW_ORIGINS
設定（逗號分隔的清單，或單一 `*` 放行全部）。未設定時預設放行常見的本機
前端 dev server（localhost 的 3000 / 5173 / 5500 / 8080）。
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import validate_db_settings
from routers import directory, sessions, students

load_dotenv()

# 未設定 CORS_ALLOW_ORIGINS 時放行的本機前端 dev server。
_DEFAULT_DEV_ORIGINS = [
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in ("3000", "5173", "5500", "8080")
]


def _cors_origins() -> list[str]:
    """解析 CORS_ALLOW_ORIGINS。

    - 未設定 / 空白 → 預設的本機 dev server 清單。
    - `*` → 放行所有 origin（早期開發方便用，正式環境請改成明確清單）。
    - 其他 → 以逗號分隔，逐項去空白。
    """
    raw = (os.getenv("CORS_ALLOW_ORIGINS") or "").strip()
    if not raw:
        return list(_DEFAULT_DEV_ORIGINS)
    if raw == "*":
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_db_settings()
    yield


# version 是開發時手動訂的版本號
app = FastAPI(title="ADHD Game Data API", version="0.3.0", lifespan=lifespan)

# 這支 API 沒有 cookie／session（廠商定調無驗證登入），故 allow_credentials=False。
# 安全邊界是 allow_origins 這份明確清單，不是靠 method／header 限制。
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(students.router)
app.include_router(directory.router)


@app.get("/")
def root() -> dict[str, str]:
    return {
        "status": "ok",
        "message": "API is running",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("API_HOST", "127.0.0.1"),
        port=int(os.getenv("API_PORT", "5000")),
        reload=True,
    )
