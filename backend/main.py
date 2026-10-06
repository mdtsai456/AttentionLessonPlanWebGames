"""學生遊戲場次與總覽報告 API。

啟動方式：
    cp .env.example .env   # 填入 DB_PASSWORD / DB_WRITE_PASSWORD
    uv sync --group dev
    uv run uvicorn main:app --reload --host 127.0.0.1 --port 5001

端點：
    POST /api/sessions                              ← 學生 token；雙人另帶搭檔 token
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
    GET /api/attention/me                            ← 學生專用，轉發手錶專心判定
    GET /demo                                       ← 轉 /app/Back/index.html

前端：正式前端是 repo 根目錄，由 Zeabur 以靜態網站部署（zbpack.json），
透過 shared/api.js 跨網域呼叫本服務的 /api/*。
/app 另外以目錄白名單提供同一批現行頁，舊網址轉至 Home／Select／Back 與對應遊戲。
不再掛載已移除的 frontend/。

CORS：前端部署在別的網域，需在 CORS_ALLOW_ORIGINS 放行其 origin。用環境變數
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
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from db import validate_db_settings
from routers import attention, auth, directory, sessions, students

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

# 使用 Bearer token，不使用 cookie，故 allow_credentials=False。
# 安全邊界是 allow_origins 這份明確清單，不是靠 method／header 限制。
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def uncached_identity(request, call_next):
    response = await call_next(request)
    if request.url.path == "/api/auth/me":
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    return response


app.include_router(sessions.router)
app.include_router(students.router)
app.include_router(directory.router)
app.include_router(auth.router)
app.include_router(attention.router)


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


# 舊前端入口一律轉至現行頁，HTTP 轉址優先於靜態掛載。
_LEGACY_REDIRECTS = {
    "/demo": "/app/Back/index.html",
    "/demo/": "/app/Back/index.html",
    "/demo/index.html": "/app/Back/index.html",
    "/app": "/app/Home/index.html",
    "/app/": "/app/Home/index.html",
    "/app/index.html": "/app/Home/index.html",
    "/app/dms.html": "/app/Back/index.html",
    "/app/games.html": "/app/Select/index.html",
    "/app/dccs/": "/app/DCCS/index.html",
    "/app/dccs/index.html": "/app/DCCS/index.html",
    "/app/dccs/double.html": "/app/DCCS/double.html",
    "/app/DAT_single/DAT_tutorial.html": "/app/tutorial/DAT_tutorial.html",
    "/app/bubblegame/": "/app/Select/index.html",
    "/app/bubblegame/index.html": "/app/Select/index.html",
}


def legacy_redirect(target: str):
    def redirect() -> RedirectResponse:
        return RedirectResponse(target, status_code=307, headers={"Cache-Control": "no-store"})
    return redirect


for source, target in _LEGACY_REDIRECTS.items():
    app.add_api_route(source, legacy_redirect(target), include_in_schema=False)

# 白名單掛載現行功能頁；不提供 repo 根、backend、.env 或已移除的 frontend/。
_SITE_ROOT = Path(__file__).parent.parent


@app.get("/app/主題資料.csv", include_in_schema=False)
def game_questions() -> FileResponse:
    return FileResponse(_SITE_ROOT / "主題資料.csv", media_type="text/csv")

for directory_name in (
    "Home", "Select", "Back", "shared", "tutorial", "DCCS", "DAT_single",
    "DAT_double", "EFT_single", "EFT_double", "IM1", "TGame1", "TGame2",
):
    app.mount(f"/app/{directory_name}",
              StaticFiles(directory=_SITE_ROOT / directory_name, html=True),
              name=f"site-{directory_name}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("API_HOST", "127.0.0.1"),
        port=int(os.getenv("API_PORT", "5000")),
        reload=True,
    )
