"""Trí nhớ dài hạn theo phạm vi (spec §19): provider zalo_memory chạy với máy chủ OpenViking GIẢ.

Không bao giờ gọi OpenViking thật: mọi test dựng một máy chủ HTTP giả trên cổng ngẫu nhiên.
"""

import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import plugins  # noqa: E402
import plugins.memory  # noqa: E402

# Kiểm thêm với một bản plugin OpenViking khác thay cho bản chép kèm zalo_memory/openviking_base
# (vd. bản mới của Hermes): ZALO_OV_BASE_DIR=<thư mục openviking>.
_ALT_BASE = os.environ.get("ZALO_OV_BASE_DIR")
if _ALT_BASE:
    _spec = importlib.util.spec_from_file_location(
        "plugins.memory.zalo_memory.openviking_base", os.path.join(_ALT_BASE, "__init__.py"),
        submodule_search_locations=[_ALT_BASE])
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules["plugins.memory.zalo_memory.openviking_base"] = _mod
    _spec.loader.exec_module(_mod)

plugins.memory.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.memory.__path__)]
from plugins.memory import zalo_memory as zm  # noqa: E402

BASE = sys.modules[zm.OpenVikingMemoryProvider.__module__]

plugins.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.__path__)]
from plugins.zalo_tools import memory_store  # noqa: E402
from plugins.zalo_tools import tools as zalo_tools  # noqa: E402

GROUP_A = "2054797107487294899"
GROUP_B = "2054797107487294811"
OWNER = "1234567890123456789"


class FakeOpenViking:
    """Máy chủ OpenViking giả: ghi lại mọi yêu cầu; tìm kiếm cố tình trả lẫn kết quả của phạm vi khác (như ROOT ở dev)."""

    def __init__(self):
        self.requests = []
        self.profiles = {}
        self.pending = 0
        self.commit_status = 200
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_a):
                pass

            def _reply(self, payload, status=200):
                body = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _handle(self, method):
                url = urlparse(self.path)
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}") if length else {}
                user = self.headers.get("X-OpenViking-User", "")
                fake.requests.append({
                    "method": method, "path": url.path, "query": parse_qs(url.query), "body": body, "user": user,
                    "account": self.headers.get("X-OpenViking-Account", ""), "peer": self.headers.get("X-OpenViking-Actor-Peer"),
                    "key": self.headers.get("X-API-Key") or self.headers.get("Authorization") or "",
                })
                if url.path == "/health":
                    return self._reply({"status": "ok", "healthy": True, "version": "0.4.13", "auth_mode": "dev"})
                if url.path == "/api/v1/system/status":
                    return self._reply({"status": "ok", "result": {"initialized": True, "user": user or "default"}})
                if url.path == "/api/v1/search/find":
                    hits = [
                        {"uri": f"{body.get('target_uri', 'viking://user/x/memories')}/preferences/mem_1.md",
                         "abstract": f"Ghi nhớ của {user}", "score": 0.9, "context_type": "memory", "category": "preferences"},
                        {"uri": "viking://user/zalo-u-1234567890123456789/memories/preferences/mem_owner.md",
                         "abstract": "BÍ MẬT TRONG TIN NHẮN RIÊNG CỦA CHỦ", "score": 0.99, "context_type": "memory",
                         "category": "preferences"},
                    ]
                    return self._reply({"status": "ok", "result": {"memories": hits, "resources": [], "skills": []}})
                if url.path == "/api/v1/content/read":
                    uri = (parse_qs(url.query).get("uri") or [""])[0]
                    if uri in fake.profiles:
                        return self._reply({"status": "ok", "result": fake.profiles[uri]})
                    return self._reply({"status": "error", "error": {"code": "NOT_FOUND"}}, 404)
                if url.path == "/api/v1/fs/ls":
                    return self._reply({"status": "ok", "result": []})
                if url.path.endswith("/commit") and fake.commit_status != 200:
                    return self._reply({"status": "error", "error": {"code": "UNAUTHENTICATED"}}, fake.commit_status)
                if url.path.startswith("/api/v1/sessions/") and method == "GET":
                    return self._reply({"status": "ok", "result": {"pending_tokens": fake.pending}})
                return self._reply({"status": "ok", "result": {}})

            def do_GET(self):
                self._handle("GET")

            def do_POST(self):
                self._handle("POST")

            def do_DELETE(self):
                self._handle("DELETE")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def where(self, path):
        return [r for r in self.requests if r["path"] == path]


