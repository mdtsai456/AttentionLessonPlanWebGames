"""漂浮泡泡（EFT_single / EFT_double）引用的本地素材必須以完全相同的檔名存在。不碰資料庫。

正式站跑在 Linux，檔名大小寫有分；macOS 本機不分，所以 `箭頭00.png` 對上
`箭頭00.PNG` 在本機看起來正常，上線卻是 404，遊戲預載失敗就無法開始。

比對的依據是 git 索引（`git ls-files`）而不是工作目錄：正式站的檔案是從 git 取出的，
而 macOS 上只改大小寫的重命名 git 根本偵測不到（`core.ignorecase=true`，工作目錄已是
`箭頭00.png`、索引仍是 `箭頭00.PNG`、`git status` 乾淨）。列工作目錄會看到新檔名而誤判
通過，部署出去卻還是舊檔名。問 git 的結果在哪個平台跑都一樣。
"""

from __future__ import annotations

import functools
import pathlib
import re
import subprocess

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
GAME_DIRS = ("EFT_single", "EFT_double")

# 字串常值或 CSS url() 裡的相對路徑；含 ${} 的樣板字串不算。
LOCAL_ASSET_LITERAL = re.compile(r"""['"`]((?:assets|fonts)/[^'"`$]+)['"`]""")


def _referenced_paths(source: pathlib.Path) -> list[str]:
    return LOCAL_ASSET_LITERAL.findall(source.read_text(encoding="utf-8"))


@functools.lru_cache(maxsize=None)
def _tracked_names(repo: pathlib.Path, subdir: str) -> frozenset[str]:
    """`repo` 的 git 索引裡 `subdir` 底下的檔名，相對 `subdir`。

    `-z` 讓 git 直接吐原始位元組，省掉非 ASCII 檔名被加引號轉義的麻煩。
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
    """防止正則失效時下面的參數化測試變成零筆而默默通過。"""
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
    """重現本檔案要擋的那個情境：只改大小寫的重命名後，索引仍是舊檔名。

    在 macOS 上 git 連這次重命名都偵測不到，改讀工作目錄就會看到 `箭頭00.png` 而誤判通過。
    """
    subprocess.run(["git", "init", "-q", str(tmp_path)], capture_output=True, check=True)
    assets = tmp_path / "EFT_x" / "assets"
    assets.mkdir(parents=True)
    (assets / "箭頭00.PNG").write_bytes(b"")
    subprocess.run(["git", "-C", str(tmp_path), "add", "-A"], capture_output=True, check=True)

    (assets / "箭頭00.PNG").rename(assets / "箭頭00.png")

    assert (assets / "箭頭00.png").name in [p.name for p in assets.iterdir()]
    assert _tracked_names(tmp_path, "EFT_x") == frozenset({"assets/箭頭00.PNG"})
