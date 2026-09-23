"""學生遊戲場次與總覽報告 API。

啟動方式：
    cp .env.example .env   # 填入 DB_PASSWORD / DB_WRITE_PASSWORD
    uv sync --group dev
    uv run uvicorn main:app --reload --host 127.0.0.1 --port 5001

端點：
    POST /api/sessions                              ← Unity 用，無驗證
    POST /api/auth/teacher/login
    POST /api/auth/student/login
    POST /api/auth/logout
    GET /api/schools                                ← 公開，登入前要用
    GET /api/schools/{school}/teachers               ← 公開，登入前要用
    GET /api/me/students                             ← 老師專用，須帶 token
    GET /api/students?school=測試場域                  ← 須帶 token（老師）
    GET /api/students/{studentKey}/sessions?school=…  ← 須帶 token
    GET /api/students/{studentKey}/report?school=…    ← 須帶 token
    GET /api/teachers/{teacherId}/students            ← 須帶 token（老師本人）
    GET /api/games                                   ← 公開，靜態遊戲清單
    GET /demo   ← 開發／驗收用的簡易檢視畫面（非正式前端，帳密登入後會壞掉）

靜態前端：正式前端（登入頁、DMS、遊戲大廳與網頁版遊戲）掛在 /app，由本服務
一併提供，入口是 /app/。因為與 /api/* 同源，瀏覽器端不需要任何 CORS 放行，
也不必另外起一個靜態伺服器。

CORS：前端若部署在別的網域（不走 /app）才需要放行其 origin。用環境變數
CORS_ALLOW_ORIGINS 設定（逗號分隔的清單，或單一 `*` 放行全部）。未設定時
預設放行常見的本機前端 dev server（localhost 的 3000 / 5173 / 5500 / 8080）。
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from db import validate_db_settings
from routers import auth, directory, sessions, students

load_dotenv()

_DEMO_HTML = Path(__file__).parent / "demo" / "index.html"

# 正式前端在 repo 的 frontend/，與 backend/ 平行。
_FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

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
app.include_router(auth.router)


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


@app.get("/demo", response_class=HTMLResponse, include_in_schema=False)
def demo() -> str:
    """開發／驗收用的簡易檢視畫面。

    讀取同源的 /api/*（不會有 CORS 問題），把「選場域→選老師／學生→看報告」的
    流程畫出來給人看。**這不是正式前端**（正式前端由另一位組員負責）。
    """
    if not _DEMO_HTML.exists():
        return "<h1>demo/index.html 不存在</h1>"
    return _DEMO_HTML.read_text(encoding="utf-8")


# 靜態前端掛在最後，路徑固定為 /app，不會遮蔽 /api/*、/health、/demo，
# 也不會跟日後新增的 API 路由相撞。
#
# 只掛 frontend/ 這一個目錄：後端原始碼與 .env 不在其中，沒有外流風險——
# 這點比先前那支「伺服整個 repo 根、再用黑名單擋掉 backend/」的靜態伺服器
# 安全，白名單本來就比黑名單可靠。
#
# html=True 讓 /app/ 直接吐 frontend/index.html（登入頁）。
if _FRONTEND_DIR.is_dir():
    app.mount(
        "/app",
        StaticFiles(directory=_FRONTEND_DIR, html=True),
        name="frontend",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("API_HOST", "127.0.0.1"),
        port=int(os.getenv("API_PORT", "5000")),
        reload=True,
    )