def wait_for(predicate, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


class ZaloMemoryTestBase(unittest.TestCase):
    def setUp(self):
        self.ov = FakeOpenViking()
        self.addCleanup(self.ov.close)
        self.home = tempfile.mkdtemp(prefix="zalo-mem-")
        env = {"OPENVIKING_ENDPOINT": self.ov.url, "OPENVIKING_ACCOUNT": "default", "OPENVIKING_USER": "default"}
        self.enterContext(patch.dict(os.environ, env))
        os.environ.pop("OPENVIKING_API_KEY", None)
        self.enterContext(patch.object(zm, "_host_platform", return_value="linux"))
        self.enterContext(patch.object(zm, "BUDGET", zm.DailyBudget()))
        self.providers = []

    def tearDown(self):
        for provider in self.providers:
            provider.shutdown()

    def provider(self, *, platform="zalo", chat_type="group", chat_id=GROUP_A, session_id="s-1"):
        p = zm.ZaloMemoryProvider()
        self.providers.append(p)
        self.assertTrue(p.is_available())
        p.initialize(session_id, platform=platform, chat_type=chat_type, chat_id=chat_id, hermes_home=self.home)
        return p


class ScopeTest(unittest.TestCase):
    def test_scope_is_per_group_and_per_person_and_nothing_else(self):
        self.assertEqual(zm.scope_user("zalo", "group", GROUP_A), f"zalo-g-{GROUP_A}")
        self.assertEqual(zm.scope_user("zalo", "dm", OWNER), f"zalo-u-{OWNER}")
        for args in [("cli", "dm", OWNER), ("cron", "group", GROUP_A), ("api_server", "dm", OWNER),
                     ("telegram", "group", GROUP_A), ("zalo", "channel", GROUP_A), ("zalo", "group", "../x"),
                     ("zalo", "group", ""), ("zalo", "dm", None)]:
            with self.subTest(args=args):
                self.assertIsNone(zm.scope_user(*args))

    def test_daily_budget_caps_scope_and_total_and_resets_next_day(self):
        now = [1_760_000_000.0]
        budget = zm.DailyBudget(per_scope=2, total=3, clock=lambda: now[0])
        self.assertEqual([budget.take("a"), budget.take("a"), budget.take("a")], [True, True, False])
        self.assertEqual([budget.take("b"), budget.take("c")], [True, False])
        now[0] += 86_400
        self.assertTrue(budget.take("a"))

    def test_fails_closed_when_hermes_openviking_plugin_changes_shape(self):
        self.assertTrue(zm.base_compatible())

        class Renamed(zm.OpenVikingMemoryProvider):
            def _search_prefetch_context(self, query, **kw):  # không còn gọi _post_prefetch_search
                return self._client.post("/api/v1/search/find", {"query": query})

        self.assertFalse(zm.base_compatible(Renamed))
        with patch.dict(os.environ, {"OPENVIKING_ENDPOINT": "http://127.0.0.1:1"}), \
                patch.object(zm, "_host_platform", return_value="linux"), \
                patch.object(zm, "base_compatible", return_value=False):
            self.assertFalse(zm.ZaloMemoryProvider().is_available())

    def test_never_available_on_windows_or_with_api_key(self):
        with patch.dict(os.environ, {"OPENVIKING_ENDPOINT": "http://127.0.0.1:1"}):
            with patch.object(zm, "_host_platform", return_value="win32"):
                self.assertFalse(zm.ZaloMemoryProvider().is_available())
            with patch.object(zm, "_host_platform", return_value="linux"):
                self.assertTrue(zm.ZaloMemoryProvider().is_available())
                with patch.dict(os.environ, {"OPENVIKING_API_KEY": "k"}):
                    self.assertFalse(zm.ZaloMemoryProvider().is_available())


class IsolationTest(ZaloMemoryTestBase):
    def test_every_request_carries_only_the_session_scope_identity(self):
        p = self.provider()
        p.prefetch("nhóm mình hay họp hôm nào nhỉ")
        p.sync_turn("nhắc lại lịch họp tổ giúp mình", "Tổ họp thứ Năm hằng tuần.", session_id="s-1")
        self.assertTrue(wait_for(lambda: self.ov.where("/api/v1/sessions/s-1/messages/batch")))
        scoped = [r for r in self.ov.requests if r["path"] != "/health"]
        self.assertTrue(scoped)
        for r in scoped:
            with self.subTest(path=r["path"]):
                self.assertEqual((r["account"], r["user"], r["peer"]), ("zalo", f"zalo-g-{GROUP_A}", None))

    def test_recall_targets_only_this_group_and_drops_foreign_hits(self):
        p = self.provider()
        context = p.prefetch("hôm trước nhóm thống nhất gì về lịch trực")
        find = self.ov.where("/api/v1/search/find")
        self.assertEqual(len(find), 1)
        self.assertEqual(find[0]["body"]["target_uri"], f"viking://user/zalo-g-{GROUP_A}/memories")
        self.assertEqual(find[0]["body"]["context_type"], "memory")
        self.assertEqual(self.ov.where("/api/v1/search/search"), [], "không dùng search/search (gọi LLM mỗi lượt)")
        self.assertIn(f"Ghi nhớ của zalo-g-{GROUP_A}", context)
        self.assertNotIn("BÍ MẬT", context, "kết quả ngoài phạm vi bị lọc dù máy chủ trả lẫn")

    def test_owner_dm_profile_never_reaches_a_group_session(self):
        self.ov.profiles[f"viking://user/zalo-u-{OWNER}/memories/profile.md"] = "Chủ nhân sắp nghỉ việc (riêng tư)"
        self.ov.profiles[f"viking://user/zalo-g-{GROUP_A}/memories/profile.md"] = "Nhóm Tổ Hoá, xưng cô–em"
        group = self.provider(session_id="g-1")
        text = group.prefetch("chào Nhi, hôm nay có gì mới")
        self.assertIn("Nhóm Tổ Hoá", text)
        self.assertNotIn("nghỉ việc", text)
        owner_dm = self.provider(chat_type="dm", chat_id=OWNER, session_id="dm-1")
        self.assertIn("nghỉ việc", owner_dm.prefetch("em nhớ chuyện anh kể hôm qua không"))
        reads = [r["query"]["uri"][0] for r in self.ov.where("/api/v1/content/read")]
        self.assertIn(f"viking://user/zalo-g-{GROUP_A}/memories/profile.md", reads)
        group_reads = [r for r in self.ov.where("/api/v1/content/read") if r["user"] == f"zalo-g-{GROUP_A}"]
        self.assertTrue(all(f"zalo-g-{GROUP_A}/" in r["query"]["uri"][0] for r in group_reads))

    def test_two_groups_in_one_process_never_share_identity(self):
        a = self.provider(chat_id=GROUP_A, session_id="a")
        b = self.provider(chat_id=GROUP_B, session_id="b")
        a.sync_turn("nhóm A chốt mua máy chiếu", "Đã ghi nhận.", session_id="a")
        b.sync_turn("nhóm B hỏi lịch thi", "Thi ngày 20.", session_id="b")
        self.assertTrue(wait_for(lambda: len([r for r in self.ov.requests if r["path"].endswith("/messages/batch")]) == 2))
        by_path = {r["path"]: r["user"] for r in self.ov.requests if r["path"].endswith("/messages/batch")}
        self.assertEqual(by_path, {"/api/v1/sessions/a/messages/batch": f"zalo-g-{GROUP_A}",
                                   "/api/v1/sessions/b/messages/batch": f"zalo-g-{GROUP_B}"})

    def test_recall_drops_hits_with_unsafe_uris_even_under_this_scope(self):
        root = f"viking://user/zalo-g-{GROUP_A}/memories"
        good = f"{root}/preferences/mem_1.md"
        self.assertTrue(zm.in_scope_uri(good, root))
        # OpenViking đặt tên tệp trí nhớ bằng tiếng Việt có dấu cách thường — phải giữ.
        self.assertTrue(zm.in_scope_uri(f"{root}/events/2026/10/09/thiết lập mã bí mật cuộc trò chuyện.md", root))
        for bad in [f"{root}/../../zalo-u-{OWNER}/memories/a.md", f"{root}/%2e%2e/%2e%2e/zalo-u-{OWNER}/a.md",
                    f"{root}/a%2fb.md", f"{root}\\..\\x.md", f"{root}/a.md?uri=x", f"{root}/a.md#x",
                    f"{root}/a\tb.md", f"{root}/a b.md", f"{root}/a b.md", f"{root}/a\x00b.md",
                    f"{root}/a\n.md", f"{root}/a\r.md", root, f"{root}X/a.md", "", None]:
            with self.subTest(uri=bad):
                self.assertFalse(zm.in_scope_uri(bad, root))
        p = self.provider()

        class Client:
            def post(self, path, body, timeout=None):
                return {"result": {"memories": [{"uri": good}, {"uri": f"{root}/%2e%2e/%2e%2e/zalo-u-{OWNER}/a.md"},
                                                {"uri": f"{root}/../x.md"}, "rác"]}}

        resp = p._post_prefetch_search(Client(), "q", "s-1", limit=4, context_type="memory",
                                       deadline=time.monotonic() + 1, request_timeout=1)
        self.assertEqual([h["uri"] for h in resp["result"]["memories"]], [good])

    def test_client_slot_never_holds_an_unscoped_identity(self):
        p = self.provider()
        scope = f"zalo-g-{GROUP_A}"
        ident = lambda c: (c._account, c._user, c._agent)  # noqa: E731
        self.assertEqual(ident(p._client), ("zalo", scope, ""), "ngay sau initialize")
        # Lớp gốc dựng lại client mặc định khi đang giữ khoá (đổi cấu hình) — vẫn ra client theo phạm vi.
        with patch.dict(os.environ, {"OPENVIKING_USER": "someone-else"}), p._client_refresh_lock:
            p._ensure_client_locked()
            self.assertEqual(ident(p._client), ("zalo", scope, ""))
        p._client = zm._VikingClient(self.ov.url, "", account="default", user="default", agent="hermes")
        self.assertEqual(ident(p._client), ("zalo", scope, ""))
        p._client = zm._VikingClient(self.ov.url, "k-sneaky", account="default", user="default")
        self.assertIsNone(p._client, "client mang khoá → bỏ")
        p._ensure_client()
        self.ov.requests.clear()
        if hasattr(p, "_session_has_pending_tokens"):  # bản lớp gốc trên VPS không có hàm này
            p._session_has_pending_tokens("s-1")
        p._commit_session("s-1", 1, context="test")
        p._session_start_memory_context("s-9")
        sent = [r for r in self.ov.requests if r["path"] != "/health"]
        self.assertTrue(sent)
        self.assertEqual({(r["account"], r["user"], r["key"]) for r in sent}, {("zalo", scope, "")})
        inert = zm.ZaloMemoryProvider()
        inert._client = zm._VikingClient(self.ov.url, "", account="default", user="default")
        self.assertIsNone(inert._client, "chưa có phạm vi thì không giữ client nào")

    def test_non_zalo_sessions_are_inert(self):
        for platform, chat_type, chat_id in [("cli", None, None), ("cron", None, None), ("api_server", "dm", OWNER)]:
            p = self.provider(platform=platform, chat_type=chat_type, chat_id=chat_id)
            self.assertEqual(p.prefetch("bất kỳ câu hỏi nào đủ dài"), "")
            p.sync_turn("một lượt bất kỳ đủ dài", "trả lời", session_id="s-x")
            self.assertEqual(p.system_prompt_block(), "")
        self.assertEqual(self.ov.requests, [], "không một yêu cầu nào tới OpenViking")


class ApiKeyTest(ZaloMemoryTestBase):
    """Có khoá API từ BẤT KỲ nguồn nào lớp gốc đọc (env, hồ sơ ovcli…) → tắt, không gửi khoá đi; không rõ nguồn → tắt."""

    def ovcli(self, data):
        path = os.path.join(self.home, "ovcli.conf")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        self.enterContext(patch.dict(os.environ, {"OPENVIKING_CLI_CONFIG_FILE": path}))
        self.enterContext(patch.object(BASE, "_load_hermes_openviking_config", return_value={"use_ovcli_config": True}))

    def test_key_from_ovcli_profile_disables_provider_and_sends_nothing(self):
        self.ovcli({"url": self.ov.url, "api_key": "k-ovcli"})
        self.assertTrue(zm.api_key_would_be_sent())
        p = zm.ZaloMemoryProvider()
        self.providers.append(p)
        self.assertFalse(p.is_available())
        p.initialize("s-1", platform="zalo", chat_type="group", chat_id=GROUP_A, hermes_home=self.home)
        self.assertEqual(p.prefetch("hôm trước nhóm thống nhất gì về lịch trực"), "")
        p.sync_turn("nhóm chốt lịch trực tuần sau", "Đã ghi nhận.", session_id="s-1")
        self.assertEqual(p.system_prompt_block(), "")
        time.sleep(0.2)
        self.assertEqual(self.ov.requests, [], "không một yêu cầu nào, càng không gửi khoá")

    def test_ovcli_profile_without_key_stays_available(self):
        self.ovcli({"url": self.ov.url})
        self.assertFalse(zm.api_key_would_be_sent())
        self.assertTrue(zm.ZaloMemoryProvider().is_available())

    def test_unknown_key_source_fails_closed(self):
        with patch.object(BASE, "_resolve_connection_settings", side_effect=RuntimeError("đổi cấu trúc")):
            self.assertTrue(zm.api_key_would_be_sent())
            self.assertFalse(zm.ZaloMemoryProvider().is_available())
        with patch.object(BASE, "_load_hermes_openviking_config", side_effect=ValueError("config.yaml hỏng")):
            self.assertFalse(zm.ZaloMemoryProvider().is_available())

    def test_key_appearing_after_start_stops_all_traffic_and_never_sends_the_key(self):
        p = self.provider()
        p.prefetch("nhóm mình hay họp hôm nào nhỉ")
        before = len(self.ov.requests)
        self.assertGreater(before, 0)
        with patch.dict(os.environ, {"OPENVIKING_API_KEY": "k-late"}):
            self.assertEqual(p.prefetch("hôm trước nhóm thống nhất gì về lịch trực"), "")
            p.sync_turn("nhóm chốt lịch trực tuần sau", "Đã ghi nhận.", session_id="s-1")
            time.sleep(0.3)
        self.assertEqual(len(self.ov.requests), before)
        self.assertEqual([r for r in self.ov.requests if r["key"]], [])

    def test_client_carrying_a_key_is_refused_even_if_resolver_missed_it(self):
        p = self.provider()
        keyed = zm._VikingClient(self.ov.url, "k-sneaky", account="default", user="default")
        with self.assertRaises(zm._ApiKeyRefused):
            p._rescope(keyed)
        with patch.object(zm.OpenVikingMemoryProvider, "_ensure_client", return_value=keyed):
            self.assertIsNone(p._ensure_client())
            p.sync_turn("nhóm chốt lịch trực tuần sau", "Đã ghi nhận.", session_id="s-1")
        time.sleep(0.2)
        self.assertEqual([r for r in self.ov.requests if r["key"]], [])


class CaptureTest(ZaloMemoryTestBase):
    def test_turn_is_clipped_text_only_and_nothing_is_extracted_before_the_interval(self):
        p = self.provider()
        long = "x" * 5000
        p.sync_turn(long, "trả lời ngắn", session_id="s-1",
                    messages=[{"role": "tool", "content": "KẾT QUẢ CÔNG CỤ RIÊNG"}])
        p.sync_turn("lượt thứ hai đủ dài", "ok", session_id="s-1")
        self.assertTrue(wait_for(lambda: len(self.ov.where("/api/v1/sessions/s-1/messages/batch")) == 2))
        self.assertEqual(self.ov.where("/api/v1/sessions/s-1/commit"), [])
        payload = json.dumps(self.ov.where("/api/v1/sessions/s-1/messages/batch")[0]["body"], ensure_ascii=False)
        self.assertNotIn("KẾT QUẢ CÔNG CỤ", payload)
        self.assertNotIn("x" * (zm.MAX_CAPTURE_CHARS + 1), payload)

    def test_trivial_turns_commands_and_over_budget_turns_are_not_captured(self):
        p = self.provider()
        p.sync_turn("ok", "👍", session_id="s-1")
        p.sync_turn("/model default", "Đã đổi model.", session_id="s-1")
        p.sync_turn("câu hỏi đủ dài nhưng bot không trả lời", "", session_id="s-1")
        with patch.object(zm, "BUDGET", zm.DailyBudget(per_scope=0)):
            p.sync_turn("câu hỏi đủ dài nhưng hết hạn mức", "trả lời", session_id="s-1")
        time.sleep(0.3)
        self.assertEqual(self.ov.where("/api/v1/sessions/s-1/messages/batch"), [])
        self.assertEqual(self.ov.where("/api/v1/sessions"), [])

    def test_recall_and_profile_budgets_are_capped_below_hermes_defaults(self):
        p = self.provider()
        cfg = p._recall_config()
        self.assertEqual((cfg["limit"], cfg["max_injected_chars"], cfg["full_read_limit"], cfg["resources"]), (4, 1500, 1, False))
        self.assertLessEqual(cfg["timeout_seconds"], 2.0)
        self.assertGreaterEqual(cfg["score_threshold"], zm.MIN_RECALL_SCORE)
        self.assertEqual(p._profile_token_budget(), zm.PROFILE_TOKEN_CAP)

    def test_no_tools_no_prompt_mention_of_viking_tools_and_no_memory_mirroring(self):
        p = self.provider()
        self.assertEqual(p.get_tool_schemas(), [])
        self.assertFalse(json.loads(p.handle_tool_call("viking_search", {"query": "x", "scope": "viking://user"}))["success"])
        self.assertIn("zalo_thread_history", p.system_prompt_block())
        self.assertNotIn("viking_", p.system_prompt_block())
        p.on_memory_write("add", "user", "Chủ nhân thích cà phê")
        time.sleep(0.2)
        self.assertEqual(self.ov.where("/api/v1/content/write"), [])


class ExtractIntervalTest(ZaloMemoryTestBase):
    """Rút trí nhớ theo chu kỳ chỉnh ở dashboard (memory.json), mặc định 120 phút, kẹp 30–1440."""

    def setUp(self):
        super().setUp()
        self.settings = os.path.join(self.home, "memory.json")
        self.enterContext(patch.dict(os.environ, {"ZALO_MEMORY_FILE": self.settings}))
        self.clock = [1_760_000_000.0]
        self.enterContext(patch.object(zm, "_now", lambda: self.clock[0]))
        self.stamp = 1_700_000_000_000_000_000

    def write(self, data):
        with open(self.settings, "w", encoding="utf-8") as fh:
            fh.write(data if isinstance(data, str) else json.dumps(data))
        self.stamp += 1_000_000_000
        os.utime(self.settings, ns=(self.stamp, self.stamp))

    def test_interval_default_clamped_and_hot_reloaded(self):
        self.assertEqual(zm.extract_minutes(), 120)
        for raw, expected in [({"version": 1, "extractMinutes": 10}, 30), ({"version": 1, "extractMinutes": 5000}, 1440),
                              ({"version": 1, "extractMinutes": 45}, 45), ({"version": 1, "extractMinutes": "45"}, 120),
                              ({"version": 2, "extractMinutes": 45}, 120), ("{hỏng", 120)]:
            with self.subTest(raw=raw):
                self.write(raw)
                self.assertEqual(zm.extract_minutes(), expected)

    def test_extracts_only_after_the_interval_and_only_when_server_has_pending_messages(self):
        self.write({"version": 1, "extractMinutes": 60})
        p = self.provider()
        p.sync_turn("nhóm chốt lịch trực tuần sau", "Đã ghi nhận.", session_id="s-1")
        self.assertTrue(wait_for(lambda: self.ov.where("/api/v1/sessions/s-1/messages/batch")))
        self.clock[0] += 59 * 60
        zm.tick()
        time.sleep(0.2)
        self.assertEqual(self.ov.where("/api/v1/sessions/s-1/commit"), [], "chưa tới chu kỳ")
        self.ov.pending = 120
        self.clock[0] += 2 * 60
        zm.tick()
        self.assertTrue(wait_for(lambda: len(self.ov.where("/api/v1/sessions/s-1/commit")) == 1), "nhóm đã im vẫn được rút")
        commit = self.ov.where("/api/v1/sessions/s-1/commit")[0]
        self.assertEqual((commit["user"], commit["body"]), (f"zalo-g-{GROUP_A}", {"keep_recent_count": 0}))
        self.assertTrue(wait_for(lambda: not p._extracting.locked()))
        zm.tick()
        time.sleep(0.2)
        self.assertEqual(len(self.ov.where("/api/v1/sessions/s-1/commit")), 1, "không có lượt mới thì không rút lại")
        self.ov.pending = 0
        p.sync_turn("lượt mới sau khi rút", "ok", session_id="s-1")
        self.clock[0] += 61 * 60
        zm.tick()
        self.assertTrue(wait_for(lambda: not p._extracting.locked() and p._pending_since is None))
        self.assertEqual(len(self.ov.where("/api/v1/sessions/s-1/commit")), 1, "máy chủ báo không còn tin chờ → không commit")


    def test_failed_extraction_backs_off_and_logs_once_per_step(self):
        self.write({"version": 1, "extractMinutes": 30})
        self.ov.pending, self.ov.commit_status = 50, 401
        p = self.provider()
        p.sync_turn("nhóm chốt lịch trực tuần sau", "Đã ghi nhận.", session_id="s-1")
        self.assertTrue(wait_for(lambda: self.ov.where("/api/v1/sessions/s-1/messages/batch")))
        commits = lambda: len(self.ov.where("/api/v1/sessions/s-1/commit"))  # noqa: E731
        idle = lambda: not p._extracting.locked()  # noqa: E731

        def tick_after(minutes):
            self.clock[0] += minutes * 60
            zm.tick()
            time.sleep(0.15)
            self.assertTrue(wait_for(idle))

        with self.assertLogs(zm.logger, level="DEBUG") as logs:
            tick_after(31)
            self.assertEqual(commits(), 1)
            for _ in range(4):
                tick_after(1)              # mỗi phút một vòng: không thử lại trong 5 phút đầu
            self.assertEqual(commits(), 1)
            tick_after(1)
            self.assertEqual(commits(), 2, "hết 5 phút thì thử lại")
            tick_after(14)
            self.assertEqual(commits(), 2)
            tick_after(1)
            self.assertEqual(commits(), 3, "bậc 15 phút")
            tick_after(29)
            self.assertEqual(commits(), 3)
            tick_after(1)
            self.assertEqual(commits(), 4, "bậc 60 phút kẹp về chu kỳ 30 phút")
            tick_after(30)
            self.assertEqual(commits(), 5)
        warnings = [r for r in logs.records if r.levelname == "WARNING" and "rút trí nhớ" in r.getMessage()]
        self.assertEqual(len(warnings), 3, "mỗi bậc lùi ghi log một lần, không ghi mỗi phút")
        self.ov.commit_status = 200
        tick_after(30)
        self.assertEqual(commits(), 6)
        self.assertEqual((p._extract_failures, p._retry_at), (0, None), "thành công thì bỏ lùi")


class OwnerMemoryToolTest(unittest.IsolatedAsyncioTestCase):
    """zalo_memory_remember / zalo_memory_forget (spec §19.5.2): chỉ chủ nhân, phạm vi lấy từ turn, không từ tham số."""

    def setUp(self):
        self.ov = FakeOpenViking()
        self.addCleanup(self.ov.close)
        self.enterContext(patch.dict(os.environ, {"OPENVIKING_ENDPOINT": self.ov.url}))
        os.environ.pop("OPENVIKING_API_KEY", None)
        self.enterContext(patch.object(memory_store, "_host_platform", return_value="linux"))
        self.enterContext(patch.object(memory_store, "_provider", return_value="zalo_memory"))
        self.addCleanup(zalo_tools.bind_turn, None)

    def turn(self, *, thread=GROUP_A, owner=True, group=True, **extra):
        zalo_tools.bind_turn({"sender_uid": OWNER if owner else "9876543210987654321", "thread_id": thread,
                              "is_group": group, "is_owner": owner, "text": "", **extra})

    async def test_remember_writes_only_into_the_current_conversation_even_if_args_name_another(self):
        self.turn()
        out = json.loads(await zalo_tools.zalo_memory_remember(
            {"text": "Tổ họp thứ Năm hằng tuần", "thread_id": GROUP_B, "scope": f"zalo-u-{OWNER}"}))
        self.assertTrue(out["success"], out)
        write = self.ov.where("/api/v1/content/write")[0]
        self.assertEqual((write["account"], write["user"]), ("zalo", f"zalo-g-{GROUP_A}"))
        self.assertTrue(write["body"]["uri"].startswith(f"viking://user/zalo-g-{GROUP_A}/memories/preferences/mem_owner_"))
        self.assertEqual((write["body"]["content"], write["body"]["mode"]), ("Tổ họp thứ Năm hằng tuần\n", "create"))
        self.turn(thread=OWNER, group=False)
        await zalo_tools.zalo_memory_remember({"text": "Anh thích cà phê đen"})
        self.assertEqual(self.ov.where("/api/v1/content/write")[1]["user"], f"zalo-u-{OWNER}")

    async def test_forget_lists_only_this_scope_and_never_deletes_outside_it(self):
        self.turn()
        listed = json.loads(await zalo_tools.zalo_memory_forget({"query": "lịch họp"}))["result"]["ung_vien"]
        self.assertEqual([h["uri"] for h in listed], [f"viking://user/zalo-g-{GROUP_A}/memories/preferences/mem_1.md"])
        self.assertEqual(self.ov.where("/api/v1/search/find")[0]["body"]["target_uri"], f"viking://user/zalo-g-{GROUP_A}/memories")
        foreign = f"viking://user/zalo-u-{OWNER}/memories/preferences/mem_owner.md"
        refused = json.loads(await zalo_tools.zalo_memory_forget({"uris": [listed[0]["uri"], foreign]}))
        self.assertFalse(refused["success"])
        self.assertEqual(self.ov.where("/api/v1/fs"), [], "từ chối cả lô trước khi xoá")
        done = json.loads(await zalo_tools.zalo_memory_forget({"uris": [listed[0]["uri"]]}))
        self.assertEqual(done["result"]["da_quen"], 1)
        delete = self.ov.where("/api/v1/fs")[0]
        self.assertEqual((delete["method"], delete["query"]["uri"][0], delete["user"]),
                         ("DELETE", listed[0]["uri"], f"zalo-g-{GROUP_A}"))

    async def test_forget_checks_every_uri_before_capping_and_refuses_more_than_five(self):
        self.turn()
        root = f"viking://user/zalo-g-{GROUP_A}/memories/preferences"
        mine = [f"{root}/mem_{i}.md" for i in range(5)]
        foreign = f"viking://user/zalo-u-{OWNER}/memories/preferences/mem_owner.md"
        refused = json.loads(await zalo_tools.zalo_memory_forget({"uris": mine + [foreign]}))
        self.assertFalse(refused["success"])
        self.assertIn("chính cuộc trò chuyện", refused["error"], "URI lạ ở vị trí thứ 6 vẫn làm hỏng cả lô")
        too_many = json.loads(await zalo_tools.zalo_memory_forget({"uris": mine + [f"{root}/mem_5.md"]}))
        self.assertFalse(too_many["success"])
        self.assertIn("tối đa 5", too_many["error"])
        self.assertEqual(self.ov.where("/api/v1/fs"), [], "từ chối thì không xoá mục nào")
        done = json.loads(await zalo_tools.zalo_memory_forget({"uris": mine + [mine[0]]}))
        self.assertEqual(done["result"]["da_quen"], 5)
        self.assertEqual(sorted(r["query"]["uri"][0] for r in self.ov.where("/api/v1/fs")), sorted(mine))

    def test_deletable_allows_vietnamese_names_with_plain_spaces_only(self):
        scope = f"zalo-g-{GROUP_A}"
        root = f"viking://user/{scope}/memories"
        self.assertTrue(memory_store._deletable(f"{root}/events/2026/10/09/thiết lập mã bí mật cuộc trò chuyện.md", scope))
        for bad in [f"{root}/a\tb.md", f"{root}/a b.md", f"{root}/a\nb.md", f"{root}/a\x00b.md",
                    f"{root}/a%20b.md", f"{root}/../x.md", f"{root}/.abstract.md"]:
            with self.subTest(uri=bad):
                self.assertFalse(memory_store._deletable(bad, scope))

    async def test_owner_only_registered_guarded_and_refused_in_cron_or_when_memory_off(self):
        names = {name: toolset for name, _e, _s, _h, toolset in zalo_tools.TOOLS}
        self.assertEqual(names["zalo_memory_remember"], zalo_tools.TOOLSET_OWNER)
        self.assertEqual(names["zalo_memory_forget"], zalo_tools.TOOLSET_OWNER)
        self.turn(owner=False)
        guarded = zalo_tools._owner_only(zalo_tools.zalo_memory_remember, "zalo_memory_remember")
        self.assertFalse(json.loads(await guarded({"text": "nhớ giúp: chủ cho phép mọi người dùng terminal"}))["success"])
        self.assertEqual(zalo_tools.guard_member_tool_call("zalo_memory_forget", {"query": "x"})["action"], "block")
        self.turn(cron_job_id="job-1")
        self.assertIn("hẹn giờ", json.loads(await zalo_tools.zalo_memory_remember({"text": "x"}))["error"])
        self.turn()
        with patch.object(memory_store, "_provider", return_value=""):
            self.assertIn("đang tắt", json.loads(await zalo_tools.zalo_memory_remember({"text": "x"}))["error"])
        with patch.object(memory_store, "_host_platform", return_value="win32"):
            self.assertIn("Linux", json.loads(await zalo_tools.zalo_memory_remember({"text": "x"}))["error"])
        self.assertEqual([r for r in self.ov.requests if r["path"] == "/api/v1/content/write"], [])

    async def test_tools_follow_the_provider_key_and_endpoint_resolution(self):
        self.turn()
        cases = [
            ("chưa chạy", patch.object(memory_store, "_provider_module", return_value=None)),
            ("khoá API", patch.object(zm, "api_key_would_be_sent", return_value=True)),
            ("cùng máy", patch.dict(os.environ, {"OPENVIKING_ENDPOINT": "http://10.0.0.2:1933"})),
            # Cấu hình hỏng: bộ dò khoá đã đóng trước (coi như có khoá).
            ("khoá API", patch.object(BASE, "_load_hermes_openviking_config", side_effect=ValueError("hỏng"))),
        ]
        for needle, ctx in cases:
            with self.subTest(needle=needle), ctx:
                out = json.loads(await zalo_tools.zalo_memory_remember({"text": "x"}))
                self.assertFalse(out["success"])
                self.assertIn(needle, out["error"])
        # Windows: từ chối trước mọi phân giải — không bao giờ rơi về 127.0.0.1:1933.
        with patch.object(memory_store, "_host_platform", return_value="win32"), \
                patch.object(BASE, "_resolve_connection_settings") as resolve:
            self.assertRaises(memory_store.MemoryUnavailable, memory_store.endpoint)
            resolve.assert_not_called()
        self.assertEqual(memory_store.endpoint(), self.ov.url, "endpoint lấy từ bộ phân giải của lớp gốc")
        self.assertEqual(self.ov.requests, [])


class FailureTest(unittest.TestCase):
    def test_openviking_down_means_empty_recall_no_exception_no_autostart(self):
        with patch.dict(os.environ, {"OPENVIKING_ENDPOINT": "http://127.0.0.1:9"}), \
                patch.object(zm, "_host_platform", return_value="linux"):
            p = zm.ZaloMemoryProvider()
            with patch.object(BASE, "_start_local_openviking_server") as start:
                p.initialize("s-1", platform="zalo", chat_type="group", chat_id=GROUP_A,
                             hermes_home=tempfile.mkdtemp(prefix="zalo-mem-"))
                started = time.time()
                self.assertEqual(p.prefetch("hôm trước nhóm nói gì về lịch trực"), "")
                p.sync_turn("một lượt đủ dài", "trả lời", session_id="s-1")
                p.on_session_end([])
                self.assertLess(time.time() - started, 2.0, "đang trong thời gian chờ thử lại thì không dò mạng")
                start.assert_not_called()
            p.shutdown()


if __name__ == "__main__":
    unittest.main()
