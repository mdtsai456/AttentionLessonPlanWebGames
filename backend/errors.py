"""共用的錯誤轉換工具。

獨立成一個模組（而非放在 routers/students.py 裡）是為了讓 routers/identity.py
和 routers/auth.py 都能用它，又不必互相 import routers/students 造成循環匯入。
"""

from __future__ import annotations

import logging

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def db_error(exc: Exception) -> HTTPException:
    """回給呼叫端一句通用訊息，完整例外寫進 server log。

    PyMySQL 的例外訊息可能包含表名、欄位名，連線失敗時甚至包含主機位址與
    使用者名稱。這個 API 部署在公開網路上，那些資訊不該出現在 HTTP 回應裡。
    """
    logger.exception("資料庫查詢失敗")
    return HTTPException(status_code=500, detail="資料庫查詢失敗")
