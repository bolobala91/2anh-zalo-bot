"""Từ khoá chủ nhân gọi bot không cần tag (hermes-plugin/zalo/call_words.py): mặc định theo tên bot, tệp dashboard thắng."""

import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("call_words", os.path.join(ROOT, "hermes-plugin", "zalo", "call_words.py"))
cw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cw)


class CallWordsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="zalo-callwords-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.path = Path(self.dir) / "call-words.json"
        cw._cache.update(path=None, mtime=None, words=None)

    def test_defaults_match_previous_behaviour(self):
        words = cw.owner_words("Lăng Tiêu", path=self.path)
        texts = {(w["text"], w["at"]) for w in words}
        self.assertIn(("tiêu", "start"), texts)
        self.assertIn(("lăng tiêu", "start"), texts)
        self.assertIn(("chao tieu".replace("tieu", "tiêu"), "any"), texts)
        for msg, ok in [("tiêu ơi tra giúp", True), ("Chào Tiêu", True), ("tiêu tra giá vàng", True), ("nhờ tiêu với", True),
                        ("tiêu", True), ("hôm nay tiêu nhiều tiền", False), ("tiêuxài", False)]:
            self.assertEqual(cw.matches(msg.lower(), words), ok, msg)
        self.assertEqual(cw.default_words(""), [])

    def test_dashboard_file_wins_and_reloads_on_change(self):
        self.path.write_text(json.dumps({"version": 1, "owner": [{"text": "  Sếp   Gọi ", "at": "start"}, {"text": "em ơi", "at": "any"}]}), encoding="utf-8")
        words = cw.owner_words("Lăng Tiêu", path=self.path)
        self.assertEqual(words, [{"text": "sếp gọi", "at": "start"}, {"text": "em ơi", "at": "any"}])
        self.assertTrue(cw.matches("sếp gọi nè", words))
        self.assertFalse(cw.matches("tiêu ơi", words), "đã sửa thì mặc định cũ không còn")
        self.path.write_text(json.dumps({"version": 1, "owner": []}), encoding="utf-8")
        os.utime(self.path, (1, 1))
        self.assertEqual(cw.owner_words("Lăng Tiêu", path=self.path), [], "danh sách rỗng = chủ nhân cũng phải tag")

    def test_broken_file_falls_back_to_defaults(self):
        self.path.write_text("{hỏng", encoding="utf-8")
        self.assertTrue(cw.matches("tiêu ơi", cw.owner_words("Lăng Tiêu", path=self.path)))


if __name__ == "__main__":
    unittest.main()
