"""密碼雜湊與登入 token 工具。使用純函式，不存取資料庫，也不依賴 FastAPI。

只使用標準函式庫 hashlib／hmac／secrets，不新增依賴。
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 260_000
_SALT_BYTES = 16

# 學生與老師的登入憑證皆在 1 小時後失效。前端依回應的 expiresAt 自動登出。
TOKEN_TTL = timedelta(hours=1)


def hash_password(password: str) -> str:
    """回傳可儲存至 password_hash 的字串。

    格式為 pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>。
    字串包含 iterations，因此提高迭代次數後，仍可驗證舊密碼，無須一次遷移所有使用者。
    """
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return f"{_ALGORITHM}${_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """比對明文密碼與 hash_password 產生的字串。格式無效或演算法不符時，回傳 False。"""
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
    """產生不可預測的登入 token。使用 URL 安全字元，可放入 Authorization header。"""
    return secrets.token_urlsafe(32)
