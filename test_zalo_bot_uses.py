"""Test sổ lượt dùng bot (hermes-plugin/zalo/bot_uses.py): ghi một dòng mỗi lượt, dọn dòng quá 40 ngày.

Chạy: npm run test:py
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "hermes-plugin", "zalo"))
import bot_uses  # noqa: E402

DAY = 86_400


class BotUsesTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = Path(self.dir.name) / "zalo" / "bot-uses.jsonl"
        bot_uses._state["pruned_day"] = None

    def rows(self):
        return [json.loads(line) for line in self.path.read_text(encoding="utf-8").splitlines()]

    def test_records_one_row_per_turn(self):
        bot_uses.record("111", "  Nguyễn   Văn A ", "g1", True, False, now=1000.0, path=self.path)
        bot_uses.record("999", "Chủ", "999", False, True, now=1001.0, path=self.path)
        self.assertEqual(self.rows(), [
            {"t": 1_000_000, "uid": "111", "name": "Nguyễn Văn A", "thread": "g1", "group": True, "owner": False},
            {"t": 1_001_000, "uid": "999", "name": "Chủ", "thread": "999", "group": False, "owner": True},
        ])

    def test_prunes_rows_older_than_40_days_once_a_day(self):
        now = 100 * DAY
        bot_uses.record("1", "a", "g", True, False, now=now - 50 * DAY, path=self.path)
        bot_uses._state["pruned_day"] = None
        bot_uses.record("2", "b", "g", True, False, now=now - 10 * DAY, path=self.path)
        bot_uses._state["pruned_day"] = None
        bot_uses.record("3", "c", "g", True, False, now=now, path=self.path)
        self.assertEqual([r["uid"] for r in self.rows()], ["2", "3"])

    def test_write_errors_never_raise(self):
        blocker = Path(self.dir.name) / "file"
        blocker.write_text("x")
        bot_uses.record("1", "a", "g", True, False, path=blocker / "sub" / "bot-uses.jsonl")


if __name__ == "__main__":
    unittest.main()
