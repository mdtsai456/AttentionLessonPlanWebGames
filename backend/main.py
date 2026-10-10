"""學生遊戲場次與總覽報告 API。

啟動方式：
    cp .env.example .env   # 填入 DB_PASSWORD / DB_WRITE_PASSWORD
    uv sync --group dev
    uv run uvicorn main:app --reload --host 127.0.0.1 --port 5001

端點：
    POST /api/sessions                              學生 token，雙人另需搭檔 token
    POST /api/auth/teacher/login
    POST /api/auth/student/login
    POST /api/auth/logout
    GET /api/schools                                公開端點
    GET /api/schools/{school}/teachers               公開端點
    GET /api/me/students                             老師 token
    GET /api/students?school=測試場域                  老師 token
    GET /api/students/{studentKey}/sessions?school=…  需要 token
    GET /api/students/{studentKey}/report?school=…    需要 token
    GET /api/teachers/{teacherId}/students            老師本人 token
    GET /api/games                                   公開的靜態遊戲清單
    GET /api/attention/me                            學生 token，轉發手錶專心判定
    GET /demo                                       轉至 /app/Teacher_platform/index.html

正式前端位於專案根目錄。Zeabur 依 zbpack.json 部署為靜態網站。
前端透過 shared/api.js 跨網域呼叫本服務的 /api/*。
/app 只掛載本機存在的目錄。API 服務只有 backend/ 時，略過缺少的目錄，仍可啟動。
不掛載已移除的 frontend/。

前端位於其他網域時，須在 CORS_ALLOW_ORIGINS 允許其 origin。
多個 origin 以逗號分隔。單一 * 允許全部來源。
未設定時，允許 localhost 的 3000／5173／5500／8080 開發伺服器。
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from db import validate_db_settings
from routers import attention, auth, directory, sessions, students

load_dotenv()

# 未設定 CORS_ALLOW_ORIGINS 時，允許此清單中的本機前端開發伺服器。
_DEFAULT_DEV_ORIGINS = [
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in ("3000", "5173", "5500", "8080")
]


def _cors_origins() -> list[str]:
    """解析 CORS_ALLOW_ORIGINS。

    未設定或為空白時，使用預設的本機開發伺服器清單。
    值為 * 時，允許所有 origin。正式環境須使用明確清單。
    其他值以逗號分隔，並移除各項目前後的空白。
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
# allow_origins 清單限制可存取的來源，不以 method／header 限制來源。
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
    "/demo": "/app/Teacher_platform/index.html",
    "/demo/": "/app/Teacher_platform/index.html",
    "/demo/index.html": "/app/Teacher_platform/index.html",
    "/app": "/app/Home/index.html",
    "/app/": "/app/Home/index.html",
    "/app/index.html": "/app/Home/index.html",
    "/app/dms.html": "/app/Teacher_platform/index.html",
    "/app/games.html": "/app/Select/index.html",
    "/app/dccs/": "/app/DCCS_single/index.html",
    "/app/dccs/index.html": "/app/DCCS_single/index.html",
    "/app/dccs/double.html": "/app/DCCS_double/index.html",
    "/app/DAT_single/DAT_tutorial.html": "/app/Tutorial/DAT_tutorial.html",
    "/app/bubblegame/": "/app/Select/index.html",
    "/app/bubblegame/index.html": "/app/Select/index.html",
}


def legacy_redirect(target: str):
    def redirect() -> RedirectResponse:
        return RedirectResponse(target, status_code=307, headers={"Cache-Control": "no-store"})
    return redirect


for source, target in _LEGACY_REDIRECTS.items():
    app.add_api_route(source, legacy_redirect(target), include_in_schema=False)

# 依白名單掛載目前的功能頁面。不提供專案根目錄、backend、.env 或已移除的 frontend/。
_SITE_ROOT = Path(__file__).parent.parent
_SITE_DIRECTORIES = (
    "Home", "Select", "Teacher_platform", "shared", "Tutorial", "DCCS_single",
    "DCCS_double", "DAT_single", "DAT_double", "EFT_single", "EFT_double",
    "IM_single", "TGame_single", "TGame_double",
)


def mount_site_directories(application: FastAPI, site_root: Path) -> None:
    """只掛載存在的目錄。目錄不存在時，StaticFiles 會在啟動時拋出錯誤。"""
    for directory_name in _SITE_DIRECTORIES:
        directory = site_root / directory_name
        if not directory.is_dir():
            continue
        application.mount(
            f"/app/{directory_name}",
            StaticFiles(directory=directory, html=True),
            name=f"site-{directory_name}",
        )


mount_site_directories(app, _SITE_ROOT)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("API_HOST", "127.0.0.1"),
        port=int(os.getenv("API_PORT", "5000")),
        reload=True,
    )
