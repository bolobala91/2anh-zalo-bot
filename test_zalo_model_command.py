import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = os.path.dirname(__file__)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from gateway.config import PlatformConfig
import plugins
import plugins.platforms

# Giống test_zalo_adapter.py: test plugin trong repo, dùng lõi Hermes đã cài.
plugins.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.__path__)]
plugins.platforms.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.platforms.__path__)]
from plugins.platforms.zalo import adapter as zalo_adapter
from plugins.platforms.zalo import model_command
from plugins.zalo_tools import tools as zalo_tools

CONFIG = (
    "# cấu hình viết tay\r\n"
    "model:\r\n"
    "  default: hermes  # combo chính\r\n"
    "  provider: custom\r\n"
    "  base_url: http://127.0.0.1:20128/v1\r\n"
    "  api_key: sk-test\r\n"
    "fallback:\r\n"
    "  default: khong-duoc-dung\r\n"
)
AVAILABLE = ["hermes", "ag/gemini-3.8-flash-medium", "ag/claude-opus-4-6-thinking", "cx/gpt-5.6-terra"]


class ModelCommandTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = Path(self.tmp.name) / "config.yaml"
        self.config.write_bytes(CONFIG.encode("utf-8"))

    def tearDown(self):
        self.tmp.cleanup()

    def run_cmd(self, args, choices=(), default="hermes", fetch=lambda _p: list(AVAILABLE)):
        return model_command.handle(args, config_path=self.config, choices=list(choices),
                                    default=default, fetch=fetch)

    def test_parse_only_matches_model_command(self):
        self.assertEqual(model_command.parse(" /model "), "")
        self.assertEqual(model_command.parse("/MODEL list all"), "list all")
        self.assertIsNone(model_command.parse("/models"))
        self.assertIsNone(model_command.parse("đổi /model đi"))

    def test_show_current(self):
        self.assertIn("Model đang dùng: hermes", self.run_cmd(""))

    def test_switch_rewrites_only_model_default_line(self):
        reply = self.run_cmd("ag/claude-opus-4-6-thinking")
        self.assertIn("Đã đổi cả bot sang ag/claude-opus-4-6-thinking", reply)
        expected = CONFIG.replace("default: hermes  #", "default: ag/claude-opus-4-6-thinking  #")
        self.assertEqual(self.config.read_bytes().decode("utf-8"), expected)
        self.assertEqual(model_command.current_model(self.config), "ag/claude-opus-4-6-thinking")

    def test_default_goes_back(self):
        self.run_cmd("cx/gpt-5.6-terra")
        self.assertIn("Đã đổi cả bot sang hermes", self.run_cmd("default"))
        self.assertEqual(self.config.read_bytes().decode("utf-8"), CONFIG)

    def test_default_unset_explains(self):
        self.assertIn("ZALO_MODEL_DEFAULT", self.run_cmd("default", default=""))

    def test_unknown_model_is_refused_with_suggestion(self):
        reply = self.run_cmd("ag/gemini-3.8-flash-medum")
        self.assertIn("Không có model", reply)
        self.assertIn("ag/gemini-3.8-flash-medium", reply)
        self.assertEqual(self.config.read_bytes().decode("utf-8"), CONFIG)

    def test_endpoint_down_does_not_switch(self):
        def boom(_path):
            raise OSError("connection refused")
        self.assertIn("chưa đổi", self.run_cmd("cx/gpt-5.6-terra", fetch=boom))
        self.assertEqual(self.config.read_bytes().decode("utf-8"), CONFIG)

    def test_same_model_is_a_no_op(self):
        self.assertIn("đang dùng hermes rồi", self.run_cmd("hermes"))

    def test_list_uses_choices_and_marks_current_and_default(self):
        reply = self.run_cmd("list", choices=["hermes", "ag/claude-opus-4-6-thinking"])
        self.assertIn("- hermes (đang dùng, mặc định)", reply)
        self.assertIn("- ag/claude-opus-4-6-thinking", reply)
        self.assertNotIn("cx/gpt-5.6-terra", reply)

    def test_list_all_and_filter(self):
        self.assertIn("Tất cả model (4)", self.run_cmd("list all", choices=["hermes"]))
        reply = self.run_cmd("list claude")
        self.assertIn("ag/claude-opus-4-6-thinking", reply)
        self.assertNotIn("cx/gpt-5.6-terra", reply)

    def test_fetch_models_reads_endpoint_from_config(self):
        seen = {}

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return json.dumps({"data": [{"id": "a"}, {"id": "b"}]}).encode()

        def fake_urlopen(request, timeout):
            seen["url"] = request.full_url
            seen["auth"] = request.get_header("Authorization")
            return FakeResponse()

        with patch.object(model_command.urllib.request, "urlopen", fake_urlopen):
            self.assertEqual(model_command.fetch_models(self.config), ["a", "b"])
        self.assertEqual(seen, {"url": "http://127.0.0.1:20128/v1/models", "auth": "Bearer sk-test"})


class ZaloModelCommandAdapterTest(unittest.IsolatedAsyncioTestCase):
    OWNER = "1111111111111111111"

    def make_adapter(self):
        adapter = zalo_adapter.ZaloAdapter(PlatformConfig(enabled=True, extra={
            "bridge_url": "ws://127.0.0.1:9", "reply_only_tagged": True, "ack_gestures": False,
            "model_choices": ["hermes", "ag/claude-opus-4-6-thinking"], "model_default": "hermes",
        }))
        adapter._self_profile = {"user_id": "bot-uid", "display_name": "Lăng Tiêu"}
        adapter._flood.check = lambda _uid: None
        self.forwarded, self.sent = [], []

        async def handle(event):
            self.forwarded.append(event)

        async def fake_command(command, expect_ack=False):
            self.sent.append(command)
            return {"ok": True, "msgId": "reply-1"}

        adapter.handle_message = handle
        adapter._command = fake_command
        return adapter

    def frame(self, uid, text):
        return {"type": "message", "id": f"m-{uid}-{len(text)}", "threadId": "group-1",
                "threadType": zalo_adapter.THREAD_TYPE_GROUP, "senderUid": uid,
                "senderName": uid, "text": text, "mentions": [{"uid": "bot-uid"}]}

    async def run_frame(self, uid, text, home):
        adapter = self.make_adapter()
        with patch.object(adapter, "_is_owner", side_effect=lambda u: u == self.OWNER), \
                patch.object(zalo_adapter, "_zalo_tools", return_value=zalo_tools), \
                patch("hermes_constants.get_hermes_home", return_value=Path(home)):
            await adapter._on_message(self.frame(uid, text))

    async def test_owner_gets_answer_and_command_never_reaches_hermes(self):
        with tempfile.TemporaryDirectory() as home:
            Path(home, "config.yaml").write_text(CONFIG, encoding="utf-8")
            await self.run_frame(self.OWNER, "@Lăng Tiêu /model list", home)
        self.assertEqual(self.forwarded, [])
        self.assertEqual(len(self.sent), 1)
        self.assertIn("- ag/claude-opus-4-6-thinking", self.sent[0]["text"])

    async def test_stranger_model_command_is_dropped(self):
        with tempfile.TemporaryDirectory() as home:
            Path(home, "config.yaml").write_text(CONFIG, encoding="utf-8")
            await self.run_frame("2222222222222222222", "@Lăng Tiêu /model ag/claude-opus-4-6-thinking", home)
            self.assertEqual(model_command.current_model(Path(home, "config.yaml")), "hermes")
        self.assertEqual(self.forwarded, [])
        self.assertEqual(self.sent, [])


if __name__ == "__main__":
    unittest.main()
