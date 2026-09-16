#!/usr/bin/env python3
"""依 game/levels.json 與唯讀 material/ 產生 game/manifest.json。

只使用標準函式庫。設定錯誤會終止；素材不足則將關卡標為不可玩。

用法：python3 tools/build_manifest.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
MATERIAL_DIR = ROOT / "material"
GAME_DIR = ROOT / "game"
LEVELS_CONFIG_PATH = GAME_DIR / "levels.json"
MANIFEST_PATH = GAME_DIR / "manifest.json"

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

# shape/ 是唯一保留字：形狀閥的素材夾，不算語意類別。
SHAPE_DIR_NAME = "shape"

VALID_OBJECT_RULES = {"model", "category"}


def url_quote_path(rel_parts: list[str]) -> str:
    """逐段 URL-encode，保留可由 assetBase 解析的相對路徑。"""
    return "/".join(quote(part) for part in rel_parts)


def list_images(dir_path: Path) -> list[Path]:
    if not dir_path.is_dir():
        return []
    files = [
        p
        for p in dir_path.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS and not p.name.startswith(".")
    ]
    files.sort(key=lambda p: p.name)
    return files


def discover_category_dirs() -> list[Path]:
    """列出 material/ 下除了 shape/ 與隱藏項目以外的語意類別。"""
    dirs = []
    for p in MATERIAL_DIR.iterdir():
        if not p.is_dir():
            continue
        if p.name == SHAPE_DIR_NAME:
            continue
        if p.name.startswith("."):
            continue
        dirs.append(p)
    dirs.sort(key=lambda p: p.name)
    return dirs


def build_shapes() -> list[dict]:
    shape_dir = MATERIAL_DIR / SHAPE_DIR_NAME
    shapes = []
    for img in list_images(shape_dir):
        rel = ["material", SHAPE_DIR_NAME, img.name]
        shapes.append(
            {
                "id": f"{SHAPE_DIR_NAME}/{img.stem}",
                "src": url_quote_path(rel),
            }
        )
    return shapes


def build_categories(category_dirs: list[Path]) -> list[dict]:
    categories = []
    for d in category_dirs:
        images = []
        for img in list_images(d):
            rel = ["material", d.name, img.name]
            images.append(
                {
                    "id": f"{d.name}/{img.stem}",
                    "src": url_quote_path(rel),
                    "categoryId": d.name,
                }
            )
        categories.append(
            {
                "id": d.name,
                "imageCount": len(images),
                "images": images,
            }
        )
    categories.sort(key=lambda c: c["id"])
    return categories


def load_levels_config() -> list[dict] | None:
    """讀 game/levels.json，驗證格式。任何錯誤回傳 None（呼叫端印錯誤並以非 0 結束）。

    SPEC 5.1：這裡驗證的是「設定本身合不合法」（缺欄位、型別錯、長度對不
    上），跟「素材有沒有補齊」是兩回事——後者是 compute_feasibility() 的
    工作，走 playable=false + WARN 這條路，不會讓程式在這裡就報錯離開。
    """
    if not LEVELS_CONFIG_PATH.is_file():
        print(f"錯誤：找不到關卡設計表 {LEVELS_CONFIG_PATH}", file=sys.stderr)
        return None

    try:
        with LEVELS_CONFIG_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as exc:
        print(f"錯誤：{LEVELS_CONFIG_PATH} 不是合法的 JSON：{exc}", file=sys.stderr)
        return None

    levels = data.get("levels") if isinstance(data, dict) else None
    if not isinstance(levels, list) or len(levels) == 0:
        print(f"錯誤：{LEVELS_CONFIG_PATH} 的 \"levels\" 必須是非空陣列", file=sys.stderr)
        return None

    for i, lv in enumerate(levels):
        level_no = i + 1
        if not isinstance(lv, dict):
            print(f"錯誤：levels.json 第 {level_no} 關不是物件", file=sys.stderr)
            return None

        shape_count = lv.get("shapeCount")
        if not isinstance(shape_count, int) or isinstance(shape_count, bool) or shape_count < 1:
            print(
                f"錯誤：levels.json 第 {level_no} 關 shapeCount 不合法：{shape_count!r}"
                "（必須是 >= 1 的整數）",
                file=sys.stderr,
            )
            return None

        object_count = lv.get("objectCount")
        if not isinstance(object_count, int) or isinstance(object_count, bool) or object_count < 1:
            print(
                f"錯誤：levels.json 第 {level_no} 關 objectCount 不合法：{object_count!r}"
                "（必須是 >= 1 的整數）",
                file=sys.stderr,
            )
            return None

        object_rule = lv.get("objectRule")
        if object_rule not in VALID_OBJECT_RULES:
            print(
                f"錯誤：levels.json 第 {level_no} 關 objectRule 不合法：{object_rule!r}"
                f"（只能是 {sorted(VALID_OBJECT_RULES)!r}）",
                file=sys.stderr,
            )
            return None

        if object_rule == "model":
            source_category = lv.get("sourceCategory")
            if not isinstance(source_category, str) or not source_category:
                print(
                    f"錯誤：levels.json 第 {level_no} 關（model）缺少合法的 sourceCategory"
                    f"：{source_category!r}（必須是非空字串，即 material/ 底下的資料夾名稱）",
                    file=sys.stderr,
                )
                return None
        else:  # object_rule == "category"
            source_categories = lv.get("sourceCategories")
            if not isinstance(source_categories, list) or len(source_categories) == 0:
                print(
                    f"錯誤：levels.json 第 {level_no} 關（category）缺少合法的 "
                    f"sourceCategories 陣列：{source_categories!r}",
                    file=sys.stderr,
                )
                return None
            if not all(isinstance(c, str) and c for c in source_categories):
                print(
                    f"錯誤：levels.json 第 {level_no} 關 sourceCategories 內含非字串或空字串"
                    f"：{source_categories!r}",
                    file=sys.stderr,
                )
                return None
            if len(source_categories) != object_count:
                print(
                    f"錯誤：levels.json 第 {level_no} 關 sourceCategories 長度"
                    f"（{len(source_categories)}）與 objectCount（{object_count}）不符",
                    file=sys.stderr,
                )
                return None

    return levels


def compute_feasibility(levels_config: list[dict], categories: list[dict], num_shapes: int):
    """回傳 (levels, warnings, table_rows)。詳見 SPEC 1.6、5。

    levels：完全照 levels_config 的順序，每項補上 index/levelNo/playable/
    reason，並原封不動帶上該關的 sourceCategory（model 關）或
    sourceCategories（category 關）。
    warnings：不可行關卡的 WARN 訊息（不可行的那一半不得降級或略過，
    整關直接標 unplayable）。
    """
    category_by_id = {c["id"]: c for c in categories}

    levels_out = []
    warnings: list[str] = []
    table_rows = []

    for idx, lv in enumerate(levels_config):
        level_no = idx + 1
        shape_count = lv["shapeCount"]
        object_count = lv["objectCount"]
        rule = lv["objectRule"]

        # 兩道閥的選項數獨立；frame 只檢查 shapeCount。
        frame_ok = num_shapes >= shape_count
        reasons = []
        if not frame_ok:
            reasons.append(f"frame needs {shape_count} shapes, have {num_shapes}")

        level_extra: dict = {}
        if rule == "model":
            source_category = lv["sourceCategory"]
            level_extra["sourceCategory"] = source_category
            source_desc = source_category

            cat = category_by_id.get(source_category)
            if cat is None:
                object_ok = False
                reasons.append(f'model source category "{source_category}" not found')
            else:
                count = cat["imageCount"]
                object_ok = count >= object_count
                if not object_ok:
                    reasons.append(
                        f'model source category "{source_category}" needs {object_count} images, have {count}'
                    )
        else:  # rule == "category"
            source_categories = lv["sourceCategories"]
            level_extra["sourceCategories"] = source_categories
            source_desc = ",".join(source_categories)

            # 陣列長度已在載入設定時驗證，此處只檢查素材是否存在。
            missing = [c for c in source_categories if c not in category_by_id]
            object_ok = len(missing) == 0
            if missing:
                missing_desc = ", ".join(f'"{m}"' for m in missing)
                reasons.append(f"category source categories not found: {missing_desc}")

        playable = frame_ok and object_ok
        reason = None if playable else "; ".join(reasons)
        if not playable:
            warnings.append(f"level {level_no} unplayable ({reason})")

        level_entry = {
            "index": idx,
            "levelNo": level_no,
            "shapeCount": shape_count,
            "objectCount": object_count,
            "objectRule": rule,
        }
        level_entry.update(level_extra)
        level_entry["playable"] = playable
        level_entry["reason"] = reason
        levels_out.append(level_entry)

        table_rows.append(
            {
                "levelNo": level_no,
                "shapeCount": shape_count,
                "objectCount": object_count,
                "objectRule": rule,
                "source": source_desc,
                "frame": frame_ok,
                "object": object_ok,
                "playable": playable,
            }
        )

    return levels_out, warnings, table_rows


def print_feasibility_table(table_rows: list[dict]) -> None:
    def mark(ok: bool) -> str:
        return "OK" if ok else "--"

    header = (
        f"{'關卡':<6}{'形狀數':<8}{'物件數':<8}{'規則':<10}{'素材來源':<16}"
        f"{'frame':<8}{'object':<8}{'playable':<10}"
    )
    print(header)
    print("-" * len(header))
    for row in table_rows:
        print(
            f"{row['levelNo']:<6}{row['shapeCount']:<8}{row['objectCount']:<8}"
            f"{row['objectRule']:<10}{row['source']:<16}{mark(row['frame']):<8}"
            f"{mark(row['object']):<8}{mark(row['playable']):<10}"
        )


def main() -> int:
    if not MATERIAL_DIR.is_dir():
        print(f"錯誤：找不到 material/ 目錄 ({MATERIAL_DIR})", file=sys.stderr)
        return 1

    levels_config = load_levels_config()
    if levels_config is None:
        return 1

    category_dirs = discover_category_dirs()
    if not category_dirs:
        print("警告：material/ 底下沒有任何語意類別資料夾（shape/ 以外的子資料夾）", file=sys.stderr)

    shapes = build_shapes()
    categories = build_categories(category_dirs)
    levels, warnings, table_rows = compute_feasibility(levels_config, categories, len(shapes))

    manifest = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "backgrounds": {
            "single": url_quote_path(["material", "Single.png"]),
            "double": url_quote_path(["material", "Double.png"]),
        },
        "shapes": shapes,
        "categories": categories,
        "levels": levels,
        "warnings": warnings,
    }

    GAME_DIR.mkdir(parents=True, exist_ok=True)
    with MANIFEST_PATH.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"已產生 {MANIFEST_PATH.relative_to(ROOT)}")
    print()
    print("===== 各關卡出題可行性表 =====")
    print_feasibility_table(table_rows)
    print()
    if warnings:
        print("===== 警告 =====")
        for w in warnings:
            print(f"WARN: {w}")
    else:
        print(f"無警告：{len(levels)} 關全部 playable。")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
