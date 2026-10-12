"""Test cài đặt phong cách trả lời (reply_style.py), công cụ zalo_reply_style và mẫu tên tệp. Không gọi mạng.

Chạy: npm run test:py
"""

import asyncio
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import plugins  # noqa: E402

plugins.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.__path__)]
from plugins.zalo_tools import file_maker, reply_style as rs, tools  # noqa: E402
from plugins.zalo_tools.studio import jobs  # noqa: E402

NOON = datetime(2026, 10, 12, 15, 30, tzinfo=timezone(timedelta(hours=7)))


class ReplyStyleTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="zalo-style-"))
        self.addCleanup(shutil.rmtree, self.home, True)
        rs._cache.clear()
        self.enterContext(mock.patch.object(rs, "_home", return_value=self.home))

    def test_missing_or_broken_file_falls_back_to_defaults(self):
        self.assertEqual(rs.load(), rs.DEFAULTS)
        rs.path().parent.mkdir(parents=True)
        rs.path().write_text("{hỏng", encoding="utf-8")
        self.assertEqual(rs.load(), rs.DEFAULTS)

    def test_save_merges_validates_and_is_read_back(self):
        rs.save({"owner_name": "sếp", "length": "short", "colors": ["red", "green"]})
        got = rs.load()
        self.assertEqual((got["owner_name"], got["length"], got["colors"]), ("sếp", "short", ["red", "green"]))
        self.assertEqual(got["tone"], "friendly", "mục không gửi thì giữ nguyên")
        for bad in ({"length": "dài"}, {"colors": ["blue"]}, {"owner_name": "x" * 31}, {"mau": 1}):
            with self.assertRaises(rs.StyleError, msg=bad):
                rs.save(bad)
        self.assertEqual(rs.load()["owner_name"], "sếp", "lưu hỏng không đè cài đặt cũ")

    def test_note_is_short_and_reflects_settings_and_current_time(self):
        s = {**rs.DEFAULTS, "owner_name": "sếp", "colors": ["red"], "color_level": "few", "extra": "Không đùa với phụ huynh."}
        line = rs.note(s, NOON)
        self.assertIn("Bây giờ: Thứ Hai, 12/10/2026 15:30 (UTC+7).", line)
        self.assertIn('gọi chủ nhân "sếp"', line)
        self.assertIn("Màu chữ chỉ dùng [red], tô 1–2 chỗ mỗi tin.", line)
        self.assertIn("Chủ bot dặn thêm: Không đùa với phụ huynh.", line)
        self.assertLess(len(line), 600, "Hermes lưu dòng này vào lịch sử mỗi lượt — phải ngắn")
        self.assertIn("Không tô màu chữ.", rs.note({**rs.DEFAULTS, "color_level": "none"}, NOON))

    def test_hook_only_on_zalo(self):
        self.assertIsNone(rs.pre_llm_call(platform="telegram"))
        self.assertIn("Cài đặt trả lời", rs.pre_llm_call(platform="zalo")["context"])

    def test_file_name_modes(self):
        at = datetime(2026, 10, 12, 15, 30, 5).timestamp()
        self.assertEqual(rs.file_name("Báo cáo", "docx", {"file_name": "name_time"}, at), "Báo cáo_20261012-153005.docx")
        self.assertEqual(rs.file_name("Báo cáo", ".docx", {"file_name": "name_date"}, at), "Báo cáo_20261012.docx")
        self.assertEqual(rs.file_name("Báo cáo", "docx", {"file_name": "name"}, at), "Báo cáo.docx")

    def test_made_files_and_studio_outputs_follow_the_pattern(self):
        rs.save({"file_name": "name_date"})
        today = datetime.now().strftime("%Y%m%d")
        with tempfile.TemporaryDirectory() as d:
            made = file_maker.make_file("docx", "Kế hoạch tháng 10", directory=d, content="Nội dung.")
            self.assertEqual(made.name, f"Kế hoạch tháng 10_{today}.docx")
            raw = Path(d, "van-ban.pptx")
            raw.write_bytes(b"x")
            self.assertEqual([p.name for p in jobs.stamp_names([raw])], [f"van-ban_{today}.pptx"])

    def test_owner_tool_reads_and_changes_settings(self):
        got = json.loads(asyncio.run(tools.zalo_reply_style({})))
        self.assertEqual(got["result"]["owner_name"], "anh/chị")
        saved = json.loads(asyncio.run(tools.zalo_reply_style({"owner_name": "sếp", "length": "short"})))
        self.assertTrue(saved["success"])
        self.assertEqual(rs.load()["owner_name"], "sếp")
        self.assertFalse(json.loads(asyncio.run(tools.zalo_reply_style({"tone": "lạnh lùng"})))["success"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
