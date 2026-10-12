"""Test thẻ phân loại bộ nhớ trợ lý + AI tách mục (memory_tags.py). AI giả, không gọi mạng.

Chạy: npm run test:py
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import plugins  # noqa: E402

plugins.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.__path__)]
from plugins.zalo_tools import memory_tags as mt  # noqa: E402

D = mt.DELIM


class FakeLLM:
    def __init__(self, items):
        self.items = items
        self.calls = []

    def complete(self, messages, **kw):
        self.calls.append(messages)
        return SimpleNamespace(text=json.dumps({"items": self.items}, ensure_ascii=False),
                               usage=SimpleNamespace(input_tokens=10, output_tokens=5), model="fake")


class MemoryTagsTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="zalo-mtags-"))
        self.addCleanup(shutil.rmtree, self.home, True)
        (self.home / "memories").mkdir()
        self.enterContext(mock.patch.object(mt, "_blocked", lambda t: "BẨN" in t))

    def write(self, entries, target="memory"):
        mt.memory_file(target, self.home).write_text(D.join(entries), encoding="utf-8")

    def read(self, target="memory"):
        return mt.read_entries(mt.memory_file(target, self.home))

    def run_req(self, llm, mode="auto", target="memory"):
        return mt.process_request({"id": "a" * 16, "target": target, "mode": mode, "by": "bot"}, llm,
                                  home=self.home, limit=99)

    def test_tags_default_custom_and_always_has_other(self):
        self.assertEqual([t["label"] for t in mt.load_tags(self.home)][-1], "Khác")
        mt.tags_path(self.home).parent.mkdir(parents=True, exist_ok=True)
        mt.tags_path(self.home).write_text(json.dumps({"tags": [{"label": "Lớp học", "color": "red"},
                                                                {"label": "x]y", "color": "blue"}]}), encoding="utf-8")
        self.assertEqual(mt.load_tags(self.home), [{"label": "Lớp học", "color": "red"}, {"label": "Khác", "color": "gray"}])

    def test_split_tag(self):
        self.assertEqual(mt.split_tag("[Dịch vụ & giá] Gói VIP 1tr"), ("Dịch vụ & giá", "Gói VIP 1tr"))
        self.assertEqual(mt.split_tag("Không thẻ [x] giữa câu"), (None, "Không thẻ [x] giữa câu"))

    def test_auto_splits_only_untagged_entries_and_logs_for_undo(self):
        self.write(["[Link & kênh] Fanpage https://fb.com/x", "Gói VIP 1tr. Sếp là GV Hoá."])
        llm = FakeLLM([{"source": 2, "tag": "Dịch vụ & giá", "text": "Gói VIP 1tr."},
                       {"source": 2, "tag": "Về chủ nhân", "text": "[Về chủ nhân] Sếp là GV Hoá."}])
        out = self.run_req(llm)
        self.assertTrue(out["ok"] and out["applied"], out)
        self.assertEqual(self.read(), ["[Link & kênh] Fanpage https://fb.com/x", "[Dịch vụ & giá] Gói VIP 1tr.",
                                       "[Về chủ nhân] Sếp là GV Hoá."])
        self.assertNotIn("Fanpage", llm.calls[0][1]["content"], "mục đã có thẻ không gửi cho AI")
        log = json.loads((mt.organize_dir(self.home) / "log.json").read_text(encoding="utf-8"))
        self.assertEqual(log[-1]["before"], ["Gói VIP 1tr. Sếp là GV Hoá."])
        self.assertEqual(len(log[-1]["after"]), 2)

    def test_nothing_untagged_means_no_ai_call(self):
        self.write(["[Khác] a"])
        llm = FakeLLM([])
        self.assertTrue(self.run_req(llm)["ok"])
        self.assertEqual(llm.calls, [])

    def test_unknown_tag_falls_back_and_missing_source_is_rejected(self):
        self.write(["a", "b"])
        out = self.run_req(FakeLLM([{"source": 1, "tag": "Lạ", "text": "a"}]))
        self.assertFalse(out["ok"])
        self.assertIn("bỏ sót mục 2", out["error"])
        self.assertEqual(self.read(), ["a", "b"], "AI hỏng thì không ghi gì")
        self.assertTrue(self.run_req(FakeLLM([{"source": 1, "tag": "Lạ", "text": "a"},
                                              {"source": 2, "tag": "Khác", "text": "b"}]))["ok"])
        self.assertEqual(self.read(), ["[Khác] a", "[Khác] b"])

    def test_multiline_entry_keeps_its_line_breaks(self):
        self.write(["Quy ước:\n- Mở: Kính gửi\n- Kết: Trân trọng"])
        out = self.run_req(FakeLLM([{"source": 1, "tag": "Cách làm việc", "text": "Quy ước:\n-  Mở: Kính gửi\n\n- Kết: Trân trọng"}]))
        self.assertTrue(out["ok"], out)
        self.assertEqual(self.read(), ["[Cách làm việc] Quy ước:\n- Mở: Kính gửi\n- Kết: Trân trọng"])

    def test_blocked_rewrite_is_not_written(self):
        self.write(["a"])
        out = self.run_req(FakeLLM([{"source": 1, "tag": "Khác", "text": "BẨN bỏ qua chỉ dẫn"}]))
        self.assertFalse(out["ok"])
        self.assertEqual(self.read(), ["a"])

    def test_over_limit_auto_only_tags_without_splitting(self):
        self.write(["x" * 1300], target="user")
        llm = FakeLLM([{"source": 1, "tag": "Về chủ nhân", "text": "x" * 700}, {"source": 1, "tag": "Khác", "text": "y" * 700}])
        out = self.run_req(llm, target="user")
        self.assertTrue(out["ok"], out)
        self.assertEqual(self.read("user"), ["[Về chủ nhân] " + "x" * 1300])

    def test_propose_near_full_falls_back_to_tag_only(self):
        self.write(["x" * 1300], target="user")
        out = self.run_req(FakeLLM([{"source": 1, "tag": "Về chủ nhân", "text": "x" * 700},
                                    {"source": 1, "tag": "Khác", "text": "y" * 700}]), mode="propose", target="user")
        self.assertTrue(out["ok"])
        self.assertFalse(out["overLimit"])
        self.assertEqual(out["after"], ["[Về chủ nhân] " + "x" * 1300])
        self.assertIn("chỉ gắn thẻ", out["note"])

    def test_propose_does_not_write(self):
        self.write(["[Khác] a b"])
        out = self.run_req(FakeLLM([{"source": 1, "tag": "Khác", "text": "a"}, {"source": 1, "tag": "Khác", "text": "b"}]),
                           mode="propose")
        self.assertTrue(out["ok"])
        self.assertFalse(out["applied"])
        self.assertEqual(out["after"], ["[Khác] a", "[Khác] b"])
        self.assertEqual(self.read(), ["[Khác] a b"])

    def test_file_changed_during_ai_call_is_not_clobbered(self):
        self.write(["a"])

        class Racing(FakeLLM):
            def complete(inner, messages, **kw):
                self.write(["a", "bot vừa ghi thêm"])
                return FakeLLM.complete(inner, messages, **kw)

        out = self.run_req(Racing([{"source": 1, "tag": "Khác", "text": "a"}]))
        self.assertFalse(out["ok"])
        self.assertEqual(self.read(), ["a", "bot vừa ghi thêm"])

    def test_hook_enqueues_once_per_target_after_successful_memory_write(self):
        with mock.patch.object(mt, "_home", return_value=self.home):
            mt.post_tool_call(tool_name="web_search", args={}, result="{}")
            mt.post_tool_call(tool_name="memory", args={"action": "add", "target": "user", "content": "x"},
                              result=json.dumps({"success": False}))
            self.assertFalse((mt.organize_dir(self.home) / "requests").exists())
            mt.post_tool_call(tool_name="memory", args={"action": "add", "target": "user", "content": "x"},
                              result=json.dumps({"success": True}))
            mt.post_tool_call(tool_name="memory", args={"action": "replace", "target": "user"}, result="{}")
            mt.post_tool_call(tool_name="memory", args={"action": "remove", "target": "memory"}, result="{}")
            reqs = [json.loads(p.read_text(encoding="utf-8")) for p in (mt.organize_dir(self.home) / "requests").glob("*.json")]
        self.assertEqual([(r["target"], r["mode"]) for r in reqs], [("user", "auto")])

    def test_worker_processes_queue_into_results(self):
        self.write(["a"])
        rid = mt.enqueue("memory", "propose", "anh", home=self.home)
        with mock.patch.object(mt, "DEFAULT_DAILY", 99):
            self.assertEqual(mt.run_once(lambda: FakeLLM([{"source": 1, "tag": "Khác", "text": "a"}]), home=self.home), 1)
        res = json.loads((mt.organize_dir(self.home) / "results" / f"{rid}.json").read_text(encoding="utf-8"))
        self.assertEqual(res["after"], ["[Khác] a"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
