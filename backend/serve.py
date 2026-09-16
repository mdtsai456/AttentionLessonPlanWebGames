#!/usr/bin/env python3
"""serve.py — 靜態伺服 + 成績接收。

只用 Python 標準函式庫（http.server）。詳細規格見 SPEC.md 第 6、7 節。

用法：
    python3 backend/serve.py [--port 8080]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

# 靜態根是 repo 根目錄；前端在 frontend/ 底下，後端原始碼在 backend/。
ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
RESULTS_DIR = BACKEND_DIR / "results"
DEFAULT_INDEX = "frontend/dccs/index.html"
# 8080 是中介平台後端（backend/main.py）CORS 預設放行的本機 port 之一。
# 換成不在那份白名單裡的 port，跨網域送成績會被 preflight 擋下來。
DEFAULT_PORT = 8080
# 伺服器自己的原始碼（含 results/）不得透過瀏覽器讀取。
FORBIDDEN_DIRS = (BACKEND_DIR.resolve(),)


def sanitize_filename_component(value: str) -> str:
    """把非 ASCII 與空白換成底線，供組成檔名使用。"""
    if value is None:
        value = ""
    value = str(value)
    out_chars = []
    for ch in value:
        if ch.isascii() and (ch.isalnum() or ch in "-_.") and ch != " ":
            out_chars.append(ch)
        else:
            out_chars.append("_")
    result = "".join(out_chars)
    return result if result else "unknown"


def is_path_traversal(raw_path: str) -> bool:
    """偵測路徑中是否含有 '..' 片段（在 URL-decode 之後）。"""
    decoded = unquote(raw_path)
    parts = decoded.split("/")
    return any(p == ".." for p in parts)


def is_forbidden_resolved(candidate: Path) -> bool:
    """檢查解析後的實際路徑是否落在不得對外提供的後端目錄。"""
    for forbidden in FORBIDDEN_DIRS:
        if candidate == forbidden:
            return True
        try:
            candidate.relative_to(forbidden)
            return True
        except ValueError:
            continue
    return False


def resolve_safe_path(raw_path: str) -> Path | None:
    """把 URL path 解析成專案根目錄底下的實際檔案路徑；不安全則回傳 None。"""
    decoded = unquote(raw_path.split("?", 1)[0])
    decoded = decoded.lstrip("/")
    if decoded == "":
        decoded = DEFAULT_INDEX
    candidate = (ROOT / decoded).resolve()
    try:
        candidate.relative_to(ROOT.resolve())
    except ValueError:
        return None
    return candidate


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}


def guess_content_type(path: Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")


def build_results_txt(payload: dict) -> str:
    """TXT 只保存送給中介平台的同一份 payload；縮排只為方便人工核對。"""
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def build_results_filename(payload: dict) -> str:
    data = payload.get("data", {}) or {}
    grade = sanitize_filename_component(data.get("grade", "unknown"))
    case_id = sanitize_filename_component(data.get("caseId", "unknown"))
    school = sanitize_filename_component(data.get("school", "unknown"))
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{ts}_{grade}_{case_id}_{school}.txt"


class Handler(BaseHTTPRequestHandler):
    server_version = "DCCSServe/1.0"

    def _send_json(self, status: int, obj: dict):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _forbidden(self):
        self._send_json(403, {"error": "forbidden"})

    def _not_found(self):
        self._send_json(404, {"error": "not found"})

    def _bad_request(self, message: str):
        self._send_json(400, {"error": message})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (
            self.address_string(),
            self.log_date_time_string(),
            fmt % args,
        ))

    # ---- GET ----
    def do_GET(self):
        parsed = urlsplit(self.path)
        raw_path = parsed.path

        if is_path_traversal(raw_path):
            self._forbidden()
            return

        if raw_path == "/":
            # 保留 query，讓 main.js 能取得受試者資料。
            location = "/" + DEFAULT_INDEX
            if parsed.query:
                location += "?" + parsed.query
            self.send_response(302)
            self.send_header("Location", location)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        # 以解析後的實際落點檢查，涵蓋等價路徑寫法。
        file_path = resolve_safe_path(raw_path)
        if file_path is None:
            self._forbidden()
            return
        if is_forbidden_resolved(file_path):
            self._forbidden()
            return

        if file_path.is_dir():
            file_path = file_path / "index.html"
            if is_forbidden_resolved(file_path):
                self._forbidden()
                return

        if not file_path.is_file():
            self._not_found()
            return

        try:
            body = file_path.read_bytes()
        except OSError:
            self._not_found()
            return

        self.send_response(200)
        self.send_header("Content-Type", guess_content_type(file_path))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---- POST ----
    def do_POST(self):
        parsed = urlsplit(self.path)
        raw_path = parsed.path

        if is_path_traversal(raw_path):
            self._forbidden()
            return

        resolved_for_check = resolve_safe_path(raw_path)
        if resolved_for_check is None:
            self._forbidden()
            return
        if is_forbidden_resolved(resolved_for_check):
            self._forbidden()
            return

        if raw_path != "/api/results":
            self._not_found()
            return

        length_header = self.headers.get("Content-Length")
        if length_header is None:
            self._bad_request("missing Content-Length")
            return
        try:
            length = int(length_header)
        except ValueError:
            self._bad_request("invalid Content-Length")
            return

        raw_body = self.rfile.read(length)
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._bad_request("invalid JSON body")
            return

        if not isinstance(payload, dict):
            self._bad_request("JSON body must be an object")
            return

        try:
            RESULTS_DIR.mkdir(parents=True, exist_ok=True)
            filename = build_results_filename(payload)
            file_path = RESULTS_DIR / filename
            content = build_results_txt(payload)
            file_path.write_text(content, encoding="utf-8")
        except Exception as exc:  # noqa: BLE001
            self._send_json(500, {"error": f"failed to write result: {exc}"})
            return

        rel_path = str(file_path.relative_to(ROOT))
        self._send_json(201, {"file": rel_path})


def main() -> int:
    parser = argparse.ArgumentParser(description="賽道攔截 DCCS 靜態伺服器")
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"監聽埠號（預設 {DEFAULT_PORT}）",
    )
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Serving {ROOT} at http://127.0.0.1:{args.port}/ (Ctrl+C 結束)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
