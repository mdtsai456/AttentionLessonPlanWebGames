"""密碼雜湊與登入 token 工具。純函式，不碰資料庫、不依賴 FastAPI。

只用 stdlib（hashlib／hmac／secrets），不新增依賴，跟這個 repo 現有的精簡依賴清單一致。
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 260_000
_SALT_BYTES = 16

# 學生與老師都是登入後 1 小時失效；前端依登入回應的 expiresIn（剩餘秒數）自動登出，
# 不直接拿 expiresAt 比對裝置時鐘，避免裝置時鐘快慢讓登入提早或延後失效。
TOKEN_TTL = timedelta(hours=1)

# 帳號不存在時拿這個假雜湊跑一次 verify_password，讓「帳號不存在」和「密碼錯誤」
# 花一樣久的 PBKDF2，回應時間才不會洩漏哪些帳號存在。演算法與迭代次數必須跟
# hash_password 相同；salt／digest 內容無所謂，呼叫端不看比對結果、一律當登入失敗。
DUMMY_PASSWORD_HASH = f"{_ALGORITHM}${_ITERATIONS}${'00' * _SALT_BYTES}${'00' * 32}"


def hash_password(password: str) -> str:
    """回傳可直接存進 password_hash 欄位的字串。

    格式：pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>。iterations 存進字串裡，
    之後要調高強度時舊密碼仍可驗證，不用一次性遷移全部使用者。
    """
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return f"{_ALGORITHM}${_ITERATIONS}${salt.hex()}${digest.hex()}"


def _parse_password_hash(stored: object) -> tuple[int, bytes, str] | None:
    """拆出 (iterations, salt, digest_hex)；不是可用的 pbkdf2_sha256 雜湊就回 None。"""
    if not isinstance(stored, str):
        return None
    parts = stored.split("$")
    if len(parts) != 4:
        return None
    algorithm, iterations_str, salt_hex, digest_hex = parts
    if algorithm != _ALGORITHM:
        return None
    try:
        iterations = int(iterations_str)
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return None
    # pbkdf2_hmac 要求 1 <= iterations < 2**31（C int）；超出範圍會拋例外。
    if not 1 <= iterations < 2**31:
        return None
    return iterations, salt, digest_hex


def is_usable_password_hash(stored: object) -> bool:
    """stored 是否真的會讓 verify_password 跑 PBKDF2。

    空字串、NULL、格式錯誤、演算法不符、迭代次數不合法的雜湊，verify_password
    會立刻回 False；登入端點遇到這種帳號要改跑一次假雜湊，回應時間才跟
    「帳號不存在」一樣，不會洩漏帳號存在。
    """
    return _parse_password_hash(stored) is not None


def verify_password(password: str, stored: str) -> bool:
    """比對明碼密碼與 hash_password 存的字串。格式不對／演算法不符一律回 False。"""
    parsed = _parse_password_hash(stored)
    if parsed is None:
        return False
    iterations, salt, digest_hex = parsed
    try:
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    except (ValueError, OverflowError):
        return False

    return hmac.compare_digest(candidate.hex(), digest_hex)


def student_account(student_id: int) -> str:
    """學生登入帳號：S 加三位數 student_id（S001）；超過 999 自然變成四位數。"""
    return f"S{student_id:03d}"


def teacher_account(teacher_id: int) -> str:
    """老師登入帳號：T 加三位數 teacher_id（T001）。"""
    return f"T{teacher_id:03d}"


def generate_token() -> str:
    """產生一組不可預測的登入 token（url-safe，適合放進 Authorization header）。"""
    return secrets.token_urlsafe(32)
