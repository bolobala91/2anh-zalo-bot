"""Test sổ sự kiện AI (hermes-plugin/zalo_tools/ai_events.py): vision / vẽ ảnh / video, dọn dòng quá 90 ngày.

Chạy: npm run test:py
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "hermes-plugin", "zalo_tools"))
import ai_events  # noqa: E402

DAY = 86_400
TURN = {"sender_uid": "1111111111111111111", "sender_name": " Cô  Lan ", "thread_id": "555", "is_group": True, "is_owner": False}


class AiEventsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = Path(self.dir.name) / "zalo" / "ai-events.jsonl"
        ai_events._state["pruned_day"] = None

    def rows(self):
        return [json.loads(line) for line in self.path.read_text(encoding="utf-8").splitlines()]

    def test_records_kind_engine_model_and_who(self):
        ai_events.record("image", engine="stali", model="gpt-image-2", fallbacks=1, turn=TURN, now=1000, path=self.path)
        ai_events.record("vision", model="hermes", n=3, turn=TURN, now=1001, path=self.path)
        ai_events.record("video", engine="stali", model="seedance", ok=False, seconds=5, now=1002, path=self.path)
        ai_events.record("la-lam", now=1003, path=self.path)
        r = self.rows()
        self.assertEqual([x["kind"] for x in r], ["image", "vision", "video"], "loại lạ thì bỏ")
        self.assertEqual((r[0]["engine"], r[0]["model"], r[0]["fallbacks"], r[0]["name"], r[0]["group"]), ("stali", "gpt-image-2", 1, "Cô Lan", True))
        self.assertEqual(r[1]["n"], 3)
        self.assertEqual((r[2]["ok"], r[2]["seconds"], r[2]["uid"]), (False, 5, ""), "ngoài Zalo (cron, CLI) thì không có người")

    def test_prunes_rows_older_than_90_days_once_a_day(self):
        ai_events.record("image", now=0, path=self.path)
        ai_events._state["pruned_day"] = None
        ai_events.record("image", now=91 * DAY, path=self.path)
        self.assertEqual(len(self.rows()), 1)

    def test_main_model_prefers_vision_model(self):
        home = Path(self.dir.name)
        os.environ["HERMES_HOME"] = str(home)
        self.addCleanup(os.environ.pop, "HERMES_HOME", None)
        ai_events._state["model"] = None
        (home / "config.yaml").write_text("model:\n  default: hermes\n", encoding="utf-8")
        self.assertEqual(ai_events.main_model(), "hermes")
        ai_events._state["model"] = None
        (home / "config.yaml").write_text("model:\n  default: hermes\nauxiliary:\n  vision:\n    model: gemini-vision\n", encoding="utf-8")
        self.assertEqual(ai_events.main_model(), "gemini-vision")


if __name__ == "__main__":
    unittest.main()
