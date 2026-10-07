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


class BomTest(PermissionsFile, unittest.TestCase):
    def test_hand_edited_file_with_bom_is_read(self):
        with open(self.path, "w", encoding="utf-8-sig") as fh:
            fh.write(json.dumps({"version": 1, "defaults": {}, "groups": {GROUP_A: {"active": False}}}))
        self.assertFalse(gp.group_settings(GROUP_A)["active"])


class UnreadableFileTest(PermissionsFile, unittest.TestCase):
    def test_permission_error_is_logged_as_unreadable_not_corrupt(self):
        self.write({"version": 1, "defaults": {"features": {"web": False}}, "groups": {}})
        with patch.object(gp.Path, "read_text", side_effect=PermissionError(13, "Permission denied")), \
                self.assertLogs(gp.logger, level="ERROR") as logs:
            self.assertTrue(gp.group_settings(GROUP_A)["features"]["web"])
        self.assertIn("the gateway user cannot read it", logs.output[0])
        self.assertIn(self.path, logs.output[0])
        self.assertNotIn("hỏng", logs.output[0])


class GuardFeatureTest(PermissionsFile, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.write({"version": 1, "defaults": {},
                    "groups": {GROUP_A: {"features": {"web": False, "groupCron": False}}}})
        self.addCleanup(zalo_tools.bind_turn, None)

    def turn(self, *, thread=GROUP_A, owner=False, group=True):
        zalo_tools.bind_turn({"sender_uid": OWNER if owner else MEMBER, "thread_id": thread,
                              "is_group": group, "is_owner": owner, "text": ""})

    def test_owner_tool_refusal_hints_only_tools_enabled_in_this_group(self):
        self.write({"version": 1, "defaults": {}, "groups": {GROUP_A: {"features": {"kb": False}}}})
        self.turn()
        message = zalo_tools.guard_member_tool_call("terminal", {"command": "ls"})["message"]
        self.assertNotIn("zalo_kb_list", message)
        self.assertIn("Cần gửi tệp thì zalo_send_file", message)
        self.turn(thread=GROUP_B)
        message = zalo_tools.guard_member_tool_call("terminal", {"command": "ls"})["message"]
        self.assertIn("Cần tra tài liệu thì dùng zalo_kb_list", message)
        self.assertIn("zalo_send_file", message)

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

    def test_tool_call_with_non_dict_arguments_does_not_crash(self):
        self.turn()
        with patch("tools.tool_search.resolve_underlying_call",
                   return_value=("zalo_group_cron", ["lạ"], None)):
            verdict = zalo_tools.guard_member_tool_call("tool_call", {"name": "zalo_group_cron"})
        self.assertIsNone(verdict)

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


class AdapterHarness:
    """Adapter thật, cầu nối giả: ghi lại tin nào được chuyển cho agent."""

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


class AdapterGroupRulesTest(PermissionsFile, AdapterHarness, unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(patch.dict(os.environ, {"ZALO_ALLOWED_USERS": OWNER}))

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

    async def test_member_turn_with_everything_on_has_no_disabled_line(self):
        self.write({"version": 1, "defaults": {}, "groups": {GROUP_A: {"replyOnlyTagged": True}}})
        adapter = self.make_adapter()
        await self.say(adapter, "m1", MEMBER, "@Lăng Tiêu tra giá vàng")
        self.assertEqual(len(self.handled), 1)
        self.assertNotIn("Nhóm này đang tắt", self.handled[0].channel_context or "")
        self.assertNotIn("Nhóm này đang tắt", self.handled[0].text)

    async def test_people_off_skips_profile_for_members_but_not_owner(self):
        from plugins.zalo_tools import people

        self.enterContext(patch.dict(os.environ, {"ZALO_PEOPLE_FILE": os.path.join(self.dir, "people.json")}))
        people.remember_person(MEMBER, name="Lan", note="Giáo viên Hoá")
        people.remember_person(OWNER, name="Chủ", note="Hiệu trưởng")
        adapter = self.make_adapter()
        await self.say(adapter, "m1", MEMBER, "@Lăng Tiêu chào", thread=GROUP_B)
        self.assertIn("Giáo viên Hoá", self.handled[-1].text)
        self.write({"version": 1, "defaults": {}, "groups": {GROUP_A: {"features": {"people": False}}}})
        await self.say(adapter, "m2", MEMBER, "@Lăng Tiêu chào")
        self.assertNotIn("Người nhắn", self.handled[-1].text)
        self.assertNotIn("Giáo viên Hoá", self.handled[-1].text)
        await self.say(adapter, "m3", OWNER, "@Lăng Tiêu chào")
        self.assertIn("Hiệu trưởng", self.handled[-1].text)

    async def test_half_updated_install_without_group_permissions_keeps_answering(self):
        self.write({"version": 1, "defaults": {"features": {"web": False}},
                    "groups": {GROUP_A: {"active": False}}})
        adapter = self.make_adapter()
        with patch.object(zalo_adapter, "_group_permissions", None):
            self.assertIsNone(adapter._group_rules(GROUP_A))
            await self.say(adapter, "m1", MEMBER, "@Lăng Tiêu chào")
        self.assertEqual(len(self.handled), 1)
        self.assertNotIn("đang tắt", self.handled[0].channel_context or "")

    async def test_corrupt_file_never_silences_the_bot(self):
        self.write("{hỏng")
        adapter = self.make_adapter()
        with self.assertLogs(gp.logger, level="WARNING"):
            await self.say(adapter, "m1", MEMBER, "@Lăng Tiêu chào")
        self.assertEqual(len(self.handled), 1)
        self.assertNotIn("đang tắt", self.handled[0].channel_context or "")


class CronDeliveryTest(PermissionsFile, AdapterHarness, unittest.IsolatedAsyncioTestCase):
    """Nhóm tắt "Hoạt động": việc hẹn giờ của thành viên không gửi gì vào nhóm; của chủ nhân vẫn gửi."""

    def setUp(self):
        super().setUp()
        self.enterContext(patch.dict(os.environ, {"ZALO_ALLOWED_USERS": OWNER}))
        jobs = {
            "member-job": {"id": "member-job", "deliver": f"zalo:{GROUP_A}",
                           "origin": {"platform": "zalo", "chat_id": GROUP_A, "zalo_scope": "group",
                                      "zalo_creator_uid": MEMBER}},
            "owner-group-job": {"id": "owner-group-job", "deliver": f"zalo:{GROUP_A}",
                                "origin": {"platform": "zalo", "chat_id": GROUP_A, "zalo_scope": "group",
                                           "zalo_creator_uid": OWNER}},
            "owner-native-job": {"id": "owner-native-job", "deliver": f"zalo:{GROUP_A}",
                                 "origin": {"platform": "zalo", "chat_id": GROUP_A}},
        }

        class FakeJobs:
            @staticmethod
            def get_job(job_id):
                return jobs.get(job_id)

        self.enterContext(patch.object(zalo_tools, "_cron_jobs", return_value=FakeJobs))
        self.enterContext(patch.object(zalo_adapter, "_zalo_tools", return_value=zalo_tools))
        self.adapter = self.make_adapter()
        self.sent = []

        async def command(payload, expect_ack=False):
            self.sent.append(payload)
            return {"ok": True, "msgId": "1"}

        self.adapter._command = command

    async def deliver(self, job_id, chat=GROUP_A):
        return await self.adapter.send(chat, "Bản tin sáng", metadata={"job_id": job_id, "notify": True})

    async def test_member_job_into_inactive_group_is_not_posted_and_logged(self):
        self.write({"version": 1, "defaults": {}, "groups": {GROUP_A: {"active": False}}})
        with self.assertLogs(zalo_adapter.logger, level="INFO") as logs:
            result = await self.deliver("member-job")
        self.assertTrue(result.success)
        self.assertEqual(self.sent, [])
        self.assertTrue(any("member-job" in line and GROUP_A in line for line in logs.output))

    async def test_owner_jobs_still_post_into_inactive_group(self):
        self.write({"version": 1, "defaults": {}, "groups": {GROUP_A: {"active": False}}})
        await self.deliver("owner-group-job")
        await self.deliver("owner-native-job")
        self.assertEqual(len(self.sent), 2)

    async def test_member_job_posts_when_group_is_active_or_only_other_group_is_off(self):
        await self.deliver("member-job")
        self.write({"version": 1, "defaults": {}, "groups": {GROUP_B: {"active": False}}})
        await self.deliver("member-job")
        # Tắt "Hẹn giờ cho nhóm" chỉ chặn tạo mới — việc đã có vẫn gửi.
        self.write({"version": 1, "defaults": {}, "groups": {GROUP_A: {"features": {"groupCron": False}}}})
        await self.deliver("member-job")
        self.assertEqual(len(self.sent), 3)

    async def test_ordinary_replies_and_unknown_jobs_are_not_affected(self):
        self.write({"version": 1, "defaults": {}, "groups": {GROUP_A: {"active": False}}})
        await self.adapter.send(GROUP_A, "trả lời chủ nhân")
        await self.deliver("job-da-xoa")
        self.assertEqual(len(self.sent), 2)


# Kịch bản ghi tệp bằng đúng dashboard/lib/permissions.js (như khi bấm Lưu trên giao diện:
# bản nháp xuất phát từ trạng thái đang hiệu lực mà dashboard hiển thị).
_NODE_FIXTURE = r"""
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [modUrl, home, stepsJson] = process.argv.slice(1);
const { createPermissionsStore, makeGlobalReplyOnlyTagged } = await import(modUrl);
const store = createPermissionsStore({
  file: join(home, 'zalo', 'permissions.json'),
  globalReplyOnlyTagged: makeGlobalReplyOnlyTagged({ envFile: join(home, '.env'), configFile: join(home, 'config.yaml') }),
});
for (const step of JSON.parse(stepsJson)) {
  const view = store.get();
  const base = step.group ? (view.groups[step.group] || view.defaults) : view.defaults;
  const s = { active: base.active, replyOnlyTagged: base.replyOnlyTagged, features: { ...base.features } };
  Object.assign(s, step.set || {});
  Object.assign(s.features, step.features || {});
  if (step.group) store.setGroup(step.group, s); else store.setDefaults(s);
}
"""


class DashboardContractTest(AdapterHarness, unittest.IsolatedAsyncioTestCase):
    """Tệp do dashboard (JS) ghi phải được plugin (Python) hiểu đúng như giao diện đã hiện."""

    def setUp(self):
        self.node = shutil.which("node")
        if not self.node:
            self.skipTest("không có node trong PATH")
        self.home = tempfile.mkdtemp(prefix="zalo-contract-")
        self.addCleanup(shutil.rmtree, self.home, True)
        self.enterContext(patch.dict(os.environ, {
            "ZALO_PERMISSIONS_FILE": os.path.join(self.home, "zalo", "permissions.json"),
            "ZALO_ALLOWED_USERS": OWNER,
        }))

    def hermes_env(self, text):
        with open(os.path.join(self.home, ".env"), "w", encoding="utf-8") as fh:
            fh.write(text)

    def dashboard_saves(self, steps):
        import subprocess
        from pathlib import Path
        mod = Path(ROOT, "dashboard", "lib", "permissions.js").resolve().as_uri()
        result = subprocess.run(
            [self.node, "--input-type=module", "-e", _NODE_FIXTURE, mod, self.home, json.dumps(steps)],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    async def test_s1_turning_off_one_feature_keeps_the_hermes_tag_flag(self):
        # Hermes: trả lời mọi tin. Trên dashboard chỉ tắt "web" ở nhóm A.
        self.hermes_env("ZALO_GROUP_REPLY_ONLY_TAGGED=false\n")
        self.dashboard_saves([{"group": GROUP_A, "features": {"web": False}}])
        rules = gp.group_settings(GROUP_A)
        self.assertIn(rules["reply_only_tagged"], (False, None))
        self.assertFalse(rules["features"]["web"])
        self.assertTrue(all(on for key, on in rules["features"].items() if key != "web"))
        # Và adapter thật (cờ Hermes false) vẫn trả lời tin không tag trong nhóm A.
        adapter = self.make_adapter(reply_only_tagged=False)
        await self.say(adapter, "c1", MEMBER, "ai biết lịch họp không", tagged=False)
        self.assertEqual(len(self.handled), 1)

    async def test_s2_defaults_change_reaches_groups_that_do_not_override_the_key(self):
        self.hermes_env("ZALO_GROUP_REPLY_ONLY_TAGGED=false\n")
        self.dashboard_saves([
            {"group": GROUP_A, "features": {"web": False}},
            {"set": {"replyOnlyTagged": True}, "features": {"kb": False}},
        ])
        for group in (GROUP_A, GROUP_B):
            rules = gp.group_settings(group)
            self.assertIs(rules["reply_only_tagged"], True, group)
            self.assertFalse(rules["features"]["kb"], group)
        self.assertFalse(gp.group_settings(GROUP_A)["features"]["web"])
        self.assertTrue(gp.group_settings(GROUP_B)["features"]["web"])


STRANGER = "5555555555555555555"


class DmPermissionsTest(PermissionsFile, unittest.TestCase):
    """Mục "dm" của permissions.json (spec §16)."""

    def test_missing_dm_section_means_env_policy_and_everything_on(self):
        self.assertIsNone(gp.dm_allows(MEMBER))
        self.write({"version": 1, "defaults": {"features": {"web": False}}, "groups": {}})
        self.assertIsNone(gp.dm_allows(MEMBER))
        self.assertEqual(gp.dm_disabled_features(MEMBER), [], "bảng nhóm không áp cho tin nhắn riêng")

    def test_who_list_everyone_owners(self):
        self.write({"version": 1, "dm": {"who": "list", "people": {MEMBER: {"name": "Cô Lan"}}}})
        self.assertIs(gp.dm_allows(MEMBER), True)
        self.assertIs(gp.dm_allows(STRANGER), False)
        self.write({"version": 1, "dm": {"who": "everyone"}})
        self.assertIs(gp.dm_allows(STRANGER), True)
        self.write({"version": 1, "dm": {"who": "owners", "people": {MEMBER: {}}}})
        self.assertIs(gp.dm_allows(MEMBER), False)
        self.write({"version": 1, "dm": {"who": "ai cũng được"}})
        self.assertIsNone(gp.dm_allows(MEMBER), "who lạ → theo ZALO_DM_POLICY")

    def test_features_merge_default_dm_then_person(self):
        self.write({"version": 1, "dm": {"who": "everyone", "features": {"web": False, "groupCron": False},
                                         "people": {MEMBER: {"features": {"web": True, "video": False, "kb": "no"}}}}})
        self.assertEqual(gp.dm_disabled_features(STRANGER), ["web"])
        self.assertEqual(gp.dm_disabled_features(MEMBER), ["video"])
        self.assertNotIn("groupCron", gp.dm_settings(MEMBER)["features"])
        self.assertEqual(gp.DM_FEATURES, tuple(f for f in gp.FEATURES if f != "groupCron"))

    def test_non_digit_uid_keys_and_garbage_are_ignored(self):
        self.write({"version": 1, "dm": {"who": "list", "people": {"abc": {}, "１２３": {}, MEMBER: "rác"}}})
        self.assertIs(gp.dm_allows("abc"), False)
        self.assertIs(gp.dm_allows("１２３"), False, "chữ số toàn khổ không phải UID")
        self.assertIs(gp.dm_allows(MEMBER), True, "mục rác vẫn là có tên trong danh sách — giống dm-rules.js")
        self.write({"version": 1, "dm": "rác"})
        self.assertIsNone(gp.dm_allows(MEMBER))


class GuardDmFeatureTest(PermissionsFile, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.write({"version": 1, "dm": {"who": "everyone", "features": {"web": False},
                                         "people": {MEMBER: {"features": {"web": True, "kb": False}}}}})
        self.addCleanup(zalo_tools.bind_turn, None)

    def dm_turn(self, uid, owner=False):
        zalo_tools.bind_turn({"sender_uid": uid, "thread_id": uid, "is_group": False, "is_owner": owner, "text": ""})

    def test_dm_feature_off_is_refused_with_dm_wording(self):
        self.dm_turn(STRANGER)
        verdict = zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"})
        self.assertEqual(verdict["action"], "block")
        self.assertIn("khi nhắn riêng", verdict["message"])
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_kb_list", {}))

    def test_per_person_override_and_owner_exempt(self):
        self.dm_turn(MEMBER)
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"}))
        self.assertEqual(zalo_tools.guard_member_tool_call("zalo_kb_read", {"name": "a"})["action"], "block")
        message = zalo_tools.guard_member_tool_call("terminal", {"command": "ls"})["message"]
        self.assertNotIn("zalo_kb_list", message, "không gợi ý công cụ đang tắt với người này")
        self.dm_turn(OWNER, owner=True)
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"}))

    def test_group_cron_is_not_a_dm_switch_and_group_turns_ignore_dm_section(self):
        self.write({"version": 1, "dm": {"who": "everyone", "features": {"web": False}}})
        self.dm_turn(STRANGER)
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_group_cron", {"action": "create"}))
        zalo_tools.bind_turn({"sender_uid": STRANGER, "thread_id": GROUP_A, "is_group": True, "is_owner": False, "text": ""})
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"}))

    def test_unreadable_dm_rules_do_not_block(self):
        self.dm_turn(STRANGER)
        with patch.object(gp, "dm_settings", side_effect=RuntimeError("hỏng")), \
                self.assertLogs(zalo_tools.logger, level="WARNING"):
            self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"}))

    def test_sethome_turn_marks_the_authorization(self):
        zalo_tools.bind_turn({"sender_uid": STRANGER, "thread_id": STRANGER, "is_group": False,
                              "is_owner": False, "text": "/sethome", "sethome": True})
        self.assertEqual(zalo_tools.current_authorization()["notice"], "sethome")
        self.dm_turn(STRANGER)
        self.assertNotIn("notice", zalo_tools.current_authorization())


class AdapterDmTest(PermissionsFile, AdapterHarness, unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(patch.dict(os.environ, {"ZALO_ALLOWED_USERS": OWNER}))

    def dm_adapter(self, policy="owner-only"):
        adapter = self.make_adapter()
        adapter._dm_policy = policy
        return adapter

    async def dm(self, adapter, msg_id, sender, text):
        frame = {"type": "message", "id": msg_id, "threadId": sender,
                 "threadType": zalo_adapter.THREAD_TYPE_USER, "senderUid": sender,
                 "senderName": "Lan", "text": text}
        with patch.object(zalo_adapter, "_zalo_tools", return_value=zalo_tools):
            await adapter._on_message(frame)

    async def test_without_dm_section_env_policy_decides_as_before(self):
        adapter = self.dm_adapter("owner-only")
        await self.dm(adapter, "d1", STRANGER, "chào bot")
        self.assertEqual(self.handled, [])
        await self.dm(adapter, "d2", OWNER, "chào bot")
        self.assertEqual(len(self.handled), 1)
        adapter = self.dm_adapter("open")  # adapter mới, self.handled làm lại từ đầu
        await self.dm(adapter, "d3", STRANGER, "chào bot")
        self.assertEqual(len(self.handled), 1)

    async def test_dashboard_list_overrides_env_policy_both_ways(self):
        self.write({"version": 1, "dm": {"who": "list", "people": {MEMBER: {}}}})
        adapter = self.dm_adapter("owner-only")
        await self.dm(adapter, "d1", MEMBER, "chào bot")
        await self.dm(adapter, "d2", STRANGER, "chào bot")
        self.assertEqual([e.source.user_id for e in self.handled], [MEMBER])
        adapter = self.dm_adapter("open")  # adapter mới, self.handled làm lại từ đầu
        await self.dm(adapter, "d3", STRANGER, "chào bot")
        self.assertEqual(self.handled, [], "tệp nói danh sách thì ZALO_DM_POLICY=open không mở thêm")
        self.write({"version": 1, "dm": {"who": "owners", "people": {MEMBER: {}}}})
        await self.dm(adapter, "d4", MEMBER, "chào bot")
        await self.dm(adapter, "d5", OWNER, "chào bot")
        self.assertEqual([e.source.user_id for e in self.handled], [OWNER], "chỉ chủ nhân: người trong danh sách cũng không vào")

    async def test_member_dm_lists_disabled_features_and_skips_people_profile(self):
        from plugins.zalo_tools import people

        self.enterContext(patch.dict(os.environ, {"ZALO_PEOPLE_FILE": os.path.join(self.dir, "people.json")}))
        people.remember_person(MEMBER, name="Lan", note="Giáo viên Hoá")
        self.write({"version": 1, "dm": {"who": "everyone", "features": {"web": False, "people": False}}})
        adapter = self.dm_adapter()
        await self.dm(adapter, "d1", MEMBER, "tra giá vàng")
        self.assertIn("Tin nhắn riêng này đang tắt: tra cứu web, sổ người quen", self.handled[0].channel_context)
        self.assertNotIn("Giáo viên Hoá", self.handled[0].text)
        await self.dm(adapter, "d2", OWNER, "tra giá vàng")
        self.assertNotIn("đang tắt", self.handled[1].channel_context or "")

    async def test_errors_and_half_install_fall_back_to_env_policy_never_wider(self):
        self.write({"version": 1, "dm": {"who": "everyone"}})
        adapter = self.dm_adapter("owner-only")
        with patch.object(gp, "dm_allows", side_effect=RuntimeError("hỏng")), \
                patch.object(gp, "dm_settings", side_effect=RuntimeError("hỏng")), \
                self.assertLogs(zalo_adapter.logger, level="WARNING"):
            await self.dm(adapter, "d1", STRANGER, "chào bot")
        self.assertEqual(self.handled, [])
        with patch.object(zalo_adapter, "_group_permissions", None):
            await self.dm(adapter, "d2", STRANGER, "chào bot")
        self.assertEqual(self.handled, [])
        self.write("{hỏng")
        adapter = self.dm_adapter("open")
        with self.assertLogs(gp.logger, level="WARNING"):
            await self.dm(adapter, "d3", STRANGER, "chào bot")
        self.assertEqual(len(self.handled), 1, "tệp hỏng → ZALO_DM_POLICY=open như trước")

    async def test_stranger_sethome_reply_carries_the_sethome_notice(self):
        self.write({"version": 1, "dm": {"who": "list", "people": {}}})
        adapter = self.dm_adapter()
        sent = []

        async def command(payload, expect_ack=False):
            sent.append(zalo_tools.current_authorization())
            return {"ok": True, "msgId": "1"}

        adapter._command = command
        await self.dm(adapter, "d1", STRANGER, "/sethome")
        self.assertEqual(self.handled, [])
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["notice"], "sethome")
        self.assertEqual(sent[0]["actorUid"], STRANGER)


if __name__ == "__main__":
    unittest.main()
