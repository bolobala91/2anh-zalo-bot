"""Cấu hình áp dụng ngay (hermes-plugin/zalo/live_settings.py): đọc lại .env / config.yaml khi đổi, chỉ khoá an toàn."""

import importlib.util
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("live_settings", os.path.join(ROOT, "hermes-plugin", "zalo", "live_settings.py"))
ls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ls)


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


class WatcherTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="zalo-live-"))
        self.addCleanup(shutil.rmtree, self.home, True)
        self.clock = Clock()
        self.w = ls.SettingsWatcher(lambda: self.home, interval_s=3, clock=self.clock)
        self.enterContext(patch.dict(os.environ, {}, clear=False))
        for k in ls.HOT_KEYS:
            os.environ.pop(k, None)

    def write(self, name, text, mtime):
        p = self.home / name
        p.write_text(text, encoding="utf-8")
        os.utime(p, (mtime, mtime))

    def test_parse_env(self):
        self.assertEqual(ls.parse_env('# x\nA=1\nexport B="hai ba"\nC=\'4\'\nbad\n'), {"A": "1", "B": "hai ba", "C": "4"})

    def test_first_poll_only_records_then_changes_apply(self):
        self.write(".env", "ZALO_MEDIA_LOOKBACK=3\nOPENAI_API_KEY=sk-bimat\n", 100)
        self.write("config.yaml", "platforms:\n  zalo:\n    extra:\n      auto_react: true\n", 100)
        self.assertEqual(self.w.poll(), (False, None), "lần đầu chỉ ghi nhận")
        self.write(".env", "ZALO_MEDIA_LOOKBACK=10\nZALO_CONFIRM_DANGEROUS=true\nOPENAI_API_KEY=sk-moi\n", 200)
        self.assertEqual(self.w.poll(), (False, None), "chưa tới lượt (3 giây)")
        self.clock.t = 5
        changed, extra = self.w.poll()
        self.assertTrue(changed)
        self.assertEqual(extra, {"auto_react": True})
        self.assertEqual(os.environ["ZALO_MEDIA_LOOKBACK"], "10")
        self.assertEqual(os.environ["ZALO_CONFIRM_DANGEROUS"], "true")
        self.assertNotIn("OPENAI_API_KEY", os.environ, "không bao giờ nạp khoá bí mật")
        self.clock.t = 10
        self.assertEqual(self.w.poll(), (False, None), "không đổi")

    def test_key_removed_from_env_is_dropped(self):
        self.write(".env", "ZALO_ACK_GESTURES=false\n", 100)
        self.w.poll()
        os.environ["ZALO_ACK_GESTURES"] = "false"
        self.write(".env", "OTHER=1\n", 200)
        self.clock.t = 5
        self.assertTrue(self.w.poll()[0])
        self.assertNotIn("ZALO_ACK_GESTURES", os.environ)

    def test_broken_yaml_keeps_old_extra(self):
        self.write("config.yaml", "a: 1\n", 100)
        self.w.poll()
        self.write("config.yaml", "platforms: [hỏng\n", 200)
        self.clock.t = 5
        self.assertEqual(self.w.poll(), (True, None))


def hermes_importable():
    try:
        import gateway  # noqa: F401
        return True
    except Exception:
        return False


