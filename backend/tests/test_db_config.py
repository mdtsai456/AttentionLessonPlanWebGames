"""MariaDB read/write 設定分流測試。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import db
import main


def test_read_and_write_configs_use_distinct_credentials(monkeypatch):
    monkeypatch.setenv("DB_HOST", "db.example.test")
    monkeypatch.setenv("DB_PORT", "3307")
    monkeypatch.setenv("DB_NAME", "AttentionLessonPlan")
    monkeypatch.setenv("DB_USER", "app_ro")
    monkeypatch.setenv("DB_PASSWORD", "read-secret")
    monkeypatch.setenv("DB_WRITE_USER", "game_writer")
    monkeypatch.setenv("DB_WRITE_PASSWORD", "write-secret")

    read_config = db.get_read_db_config()
    write_config = db.get_write_db_config()

    assert read_config["user"] == "app_ro"
    assert read_config["password"] == "read-secret"
    assert write_config["user"] == "game_writer"
    assert write_config["password"] == "write-secret"
    assert read_config["host"] == write_config["host"] == "db.example.test"
    assert read_config["port"] == write_config["port"] == 3307
    assert read_config["database"] == write_config["database"]


def test_validate_db_settings_lists_all_missing_credentials_without_values(monkeypatch):
    monkeypatch.delenv("DB_USER", raising=False)
    monkeypatch.setenv("DB_PASSWORD", "   ")
    monkeypatch.setenv("DB_WRITE_USER", "game_writer")
    monkeypatch.delenv("DB_WRITE_PASSWORD", raising=False)

    with pytest.raises(db.DatabaseConfigurationError) as error:
        db.validate_db_settings()

    message = str(error.value)
    assert message == (
        "Missing database environment variables: "
        "DB_USER, DB_PASSWORD, DB_WRITE_PASSWORD"
    )
    assert "game_writer" not in message


def test_connection_contexts_route_and_close_each_account(monkeypatch):
    monkeypatch.setenv("DB_USER", "app_ro")
    monkeypatch.setenv("DB_PASSWORD", "read-secret")
    monkeypatch.setenv("DB_WRITE_USER", "game_writer")
    monkeypatch.setenv("DB_WRITE_PASSWORD", "write-secret")
    connections = []
    configs = []

    class FakeConnection:
        def __init__(self):
            self.closed = False

        def close(self):
            self.closed = True

    def connect(**config):
        connection = FakeConnection()
        configs.append(config)
        connections.append(connection)
        return connection

    monkeypatch.setattr(db.pymysql, "connect", connect)

    with db.get_read_connection():
        pass
    with db.get_write_connection():
        pass
    with db.get_connection():
        pass

    assert [config["user"] for config in configs] == [
        "app_ro",
        "game_writer",
        "app_ro",
    ]
    assert all(connection.closed for connection in connections)


def test_app_startup_fails_before_serving_when_credentials_are_missing(monkeypatch):
    monkeypatch.setenv("DB_USER", "app_ro")
    monkeypatch.setenv("DB_PASSWORD", "read-secret")
    monkeypatch.delenv("DB_WRITE_USER", raising=False)
    monkeypatch.delenv("DB_WRITE_PASSWORD", raising=False)

    with pytest.raises(db.DatabaseConfigurationError) as error:
        with TestClient(main.app):
            pass

    assert str(error.value) == (
        "Missing database environment variables: DB_WRITE_USER, DB_WRITE_PASSWORD"
    )
