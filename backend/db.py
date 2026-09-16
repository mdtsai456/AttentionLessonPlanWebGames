"""MariaDB 連線設定，參數由 .env 讀取。"""

import os
from contextlib import contextmanager

import pymysql
from dotenv import load_dotenv

load_dotenv()


class DatabaseConfigurationError(RuntimeError):
    """必要的資料庫環境變數未設定。"""


DB_CREDENTIAL_VARIABLES = (
    "DB_USER",
    "DB_PASSWORD",
    "DB_WRITE_USER",
    "DB_WRITE_PASSWORD",
)


def _missing_variables(names: tuple[str, ...]) -> list[str]:
    return [name for name in names if not (os.getenv(name) or "").strip()]


def _raise_for_missing_variables(missing: list[str]) -> None:
    if missing:
        raise DatabaseConfigurationError(
            f"Missing database environment variables: {', '.join(missing)}"
        )


def validate_db_settings() -> None:
    _raise_for_missing_variables(_missing_variables(DB_CREDENTIAL_VARIABLES))


def _required_credentials(
    user_variable: str,
    password_variable: str,
) -> tuple[str, str]:
    _raise_for_missing_variables(_missing_variables((user_variable, password_variable)))
    return os.environ[user_variable], os.environ[password_variable]


def _get_db_config(user_variable: str, password_variable: str) -> dict:
    user, password = _required_credentials(user_variable, password_variable)
    return {
        "host": os.getenv("DB_HOST", "127.0.0.1"),
        "port": int(os.getenv("DB_PORT", "3306")),
        "user": user,
        "password": password,
        "database": os.getenv("DB_NAME", "AttentionLessonPlan"),
        "charset": "utf8mb4",
        "cursorclass": pymysql.cursors.DictCursor,
    }


def get_db_config() -> dict:
    """Maintenance/test 預設連線設定，沿用 DB_USER。"""
    return _get_db_config("DB_USER", "DB_PASSWORD")


def get_read_db_config() -> dict:
    return _get_db_config("DB_USER", "DB_PASSWORD")


def get_write_db_config() -> dict:
    return _get_db_config("DB_WRITE_USER", "DB_WRITE_PASSWORD")


@contextmanager
def _connection(config: dict):
    connection = pymysql.connect(**config)
    try:
        yield connection
    finally:
        connection.close()


@contextmanager
def get_connection():
    with _connection(get_db_config()) as connection:
        yield connection


@contextmanager
def get_read_connection():
    with _connection(get_read_db_config()) as connection:
        yield connection


@contextmanager
def get_write_connection():
    with _connection(get_write_db_config()) as connection:
        yield connection
