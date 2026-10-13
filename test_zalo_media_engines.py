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
        self.assertEqual(log[0][2], {"model": "seedance-2.0-fast", "prompt": "phố đêm", "seconds": "10", "size": "1280x720"},
                         "khung hình gửi qua size, seconds là chuỗi — Stali từ chối aspect_ratio / seconds số")
        self.assertEqual(got["aspect"], "16:9")
        self.assertEqual([m for m, *_ in log], ["POST", "GET", "GET", "GET"])
        self.assertEqual(me.video_size("veo-3.1", "1:1"), ("9:16", "720x1280"), "Veo không có khung vuông")
        self.assertEqual(me.video_size("seedance-2.5", "21:9"), ("21:9", "1680x720"))
        self.assertEqual(me.video_size("google-omni-flash", "lạ"), ("9:16", "720x1280"))

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


class BackgroundVideoTest(Base):
    TURN = {"thread_id": "g1", "is_group": True, "is_owner": True, "sender_uid": "u1"}

    def test_zalo_turn_answers_now_and_delivers_later(self):
        provider = me.make_video_provider()
        started = []

        def request(method, url, headers=None, timeout=None, json=None):
            return Resp(200, {"id": "vid_9", "status": "queued"})

        with mock.patch.object(me, "_zalo_turn", lambda: dict(self.TURN)), \
                mock.patch.object(me, "start_background", lambda turn, job, prompt, save: started.append((turn, job, prompt))), \
                mock.patch("requests.request", request):
            r = provider.generate("phố đêm  Hà Nội", duration=5, aspect_ratio="9:16")
        self.assertTrue(r["success"])
        self.assertEqual(r["status"], "dang_tao")
        self.assertIsNone(r["video"])
        self.assertIn("TỰ GỬI", r["message"])
        self.assertEqual(started[0][0]["thread_id"], "g1")
        self.assertEqual(started[0][1]["id"], "vid_9")
        self.assertEqual(started[0][2], "phố đêm Hà Nội")

    def test_submit_error_is_reported_immediately(self):
        provider = me.make_video_provider()
        with mock.patch.object(me, "_zalo_turn", lambda: dict(self.TURN)), \
                mock.patch("requests.request", lambda *a, **k: Resp(402, {"error": {"message": "Số dư đã hết."}})):
            r = provider.generate("x")
        self.assertFalse(r["success"])
        self.assertIn("402", r["error"])
        me._background.update({f"v{i}": {} for i in range(me.MAX_BACKGROUND)})
        self.addCleanup(me._background.clear)
        with mock.patch.object(me, "_zalo_turn", lambda: dict(self.TURN)):
            self.assertIn("đang có 3 video chờ", provider.generate("x")["error"])

    def test_background_sends_video_or_error_to_the_same_chat(self):
        sent = []
        send = lambda turn, payload: sent.append((turn["thread_id"], payload)) or True  # noqa: E731
        job = {"id": "vid_1", "model": "seedance-2.0-fast", "seconds": 5}
        me._background["vid_1"] = {}
        me._finish_in_background(dict(self.TURN), job, "phố đêm", save=lambda data, prefix: f"/cache/{prefix}.mp4",
                                 wait=lambda job, timeout: b"MP4", send=send)
        self.assertEqual(sent, [("g1", {"msg": "🎬 Video 5 giây: phố đêm", "attachments": ["/cache/stali_seedance-2.0-fast.mp4"]})])
        self.assertNotIn("vid_1", me._background, "xong thì bỏ khỏi danh sách chờ")

        sent.clear()

        def boom(job, timeout):
            raise me.EngineError("Stali không tạo được video: nội dung bị chặn")

        me._finish_in_background(dict(self.TURN), job, "x", save=None, wait=boom, send=send)
        self.assertEqual(sent, [("g1", {"msg": "Chưa tạo được video (Stali không tạo được video: nội dung bị chặn)."})])


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


class MediaToolTest(Base):
    """Công cụ công khai zalo_media: nút Vẽ ảnh AI / Tạo video AI + hạn mức mỗi ngày cho người không phải chủ nhân."""

    def setUp(self):
        super().setUp()
        from plugins.zalo_tools import tools
        self.tools = tools
        self.sent = []

        async def invoke(method, args):
            self.sent.append((method, args))
            return json.dumps({"success": True})

        for p in (mock.patch.object(tools, "_invoke", invoke),
                  mock.patch.object(tools, "_media_usage_path", lambda: __import__("pathlib").Path(self.home.name) / "usage.json"),
                  mock.patch.object(tools.group_permissions, "media_quotas", lambda uid, tid, g: {"image": 2, "video": 1})):
            p.start()
            self.addCleanup(p.stop)

    def call(self, turn, args):
        token = self.tools._TURN.set(turn)
        try:
            return json.loads(asyncio.run(self.tools.zalo_media(args)))
        finally:
            self.tools._TURN.reset(token)

    def test_member_image_quota_and_delivery(self):
        member = {"sender_uid": "u5", "thread_id": "g1", "is_group": True, "is_owner": False}
        with mock.patch("requests.post", lambda *a, **k: Resp(200, {"data": [{"b64_json": B64}]})), \
                mock.patch.dict(os.environ, {"HERMES_HOME": self.home.name}):
            self.assertTrue(self.call(member, {"kind": "image", "prompt": "con mèo"})["success"])
            self.assertTrue(self.call(member, {"kind": "image", "prompt": "con chó"})["success"])
            out = self.call(member, {"kind": "image", "prompt": "con gà"})
        self.assertFalse(out["success"])
        self.assertIn("đã dùng hết 2 ảnh", out["error"])
        self.assertEqual([m for m, _ in self.sent], ["sendMessage", "sendMessage"])
        self.assertEqual(self.sent[0][1][1], "g1", "gửi vào đúng nhóm đang hỏi")

    def test_failed_draw_gives_the_turn_back_and_refs_are_fenced(self):
        member = {"sender_uid": "u6", "thread_id": "g1", "is_group": True, "is_owner": False}
        with mock.patch("requests.post", lambda *a, **k: Resp(402, {"error": "het tien"})):
            out = self.call(member, {"kind": "image", "prompt": "x"})
        self.assertFalse(out["success"])
        self.assertEqual(self.tools._media_used("u6", "image"), 0, "lỗi thì trả lại lượt")
        out = self.call(member, {"kind": "image", "prompt": "x", "images": [str(self.home.name) + "/../secret.env"]})
        self.assertIn("ảnh mẫu", out["error"])

    def test_switch_gate_by_kind(self):
        turn = {"sender_uid": "u7", "thread_id": "g1", "is_group": True, "is_owner": False}
        rules = {"features": {"studioImage": True, "studioAIVideo": False}}
        with mock.patch.object(self.tools, "_studio_rules", lambda t: rules):
            self.assertIsNone(self.tools._studio_block(turn, {"kind": "image"}, "zalo_media"))
            blocked = self.tools._studio_block(turn, {"kind": "video"}, "zalo_media")
        self.assertEqual(blocked["action"], "block")
        self.assertIn("tạo video AI", blocked["message"])
