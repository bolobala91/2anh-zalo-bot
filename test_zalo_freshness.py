"""Test tra cứu trước khi trả lời câu hỏi cần thông tin mới (freshness.py). Không gọi mạng.

Chạy: npm run test:py
"""

import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import plugins  # noqa: E402

plugins.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.__path__)]
from plugins.zalo_tools import freshness as fr, reply_style  # noqa: E402

NOW = datetime(2026, 10, 12, 18, 13, tzinfo=timezone(timedelta(hours=7)))


class FreshnessTest(unittest.TestCase):
    def test_detects_questions_seen_in_real_chats(self):
        for q in ("phác đồ điều trị loét dạ dày hp + mới nhất. Ngắn gọn",
                  "em soạn lại là theo chỉ đạo và hướng dẫn mới nhất của thành đoàn Hải Phòng",
                  "giá vàng hôm nay", "năm nay là năm bao nhiêu", "điểm chuẩn ĐHSP Hà Nội",
                  "Nghị định mới về dạy thêm học thêm"):
            self.assertEqual(fr.kind(q), "web", q)
        self.assertEqual(fr.kind("tỉ giá 100 đô la sang VNĐ"), "fx")
        self.assertEqual(fr.kind("thời tiết Hải Phòng mai thế nào"), "weather")
        for q in ("Tạo nhắc hẹn cho tôi: 21h Hôm nay làm bài tập môn Toán.", "đánh giá giúp bài văn này",
                  "chào em", "soạn thông báo họp chi đoàn", ""):
            self.assertIsNone(fr.kind(q), q)

    def test_question_text_strips_zalo_prefixes(self):
        msg = ("[Ngữ cảnh gần nhất trong nhóm Zalo]\n- An: chào\n"
               "[Luong Dinh Trung] [Người nhắn — Trung. Lời tự khai] phác đồ HP mới nhất")
        self.assertEqual(fr.question_text(msg), "phác đồ HP mới nhất")
        self.assertEqual(fr.question_text("[Người nhắn — X]\ngiá vàng hôm nay"), "giá vàng hôm nay")

    def test_parse_results_handles_backends(self):
        exa = json.dumps({"results": [{"url": "https://a.vn/x", "title": "A", "publishedDate": "2026-10-11", "text": "nội dung " * 50}]})
        fc = json.dumps({"success": True, "data": {"web": [{"url": "https://b.vn", "title": "B", "description": "mô tả"},
                                                            {"url": "javascript:x", "title": "bad"}]}})
        a, = fr.parse_results(exa)
        self.assertEqual((a["url"], a["date"]), ("https://a.vn/x", "2026-10-11"))
        self.assertLessEqual(len(a["snippet"]), fr.SNIPPET)
        self.assertEqual([r["url"] for r in fr.parse_results(fc)], ["https://b.vn"])
        self.assertEqual(fr.parse_results("hỏng"), [])

    def test_search_query_adds_current_year_when_missing(self):
        self.assertEqual(fr.search_query("giá vàng hôm nay", NOW), "giá vàng hôm nay 2026")
        self.assertEqual(fr.search_query("điểm chuẩn 2025", NOW), "điểm chuẩn 2025")

    def test_note_has_time_sources_and_rules(self):
        note = fr.build_note("q", "web", [{"title": "Bộ Y tế", "url": "https://moh.gov.vn/x", "date": "2026-09-01", "snippet": "phác đồ"}], NOW)
        self.assertIn("lúc 18:13 12/10/2026", note)
        self.assertIn("1. Bộ Y tế (2026-09-01) — https://moh.gov.vn/x", note)
        self.assertIn("Đối chiếu ít nhất 2 nguồn", note)
        self.assertIn("không gọi là hôm nay", note)
        self.assertIn("Gọi web_search", fr.build_note("q", "web", [], NOW))
        self.assertIn("zalo_exchange_rate", fr.build_note("q", "fx", [], NOW))
        self.assertIn("zalo_weather", fr.build_note("q", "weather", [], NOW))

    def test_hook_searches_only_when_needed_on_zalo_and_obeys_setting(self):
        found = json.dumps({"results": [{"url": "https://a.vn", "title": "A", "text": "x"}]})
        with mock.patch.object(fr, "_run", return_value=found) as run, \
                mock.patch.object(reply_style, "load", return_value={**reply_style.DEFAULTS}):
            self.assertIsNone(fr.pre_llm_call(platform="telegram", user_message="giá vàng hôm nay"))
            self.assertIsNone(fr.pre_llm_call(platform="zalo", user_message="[An] chào em"))
            out = fr.pre_llm_call(platform="zalo", user_message="[An] giá vàng hôm nay")
            self.assertIn("https://a.vn", out["context"])
            self.assertEqual(run.call_count, 1)
            fr.pre_llm_call(platform="zalo", user_message="tỉ giá đô la")
            self.assertEqual(run.call_count, 1, "tỉ giá dùng công cụ riêng, không tra web")
        with mock.patch.object(reply_style, "load", return_value={**reply_style.DEFAULTS, "auto_lookup": False}):
            self.assertIsNone(fr.pre_llm_call(platform="zalo", user_message="giá vàng hôm nay"))

    def test_search_failure_still_demands_lookup(self):
        with mock.patch.object(fr, "_run", side_effect=TimeoutError()), \
                mock.patch.object(reply_style, "load", return_value={**reply_style.DEFAULTS}):
            self.assertIn("Gọi web_search", fr.pre_llm_call(platform="zalo", user_message="tin tức mới nhất về AI")["context"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
