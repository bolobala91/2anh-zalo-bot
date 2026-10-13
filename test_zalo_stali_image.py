"""Test nguồn vẽ ảnh Stali (stali_image.py). Không gọi mạng — requests.post được giả lập.

Chạy: npm run test:py
"""

import base64
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
from plugins.zalo_tools import stali_image as st  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


class FakeResponse:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload
        self.text = "" if payload is not None else "<html>bad gateway</html>"

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class StaliImageTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        env = {"HERMES_HOME": self.home.name, "STALI_API_KEY": "sk-stali-test-0000000000",
               "STALI_BASE_URL": "", "STALI_IMAGE_MODEL": ""}
        self.env = mock.patch.dict(os.environ, env)
        self.env.start()
        self.secret = mock.patch.object(st, "_setting", lambda name: os.environ.get(name, "").strip())
        self.secret.start()

    def tearDown(self):
        self.secret.stop()
        self.env.stop()
        self.home.cleanup()

    def test_build_request_text_and_edit(self):
        path, body = st.build_request("con mèo", "landscape", [])
        self.assertEqual(path, "/images/generations")
        self.assertEqual(body, {"model": "req/gpt-image-2", "prompt": "con mèo", "size": "1536x1024", "n": 1})
        path, body = st.build_request("giữ chủ thể", "portrait", ["https://x.vn/a.png"])
        self.assertEqual(path, "/images/edits")
        self.assertEqual(body["image"], "https://x.vn/a.png")
        self.assertEqual(body["size"], "1024x1536")
        _, body = st.build_request("ghép", "square", [f"https://x.vn/{i}.png" for i in range(6)])
        self.assertEqual(len(body["image"]), st.MAX_REFS)

    def test_local_reference_becomes_data_url(self):
        ref = os.path.join(self.home.name, "ref.png")
        with open(ref, "wb") as fh:
            fh.write(PNG)
        with mock.patch("agent.file_safety.raise_if_read_blocked", lambda p: None):
            field = st.image_field(ref)
        self.assertTrue(field.startswith("data:image/png;base64,"))
        self.assertEqual(base64.b64decode(field.split(",", 1)[1]), PNG)

    def test_error_text_names_cause_without_key(self):
        msg = st.error_text(402, {"error": {"type": "insufficient_balance", "message": "Số dư đã hết."}})
        self.assertIn("402", msg)
        self.assertIn("hết số dư", msg)
        self.assertIn("Số dư đã hết.", msg)
        self.assertNotIn("sk-stali", msg)
        self.assertIn("khoá Stali sai", st.error_text(401, None, ""))

    def test_generate_saves_b64_image(self):
        provider = st.make_provider()
        self.assertEqual(provider.name, "stali")
        self.assertTrue(provider.is_available())
        calls = []

        def post(url, json=None, headers=None, timeout=None):
            calls.append((url, json, headers))
            return FakeResponse(200, {"data": [{"b64_json": base64.b64encode(PNG).decode()}]})

        with mock.patch("requests.post", post):
            r = provider.generate("bình tam giác", "square")
        self.assertTrue(r["success"], r)
        self.assertEqual(r["provider"], "stali")
        self.assertTrue(os.path.isfile(r["image"]))
        with open(r["image"], "rb") as fh:
            self.assertEqual(fh.read(), PNG)
        url, body, headers = calls[0]
        self.assertEqual(url, "https://api.stali.vn/v1/images/generations")
        self.assertEqual(headers["Authorization"], "Bearer sk-stali-test-0000000000")
        self.assertEqual(body["model"], "req/gpt-image-2")

    def test_generate_reports_api_errors_and_missing_key(self):
        provider = st.make_provider()
        with mock.patch("requests.post", lambda *a, **k: FakeResponse(402, {"error": {"message": "Số dư đã hết."}})):
            r = provider.generate("x", "square")
        self.assertFalse(r["success"])
        self.assertIn("402", r["error"])
        with mock.patch("requests.post", lambda *a, **k: FakeResponse(502, None)):
            self.assertIn("502", provider.generate("x", "square")["error"])
        with mock.patch("requests.post", lambda *a, **k: FakeResponse(200, {"data": []})):
            self.assertEqual(provider.generate("x", "square")["error_type"], "empty_response")
        with mock.patch.dict(os.environ, {"STALI_API_KEY": ""}):
            self.assertFalse(provider.is_available())
            self.assertEqual(provider.generate("x", "square")["error_type"], "auth_required")
        self.assertEqual(provider.generate("  ", "square")["error_type"], "invalid_argument")

    def test_edit_uses_edits_endpoint(self):
        provider = st.make_provider()
        seen = {}

        def post(url, json=None, headers=None, timeout=None):
            seen.update(url=url, body=json)
            return FakeResponse(200, {"data": [{"b64_json": base64.b64encode(PNG).decode()}]})

        with mock.patch("requests.post", post):
            r = provider.generate("đổi nền", "square", image_url="https://x.vn/a.png")
        self.assertEqual(r["modality"], "image")
        self.assertTrue(seen["url"].endswith("/images/edits"))
        self.assertEqual(seen["body"]["image"], "https://x.vn/a.png")


if __name__ == "__main__":
    unittest.main()
