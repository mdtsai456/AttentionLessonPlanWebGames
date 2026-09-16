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

TOKEN_TTL = timedelta(hours=8)


def hash_password(password: str) -> str:
    """回傳可直接存進 password_hash 欄位的字串。

    格式：pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>。iterations 存進字串裡，
    之後要調高強度時舊密碼仍可驗證，不用一次性遷移全部使用者。
    """
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return f"{_ALGORITHM}${_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """比對明碼密碼與 hash_password 存的字串。格式不對／演算法不符一律回 False。"""
    try:
        algorithm, iterations_str, salt_hex, digest_hex = stored.split("$")
        iterations = int(iterations_str)
        salt = bytes.fromhex(salt_hex)
    except (ValueError, AttributeError):
        return False

    if algorithm != _ALGORITHM:
        return False

    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(candidate.hex(), digest_hex)


def generate_token() -> str:
    """產生一組不可預測的登入 token（url-safe，適合放進 Authorization header）。"""
    return secrets.token_urlsafe(32)