@unittest.skipUnless(hermes_importable(), "cần lõi Hermes (gateway)")
class AdapterLiveTest(unittest.TestCase):
    def test_adapter_applies_saved_settings_without_restart(self):
        import sys
        sys.path.insert(0, os.path.join(ROOT, "hermes-plugin"))
        from gateway.config import PlatformConfig
        from zalo.adapter import ZaloAdapter
        home = Path(tempfile.mkdtemp(prefix="zalo-live-ad-"))
        self.addCleanup(shutil.rmtree, home, True)
        (home / ".env").write_text("ZALO_MEDIA_LOOKBACK=3\n", encoding="utf-8")
        os.utime(home / ".env", (100, 100))
        with patch.dict(os.environ, {"ZALO_MEDIA_LOOKBACK": "3", "ZALO_BRIDGE_TOKEN": "t" * 32}):
            adapter = ZaloAdapter(PlatformConfig(enabled=True, extra={}))
            clock = Clock()
            adapter._settings_watcher = ls.SettingsWatcher(lambda: home, interval_s=3, clock=clock)
            adapter._settings_watcher.poll(force=True)  # như lúc khởi động: ghi mốc
            self.assertEqual(adapter._media_lookback, 3)
            (home / ".env").write_text("ZALO_MEDIA_LOOKBACK=12\nZALO_FLOOD_THRESHOLD=20\nZALO_AUTO_REACT=false\n", encoding="utf-8")
            os.utime(home / ".env", (200, 200))
            clock.t = 5
            adapter._reload_settings_if_changed()
            self.assertEqual(adapter._media_lookback, 12)
            self.assertEqual(adapter._flood._threshold, 20)
            self.assertFalse(adapter._auto_react)

    def test_file_stamp_fires_once_per_change(self):
        home = Path(tempfile.mkdtemp(prefix="zalo-stamp-"))
        self.addCleanup(shutil.rmtree, home, True)
        clock = Clock()
        path = home / "memory-edited.stamp"
        stamp = ls.FileStamp(lambda: path, interval_s=3, clock=clock)
        self.assertFalse(stamp.changed(force=True), "lần đầu chỉ ghi mốc (chưa có tệp)")
        path.write_text("1", encoding="utf-8")
        os.utime(path, (100, 100))
        self.assertFalse(stamp.changed(), "chưa tới nhịp 3 giây")
        clock.t = 4
        self.assertTrue(stamp.changed())
        clock.t = 8
        self.assertFalse(stamp.changed(), "không đổi thì không báo lại")
        os.utime(path, (200, 200))
        clock.t = 12
        self.assertTrue(stamp.changed())

    def test_adapter_rebuilds_cached_agents_when_dashboard_edits_memory(self):
        import sys
        import threading
        from collections import OrderedDict
        sys.path.insert(0, os.path.join(ROOT, "hermes-plugin"))
        from gateway.config import PlatformConfig
        from zalo.adapter import ZaloAdapter

        class Runner:
            def __init__(self):
                self._agent_cache = OrderedDict([("zalo:g1", object()), ("zalo:dm2", object()), ("telegram:x", object())])
                self._agent_cache_lock = threading.Lock()
                self.evicted = []

            def _evict_cached_agent(self, key):
                with self._agent_cache_lock:  # như gateway thật: tự lấy khoá — adapter không được giữ khoá khi gọi
                    self._agent_cache.pop(key, None)
                self.evicted.append(key)

        home = Path(tempfile.mkdtemp(prefix="zalo-stamp-"))
        self.addCleanup(shutil.rmtree, home, True)
        stamp_path = home / "zalo" / "memory-edited.stamp"
        with patch.dict(os.environ, {"ZALO_BRIDGE_TOKEN": "t" * 32}):
            adapter = ZaloAdapter(PlatformConfig(enabled=True, extra={}))
        clock = Clock()
        adapter._memory_stamp = ls.FileStamp(lambda: stamp_path, interval_s=3, clock=clock)
        adapter._memory_stamp.changed(force=True)
        adapter.gateway_runner = runner = Runner()
        clock.t = 5
        adapter._reload_settings_if_changed()
        self.assertEqual(runner.evicted, [], "chưa sửa bộ nhớ thì không đụng agent")
        stamp_path.parent.mkdir(parents=True)
        stamp_path.write_text("1791783501300", encoding="utf-8")
        clock.t = 10
        adapter._reload_settings_if_changed()
        self.assertEqual(runner.evicted, ["zalo:g1", "zalo:dm2", "telegram:x"])
        self.assertEqual(len(runner._agent_cache), 0)
        adapter.gateway_runner = None
        os.utime(stamp_path, (300, 300))
        clock.t = 20
        adapter._reload_settings_if_changed()  # gateway không có bộ đệm agent → chỉ ghi cảnh báo, không lỗi
        self.assertEqual(adapter._evict_cached_agents(), -1)


if __name__ == "__main__":
    unittest.main()
