# 用 uv 管理環境並鎖定相依版本

日期：2026-09-08 · 狀態：accepted

## 脈絡

`requirements.txt` / `requirements-dev.txt` 只寫下限（`fastapi>=0.110.0`…），沒有
lock file。`pip install` 每次都抓當下最新版，本機、CI、部署三邊裝到的版本可能不同。

已經咬到一次：新版 `anyio`（4.10+）對 `anyio.abc.BlockingPortal` 這個別名發
`DeprecationWarning`，而 `starlette.testclient` 仍走舊路徑；`pytest.ini` 設了
`filterwarnings = error`，於是 `pytest` 連測試都**收集不起來**。

廠商也指定用 [`uv`](https://docs.astral.sh/uv/)。

## 決策

- 新增 `pyproject.toml`：`[project].dependencies` 放原本 `requirements.txt` 的四項、
  `[dependency-groups].dev` 放 `pytest`、`httpx`。`requires-python = ">=3.10"`。
- 明確加上 `anyio<4.10` 約束，直到 `starlette` 端修正。
- `uv lock` 產生 `uv.lock` 並**進版控** —— 版本從此鎖定。
- 日常指令改為 `uv sync --group dev`、`uv run uvicorn …`、`uv run pytest`。
- `requirements.txt` / `requirements-dev.txt` 保留為 `uv export --no-hashes` 的**產物**，
  供現行 Zeabur 部署流程（吃 `requirements.txt`）使用。不手改；改相依一律改
  `pyproject.toml` → `uv lock` → 重新 `uv export`。
- `Procfile` 不變（`uvicorn main:app …`）。

## 效果

- 三邊版本一致；`anyio` 收集崩潰的問題消失。
- 部署流程零改動（`requirements.txt` 仍在，只是變成鎖定版的匯出）。
- 日後若 Zeabur 改吃 `pyproject.toml` / `uv.lock`，可直接刪掉匯出的 `requirements*.txt`。
