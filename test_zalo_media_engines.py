"""Test nguồn tạo ảnh/video (media_engines.py): thứ tự ưu tiên, bỏ nguồn tắt/thiếu khoá, lỗi thì sang nguồn kế,
video Stali (tạo → chờ → tải). Không gọi mạng — requests được giả lập.

Chạy: npm run test:py
"""

import asyncio
import base64
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import plugins  # noqa: E402

plugins.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.__path__)]
from plugins.zalo_tools import media_engines as me  # noqa: E402
from plugins.zalo_tools.studio import images  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + (64).to_bytes(4, "big") + (48).to_bytes(4, "big") + b"\x00" * 16
B64 = base64.b64encode(PNG).decode()


class Resp:
    def __init__(self, status, payload=None, content=b""):
        self.status_code = status
        self._payload = payload
        self.content = content
        self.text = "" if payload is not None else "<html>bad gateway</html>"

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class Base(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.env = {"HERMES_HOME": self.home.name, "STALI_API_KEY": "sk-stali-test-0000000000", "ANH_AI_KEY": "router-key-123456",
                    "ZALO_STUDIO_IMAGE_URL": "http://127.0.0.1:20128/v1"}
        patches = [mock.patch.object(me, "_hermes_home", lambda: __import__("pathlib").Path(self.home.name)),
                   mock.patch.object(me, "_setting", lambda name: self.env.get(name, "")),
                   mock.patch.object(me, "_model_conf", lambda: {}),
                   mock.patch.object(me, "_codex", lambda: None)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        me._cache.update(mtime=None, data=None)
        self.addCleanup(self.home.cleanup)

    def save(self, data):
        path = me.settings_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")
        me._cache.update(mtime=None, data=None)


class SettingsTest(Base):
    def test_defaults_and_normalize(self):
        s = me.settings()
        self.assertEqual([e["id"] for e in s["image"]["engines"]], ["stali", "9router", "codex"])
        self.assertTrue(all(e["enabled"] for e in s["image"]["engines"]))
        self.assertEqual(s["video"], {"enabled": True, "model": "seedance-2.0-fast", "seconds": 5})
        n = me.normalize({"image": {"engines": [{"id": "codex", "enabled": False}, {"id": "lạ"}, {"id": "codex"}]},
                          "video": {"model": "veo-3.1", "seconds": 7}})
        self.assertEqual([e["id"] for e in n["image"]["engines"]], ["codex", "stali", "9router"])
        self.assertFalse(n["image"]["engines"][0]["enabled"])
        self.assertEqual(n["video"]["seconds"], 6, "veo-3.1 chỉ có 4/6/8 giây")
        self.assertEqual(me.normalize({"video": {"model": "x"}})["video"]["model"], "seedance-2.0-fast")

    def test_router_model_follows_studio_setting_until_saved(self):
        self.env["ZALO_STUDIO_IMAGE_MODEL"] = "ag/gemini-3-pro-image"
        self.assertEqual(me.settings()["image"]["engines"][1]["model"], "ag/gemini-3-pro-image")
        self.save({"image": {"engines": [{"id": "9router", "model": "cx/gpt-image"}]}})
        self.assertEqual(next(e for e in me.settings()["image"]["engines"] if e["id"] == "9router")["model"], "cx/gpt-image")


class DrawTest(Base):
    def test_priority_fallback_and_skip(self):
        calls = []

        def post(url, json=None, headers=None, timeout=None):
            calls.append((url, json["model"], headers.get("Authorization")))
            if "stali" in url:
                return Resp(402, {"error": {"message": "Số dư đã hết."}})
            return Resp(200, {"data": [{"b64_json": B64}]})

        with mock.patch("requests.post", post):
            got = me.draw("con mèo", aspect="landscape")
        self.assertEqual(got["engine"], "9router")
        self.assertEqual(got["data"], PNG)
        self.assertEqual(calls[0][0], "https://api.stali.vn/v1/images/generations")
        self.assertEqual(calls[1], ("http://127.0.0.1:20128/v1/images/generations", "ag/gemini-3.1-flash-image", "Bearer router-key-123456"))
        self.assertIn("Stali: lỗi 402 (hết số dư", got["fallbacks"][0])
        self.assertNotIn("sk-stali", json.dumps(got["fallbacks"]))

        # 9router ưu tiên, Stali tắt; ChatGPT chưa đăng nhập → bỏ qua.
        self.save({"image": {"engines": [{"id": "9router"}, {"id": "stali", "enabled": False}, {"id": "codex"}]}})
        calls.clear()
        with mock.patch("requests.post", post):
            self.assertEqual(me.draw("x")["engine"], "9router")
        self.assertEqual(len(calls), 1)

    def test_all_fail_or_none_ready(self):
        with mock.patch("requests.post", lambda *a, **k: Resp(500, None)):
            with self.assertRaises(me.EngineError) as ctx:
                me.draw("x")
        self.assertIn("Stali: lỗi 500", str(ctx.exception))
        self.assertIn("9router: lỗi 500", str(ctx.exception))
        self.save({"image": {"engines": [{"id": "stali", "enabled": False}, {"id": "9router", "enabled": False}, {"id": "codex"}]}})
        with self.assertRaises(me.EngineError) as ctx:
            me.draw("x")
        self.assertIn("chưa có nguồn", str(ctx.exception))
        with self.assertRaises(me.EngineError):
            me.draw("   ")

    def test_references_use_edits_and_codex_engine(self):
        seen = {}

        def post(url, json=None, headers=None, timeout=None):
            seen.update(url=url, body=json)
            return Resp(200, {"data": [{"b64_json": B64}]})

        with mock.patch("requests.post", post):
            me.draw("đổi nền", refs=["https://x.vn/a.png", "https://x.vn/b.png"])
        self.assertTrue(seen["url"].endswith("/images/edits"))
        self.assertEqual(seen["body"]["image"], ["https://x.vn/a.png", "https://x.vn/b.png"])

        out = os.path.join(self.home.name, "codex.png")
        with open(out, "wb") as fh:
            fh.write(PNG)
        codex = mock.Mock()
        codex.is_available.return_value = True
        codex.generate.return_value = {"success": True, "image": out}
        self.save({"image": {"engines": [{"id": "codex"}]}})
        with mock.patch.object(me, "_codex", lambda: codex):
            got = me.draw("x", size="1024x1536")
        self.assertEqual((got["engine"], got["data"]), ("codex", PNG))
        self.assertEqual(codex.generate.call_args.args[1], "portrait")
        self.assertTrue(json.loads(me.status_file().read_text())["codex"], "dashboard biết máy có ChatGPT")

    def test_studio_uses_engine_order(self):
        with mock.patch("requests.post", lambda *a, **k: Resp(200, {"data": [{"b64_json": B64}]})):
            picture = asyncio.run(images.generate("tế bào", "1536x1024"))
        self.assertEqual((picture.ext, picture.data), ("png", PNG))
        with mock.patch("requests.post", lambda *a, **k: Resp(401, {"error": "bad"})):
            with self.assertRaises(images.ImageError):
                asyncio.run(images.generate("tế bào", "1536x1024"))


class VideoTest(Base):
    def test_create_poll_download(self):
        log = []
        states = iter(["in_progress", "completed"])

        def request(method, url, headers=None, timeout=None, json=None):
            log.append((method, url, json))
            if method == "POST":
                return Resp(200, {"id": "vid_1", "status": "queued"})
            if url.endswith("/content"):
                return Resp(200, {}, content=b"MP4DATA")
            return Resp(200, {"id": "vid_1", "status": next(states)})

        with mock.patch("requests.request", request):
            got = me.make_video("phố đêm", seconds=12, aspect="16:9", sleep=lambda s: None)
        self.assertEqual(got["data"], b"MP4DATA")
        self.assertEqual(log[0][2], {"model": "seedance-2.0-fast", "prompt": "phố đêm", "seconds": 10, "aspect_ratio": "16:9"})
        self.assertEqual([m for m, *_ in log], ["POST", "GET", "GET", "GET"])

    def test_failures(self):
        with mock.patch("requests.request", lambda m, u, **k: Resp(402, {"error": {"message": "Số dư đã hết."}})):
            with self.assertRaises(me.EngineError) as ctx:
                me.make_video("x")
        self.assertIn("402", str(ctx.exception))

        def failed(method, url, **k):
            return Resp(200, {"id": "v", "status": "queued" if method == "POST" else "failed", "error": {"message": "nội dung bị chặn"}})

        with mock.patch("requests.request", failed):
            with self.assertRaises(me.EngineError) as ctx:
                me.make_video("x", sleep=lambda s: None)
        self.assertIn("nội dung bị chặn", str(ctx.exception))

        clock = iter([0, 0, me.VIDEO_TIMEOUT + 1])
        with mock.patch("requests.request", lambda m, u, **k: Resp(200, {"id": "v", "status": "queued"})):
            with self.assertRaises(me.EngineError) as ctx:
                me.make_video("x", sleep=lambda s: None, clock=lambda: next(clock))
        self.assertIn("quá", str(ctx.exception))

        self.save({"video": {"enabled": False}})
        with self.assertRaises(me.EngineError) as ctx:
            me.make_video("x")
        self.assertIn("đang tắt", str(ctx.exception))


class ProviderTest(Base):
    def test_image_provider_saves_and_notes_fallback(self):
        provider = me.make_image_provider()
        self.assertEqual(provider.name, "2anh")
        self.assertTrue(provider.is_available())

        def post(url, json=None, headers=None, timeout=None):
            return Resp(429, {"error": "rate"}) if "stali" in url else Resp(200, {"data": [{"b64_json": B64}]})

        with mock.patch.dict(os.environ, {"HERMES_HOME": self.home.name}), mock.patch("requests.post", post):
            r = provider.generate("x", "square")
        self.assertTrue(r["success"], r)
        self.assertEqual(r["provider"], "2anh/9router")
        self.assertIn("Stali: lỗi 429", r["note"])
        self.assertTrue(os.path.isfile(r["image"]))
        with mock.patch("requests.post", lambda *a, **k: Resp(500, None)):
            self.assertFalse(provider.generate("x", "square")["success"])

    def test_video_provider(self):
        provider = me.make_video_provider()
        self.assertTrue(provider.is_available())
        self.env["STALI_API_KEY"] = ""
        self.assertFalse(provider.is_available())
        self.assertIn("khoá Stali", provider.generate("x")["error"])


if __name__ == "__main__":
    unittest.main()
