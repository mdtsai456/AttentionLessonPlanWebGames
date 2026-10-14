"""共用的錯誤轉換工具。

獨立模組讓 routers/identity.py 與 routers/auth.py 共用工具，
避免匯入 routers/students.py 時產生循環匯入。
"""

from __future__ import annotations

import logging

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def db_error(exc: Exception) -> HTTPException:
    """回傳通用錯誤訊息，並將完整例外記錄於伺服器日誌。

    PyMySQL 例外可能包含表名、欄位名、主機位址與使用者名稱。
    公開 API 的 HTTP 回應不可包含這些資訊。
    """
    logger.exception("資料庫查詢失敗")
    return HTTPException(status_code=500, detail="資料庫查詢失敗")
