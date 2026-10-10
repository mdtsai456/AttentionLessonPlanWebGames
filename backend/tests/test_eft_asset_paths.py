"""EFT_single／EFT_double 引用的本地素材須有完全相同的檔名。不存取資料庫。

正式站使用 Linux，檔名區分大小寫。macOS 本機的檔案系統不區分大小寫。
因此引用 `箭頭00.png`，而檔案為 `箭頭00.PNG` 時，本機可載入，正式站則回傳 404。
素材預載失敗會阻止遊戲開始。

比對使用 git 索引，即 `git ls-files`，因為部署檔案來自 git。
core.ignorecase=true 時，git 可能未偵測只有大小寫變更的重新命名。
工作目錄可能顯示 `箭頭00.png`，但索引仍為 `箭頭00.PNG`，且 git status 沒有變更。
只檢查工作目錄可能誤判通過。檢查 git 索引可在各平台使用相同的部署檔名。
"""

from __future__ import annotations

import functools
import pathlib
import re
import subprocess

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
GAME_DIRS = ("EFT_single", "EFT_double")

# 取得字串常值或 CSS url() 中的相對路徑。排除包含 ${} 的樣板字串。
LOCAL_ASSET_LITERAL = re.compile(r"""['"`]((?:assets|fonts)/[^'"`$]+)['"`]""")


def _referenced_paths(source: pathlib.Path) -> list[str]:
    return LOCAL_ASSET_LITERAL.findall(source.read_text(encoding="utf-8"))


@functools.lru_cache(maxsize=None)
def _tracked_names(repo: pathlib.Path, subdir: str) -> frozenset[str]:
    """列出 `repo` 的 git 索引中，`subdir` 下的檔名。結果相對於 `subdir`。

    `-z` 輸出原始位元組，避免非 ASCII 檔名的引號與跳脫處理。
    """
    listing = subprocess.run(
        ["git", "-C", str(repo), "ls-files", "-z", "--", subdir],
        capture_output=True,
        check=True,
    ).stdout.decode("utf-8")
    prefix = f"{subdir}/"
    return frozenset(
        entry[len(prefix):] for entry in listing.split("\0") if entry.startswith(prefix)
    )


def _shared_cases() -> list[tuple[str, str]]:
    # shared/eft-assets.js 的路徑以載入它的頁面為基準，兩個版本各自解析一次。
    paths = _referenced_paths(REPO_ROOT / "shared" / "eft-assets.js")
    return [(game, path) for game in GAME_DIRS for path in paths]


def _own_file_cases() -> list[tuple[str, str]]:
    cases = set()
    for game in GAME_DIRS:
        for suffix in (".js", ".css", ".html"):
            source = REPO_ROOT / game / f"{game}{suffix}"
            cases.update((game, path) for path in _referenced_paths(source))
    return sorted(cases)


def test_shared_eft_assets_declares_the_expected_files():
    """正則失效時，須阻止參數化測試因零筆資料而通過。"""
    paths = _referenced_paths(REPO_ROOT / "shared" / "eft-assets.js")
    assert "assets/arrow/反向提示.png" in paths
    assert {f"assets/arrow/箭頭0{i}.png" for i in range(4)} <= set(paths)
    assert len(paths) == 7


@pytest.mark.parametrize(("game", "path"), _shared_cases())
def test_shared_eft_asset_is_tracked_with_exact_name(game: str, path: str):
    assert path in _tracked_names(REPO_ROOT, game), f"{game}/{path}"


@pytest.mark.parametrize(("game", "path"), _own_file_cases())
def test_game_page_asset_is_tracked_with_exact_name(game: str, path: str):
    assert path in _tracked_names(REPO_ROOT, game), f"{game}/{path}"


def test_tracked_names_reports_the_index_name_not_the_worktree_name(tmp_path: pathlib.Path):
    """重現只有檔名大小寫變更，但 git 索引仍保留舊檔名的情況。

    macOS 上 git 可能未偵測重新命名。只讀取工作目錄會取得 `箭頭00.png`，造成誤判。
    """
    subprocess.run(["git", "init", "-q", str(tmp_path)], capture_output=True, check=True)
    assets = tmp_path / "EFT_x" / "assets"
    assets.mkdir(parents=True)
    (assets / "箭頭00.PNG").write_bytes(b"")
    subprocess.run(["git", "-C", str(tmp_path), "add", "-A"], capture_output=True, check=True)

    (assets / "箭頭00.PNG").rename(assets / "箭頭00.png")

    assert (assets / "箭頭00.png").name in [p.name for p in assets.iterdir()]
    assert _tracked_names(tmp_path, "EFT_x") == frozenset({"assets/箭頭00.PNG"})
