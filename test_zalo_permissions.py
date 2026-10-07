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


class GuardFeatureTest(PermissionsFile, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.write({"version": 1, "defaults": {},
                    "groups": {GROUP_A: {"features": {"web": False, "groupCron": False}}}})
        self.addCleanup(zalo_tools.bind_turn, None)

    def turn(self, *, thread=GROUP_A, owner=False, group=True):
        zalo_tools.bind_turn({"sender_uid": OWNER if owner else MEMBER, "thread_id": thread,
                              "is_group": group, "is_owner": owner, "text": ""})

    def test_member_in_group_with_web_off_is_refused_in_plain_vietnamese(self):
        self.turn()
        verdict = zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "giá vàng"})
        self.assertEqual(verdict["action"], "block")
        self.assertIn("Nhóm này chưa bật tính năng tra cứu web", verdict["message"])
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_kb_list", {}))
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_send_sticker", {}))

    def test_other_group_dm_and_owner_are_not_affected(self):
        self.turn(thread=GROUP_B)
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"}))
        self.turn(owner=True)
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"}))
        self.write({"version": 1, "defaults": {"features": {"web": False}}, "groups": {}})
        self.turn(thread=MEMBER, group=False)
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"}))

    def test_group_cron_off_blocks_only_create(self):
        self.turn()
        self.assertEqual(zalo_tools.guard_member_tool_call("zalo_group_cron", {"action": "create"})["action"], "block")
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_group_cron", {"action": "list"}))
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_group_cron", {"action": "remove", "job_id": "a"}))

    def test_tool_call_bridge_is_checked_against_the_real_tool(self):
        self.turn()
        with patch("tools.tool_search.resolve_underlying_call",
                   return_value=("zalo_web_read", {"url": "https://a.vn"}, None)):
            verdict = zalo_tools.guard_member_tool_call(
                "tool_call", {"name": "zalo_web_read", "arguments": {"url": "https://a.vn"}})
        self.assertEqual(verdict["action"], "block")

    def test_owner_turn_with_outsider_interjection_is_held_to_group_rules(self):
        zalo_tools.bind_turn({"sender_uid": OWNER, "thread_id": GROUP_A, "is_group": True,
                              "is_owner": True, "text": "", "seq": 1})
        with patch.object(zalo_tools, "_outsider_spoke_after", return_value=True):
            verdict = zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"})
        self.assertEqual(verdict["action"], "block")
        self.assertIn("chưa bật", verdict["message"])

    def test_no_zalo_turn_means_no_check(self):
        zalo_tools.bind_turn(None)
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"}))


class AdapterGroupRulesTest(PermissionsFile, unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(patch.dict(os.environ, {"ZALO_ALLOWED_USERS": OWNER}))

    def make_adapter(self, reply_only_tagged=True):
        adapter = zalo_adapter.ZaloAdapter(PlatformConfig(enabled=True, extra={
            "bridge_url": "ws://127.0.0.1:9", "reply_only_tagged": reply_only_tagged, "ack_gestures": False,
        }))
        adapter._self_profile = {"user_id": "bot-uid", "display_name": "Lăng Tiêu"}
        adapter._flood.check = lambda _uid: None
        self.handled = []

        async def handle(event):
            self.handled.append(event)

        adapter.handle_message = handle
        return adapter

    async def say(self, adapter, msg_id, sender, text, *, tagged=True, thread=GROUP_A):
        frame = {"type": "message", "id": msg_id, "threadId": thread,
                 "threadType": zalo_adapter.THREAD_TYPE_GROUP, "senderUid": sender,
                 "senderName": "Lan", "text": text}
        if tagged:
            frame["mentions"] = [{"uid": "bot-uid"}]
        with patch.object(zalo_adapter, "_zalo_tools", return_value=zalo_tools):
            await adapter._on_message(frame)

    async def test_inactive_group_ignores_members_but_keeps_context_and_owner(self):
        self.write({"version": 1, "defaults": {}, "groups": {GROUP_A: {"active": False}}})
        adapter = self.make_adapter()
        await self.say(adapter, "m1", MEMBER, "@Lăng Tiêu chào bot")
        self.assertEqual(self.handled, [])
        self.assertEqual(list(adapter._recent_group_messages[GROUP_A])[0]["text"], "@Lăng Tiêu chào bot")
        await self.say(adapter, "m2", OWNER, "@Lăng Tiêu tóm tắt nhóm")
        self.assertEqual(len(self.handled), 1)
        await self.say(adapter, "m3", MEMBER, "@Lăng Tiêu chào", thread=GROUP_B)
        self.assertEqual(len(self.handled), 2)

    async def test_reply_only_tagged_overrides_global_flag_per_group(self):
        self.write({"version": 1, "defaults": {}, "groups": {GROUP_A: {"replyOnlyTagged": False}}})
        adapter = self.make_adapter(reply_only_tagged=True)
        await self.say(adapter, "m1", MEMBER, "ai biết lịch họp không", tagged=False)
        self.assertEqual(len(self.handled), 1)
        await self.say(adapter, "m2", MEMBER, "ai biết lịch họp không", tagged=False, thread=GROUP_B)
        self.assertEqual(len(self.handled), 1)

        self.write({"version": 1, "defaults": {"replyOnlyTagged": True}, "groups": {}})
        adapter = self.make_adapter(reply_only_tagged=False)
        await self.say(adapter, "m3", MEMBER, "ai biết lịch họp không", tagged=False)
        self.assertEqual(len(self.handled), 0)

    async def test_member_turn_lists_disabled_features_owner_turn_does_not(self):
        self.write({"version": 1, "defaults": {"features": {"video": False}},
                    "groups": {GROUP_A: {"features": {"web": False}}}})
        adapter = self.make_adapter()
        await self.say(adapter, "m1", MEMBER, "@Lăng Tiêu tra giá vàng")
        context = self.handled[0].channel_context
        self.assertIn("Nhóm này đang tắt: tra cứu web, tải và xem thông tin video", context)
        await self.say(adapter, "m2", OWNER, "@Lăng Tiêu tra giá vàng")
        self.assertNotIn("đang tắt", self.handled[1].channel_context or "")

    async def test_corrupt_file_never_silences_the_bot(self):
        self.write("{hỏng")
        adapter = self.make_adapter()
        with self.assertLogs(gp.logger, level="WARNING"):
            await self.say(adapter, "m1", MEMBER, "@Lăng Tiêu chào")
        self.assertEqual(len(self.handled), 1)
        self.assertNotIn("đang tắt", self.handled[0].channel_context or "")


if __name__ == "__main__":
    unittest.main()
