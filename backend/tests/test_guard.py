"""驗證測試資料庫的安全閥。這個測試不碰資料庫。"""

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
