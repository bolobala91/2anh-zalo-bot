"""Phân quyền theo nhóm (spec §8): đọc permissions.json, chặn công cụ, adapter."""

import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = os.path.dirname(__file__)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from gateway.config import PlatformConfig  # noqa: E402
import plugins  # noqa: E402
import plugins.platforms  # noqa: E402

plugins.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.__path__)]
plugins.platforms.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.platforms.__path__)]
from plugins.zalo_tools import group_permissions as gp  # noqa: E402
from plugins.zalo_tools import tools as zalo_tools  # noqa: E402
from plugins.platforms.zalo import adapter as zalo_adapter  # noqa: E402

GROUP_A = "2054797107487294899"
GROUP_B = "2054797107487294811"
OWNER = "1234567890123456789"
MEMBER = "9876543210987654321"


class PermissionsFile:
    """Tệp permissions.json tạm; ZALO_PERMISSIONS_FILE trỏ vào nó trong suốt test."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="zalo-perm-")
        self.path = os.path.join(self.dir, "permissions.json")
        self.enterContext(patch.dict(os.environ, {"ZALO_PERMISSIONS_FILE": self.path}))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.stamp = 1_700_000_000_000_000_000

    def write(self, data):
        """Ghi như dashboard (tệp tạm rồi đổi tên) và đẩy mtime lên để chắc chắn khác lần trước."""
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(data if isinstance(data, str) else json.dumps(data))
        os.replace(tmp, self.path)
        self.stamp += 1_000_000_000
        os.utime(self.path, ns=(self.stamp, self.stamp))


class GroupPermissionsTest(PermissionsFile, unittest.TestCase):
    def test_missing_file_means_everything_on_and_global_reply_flag(self):
        rules = gp.group_settings(GROUP_A)
        self.assertEqual(rules["active"], True)
        self.assertIsNone(rules["reply_only_tagged"])
        self.assertTrue(all(rules["features"][f] for f in gp.FEATURES))
        self.assertEqual(gp.disabled_features(GROUP_A), [])

    def test_group_entry_overrides_defaults_key_by_key(self):
        self.write({"version": 1,
                    "defaults": {"active": True, "replyOnlyTagged": True, "features": {"video": False}},
                    "groups": {GROUP_A: {"name": "Tổ Hoá", "replyOnlyTagged": False,
                                         "features": {"web": False, "video": True}}}})
        a = gp.group_settings(GROUP_A)
        self.assertEqual(a["reply_only_tagged"], False)
        self.assertEqual(gp.disabled_features(GROUP_A), ["web"])
        b = gp.group_settings(GROUP_B)
        self.assertEqual(b["reply_only_tagged"], True)
        self.assertEqual(gp.disabled_features(GROUP_B), ["video"])

    def test_edit_takes_effect_without_restart(self):
        self.write({"version": 1, "defaults": {}, "groups": {GROUP_A: {"features": {"web": False}}}})
        self.assertEqual(gp.disabled_features(GROUP_A), ["web"])
        self.write({"version": 1, "defaults": {}, "groups": {GROUP_A: {"features": {"kb": False}}}})
        self.assertEqual(gp.disabled_features(GROUP_A), ["kb"])
        os.remove(self.path)
        self.assertEqual(gp.disabled_features(GROUP_A), [])

    def test_corrupt_file_logs_warning_and_falls_back_to_everything_on(self):
        for bad in ("{không phải json", "[]", json.dumps({"version": 2, "defaults": {"active": False}})):
            self.write(bad)
            with self.assertLogs(gp.logger, level="WARNING"):
                rules = gp.group_settings(GROUP_A)
            self.assertTrue(rules["active"])
            self.assertEqual(gp.disabled_features(GROUP_A), [])

    def test_wrong_types_and_unknown_keys_are_ignored(self):
        self.write({"version": 1,
                    "defaults": {"active": "false", "features": {"web": 0, "nope": False, "kb": False}},
                    "groups": {GROUP_A: "rác", GROUP_B: {"features": ["web"]}}})
        self.assertTrue(gp.group_settings(GROUP_A)["active"])
        self.assertEqual(gp.disabled_features(GROUP_A), ["kb"])
        self.assertEqual(gp.disabled_features(GROUP_B), ["kb"])

    def test_every_public_tool_belongs_to_exactly_one_switch_or_always_on(self):
        public = {name for name, _e, _s, _h, toolset in zalo_tools.TOOLS if toolset == zalo_tools.TOOLSET_PUBLIC}
        mapped = [tool for feature in gp.FEATURES for tool in gp.FEATURE_TOOLS[feature]]
        self.assertEqual(len(mapped), len(set(mapped)), "một công cụ nằm ở hai nút")
        self.assertFalse(set(mapped) & gp.ALWAYS_ON)
        self.assertEqual(set(mapped) | gp.ALWAYS_ON, public,
                         "công cụ công khai mới phải được xếp vào một nút (spec §8.2)")
        self.assertEqual(set(gp.FEATURE_TOOLS), set(gp.FEATURES))
        self.assertEqual(set(gp.FEATURE_LABELS), set(gp.FEATURES))


if __name__ == "__main__":
    unittest.main()
