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
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI

from db import validate_db_settings
from routers import sessions, students

load_dotenv()


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_db_settings()
    yield


# version 是開發時手動訂的版本號
app = FastAPI(title="ADHD Game Data API", version="0.3.0", lifespan=lifespan)

app.include_router(sessions.router)
app.include_router(students.router)


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
