"""驗證測試資料庫的名稱檢查，不存取資料庫。"""

from __future__ import annotations

import pytest

from conftest import _assert_test_database


def test_accepts_name_ending_with_test():
    _assert_test_database("AttentionLessonPlan_test")


def test_rejects_production_database_name():
    with pytest.raises(AssertionError, match="拒絕在非測試資料庫上執行"):
        _assert_test_database("AttentionLessonPlan")


def test_rejects_name_merely_containing_test():
    with pytest.raises(AssertionError, match="拒絕在非測試資料庫上執行"):
        _assert_test_database("test_AttentionLessonPlan")


def test_sessionfinish_skips_reseed_when_database_was_not_cleared(monkeypatch):
    import conftest

    monkeypatch.setattr(conftest, "_truncated_test_db", False)
    called = []
    monkeypatch.setattr(conftest, "_reseed_test_database", lambda: called.append(1))

    conftest.pytest_sessionfinish(session=None, exitstatus=0)

    assert called == []
