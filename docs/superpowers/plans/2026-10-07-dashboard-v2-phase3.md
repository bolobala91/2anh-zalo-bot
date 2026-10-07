# Dashboard v2 — Giai đoạn 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phân quyền Bot theo nhóm: bảng `<HERMES_HOME>/zalo/permissions.json` (Hoạt động, Chỉ trả lời khi được tag, 9 nút tính năng, mặc định cho nhóm chưa chỉnh riêng), màn **Phân quyền Bot** trên dashboard, và plugin Python thi hành bảng đó ngay khi tệp đổi. Phát hành v1.21.0.

**Architecture:** Dashboard là nơi **duy nhất ghi** `permissions.json` (ghi nguyên tử, quyền 600, giữ `.bak`). Plugin chỉ **đọc**: module mới `hermes-plugin/zalo_tools/group_permissions.py` `stat` tệp mỗi lần hỏi và chỉ phân tích lại khi dấu (mtime, cỡ, inode) đổi — Lưu trên dashboard là có hiệu lực ở lượt sau, không khởi động lại gateway. Thi hành ở ba chỗ, đúng spec §8.3: adapter bỏ qua thành viên khi nhóm `active=false` và lấy `replyOnlyTagged` của nhóm thay cờ toàn cục; hook `pre_tool_call` sẵn có `guard_member_tool_call` từ chối công cụ thuộc nút đang tắt; adapter thêm một dòng vào `channel_context` của lượt thành viên liệt kê tính năng đang tắt ("không hứa suông"). Chủ nhân không bao giờ bị chặn bởi tệp này.

**Tech Stack:** Python 3.11 (venv Hermes, `unittest`), Node ≥ 22 ESM, Express 5.2.1, `node:test`, Preact 10 + htm 3 (đã nhúng ở `dashboard/public/vendor/`).

**Spec:** `docs/superpowers/specs/2026-10-07-zalo-dashboard-v2-design.md` (§5.1, §6, §7.1, §8, §9, §13, §14 GĐ3)

## Global Constraints

- Tệp: `<HERMES_HOME>/zalo/permissions.json` (dashboard: `paths.permissionsFile` đã có sẵn từ GĐ1). Lược đồ spec §8.1: `{ "version": 1, "defaults": { "active", "replyOnlyTagged", "features": {…} }, "groups": { "<groupId>": { "name", "active"?, "replyOnlyTagged"?, "features"?: {…} } } }`. Nhóm không có mục riêng → dùng `defaults`; mục riêng chỉ ghi khoá khác mặc định.
- Chín nút, đúng thứ tự và đúng tên: `web, files, voice, reminders, groupCron, kb, people, academic, video`. Bảng nút → công cụ (đã đối chiếu `TOOLS` trong `hermes-plugin/zalo_tools/tools.py` — tên spec là tên thật, đủ 20 công cụ công khai):
  - `web`: `zalo_web_search`, `zalo_web_read` · `files`: `zalo_send_file`, `zalo_make_file`, `zalo_pdf` · `voice`: `zalo_send_voice` · `reminders`: `zalo_create_reminder`, `zalo_list_reminders`, `zalo_remove_reminder` · `groupCron`: `zalo_group_cron` · `kb`: `zalo_kb_list`, `zalo_kb_read` · `people`: `zalo_remember_person`, `zalo_recall_person` · `academic`: `zalo_academic_search` · `video`: `zalo_video_info`, `zalo_video_download` · luôn bật: `zalo_send_sticker`, `zalo_send_link`, `zalo_group_members`.
  - Ngoài bảng (không phải công cụ công khai nên không có nút): 38 công cụ chỉ chủ nhân, `zalo_group_history` (chỉ có trong lượt cron), công cụ MCP mở bằng `ZALO_PUBLIC_MCP`, cầu `tool_search`/`tool_describe` của Hermes. Test ghim: mọi công cụ công khai thuộc đúng một nút hoặc nhóm luôn bật (spec §8.2).
- **Không có tệp → y như hôm nay** (mọi công cụ công khai, cờ `ZALO_GROUP_REPLY_ONLY_TAGGED` toàn cục). **Tệp hỏng** (không phải JSON, không phải object, `version` ≠ 1) → ghi cảnh báo, dùng mặc định gốc (mọi tính năng bật), không bao giờ làm bot im hay làm gateway lỗi. Giá trị sai kiểu/khoá lạ → bỏ qua đúng khoá đó.
- **Chủ nhân** (`ZALO_ALLOWED_USERS`) không bao giờ bị chặn bởi tệp này, kể cả trong nhóm `active=false`. Lượt của chủ nhân bị hạ quyền vì có người ngoài chen vào (`_outsider_spoke_after`) thì chịu luật nhóm như thành viên.
- Bảng chỉ áp trong **nhóm**. Tin nhắn riêng không theo bảng (vẫn do `ZALO_DM_POLICY` quyết).
- `groupCron` tắt chỉ chặn `action="create"`; `list`/`remove` vẫn được, việc hẹn giờ đã tạo vẫn chạy (spec §8.3). Lượt cron không qua kiểm này (hook không thấy lượt Zalo nào trong cron).
- Thi hành = từ chối tại điểm gọi công cụ (hook `guard_member_tool_call`) + dòng ngữ cảnh. **Không** giấu công cụ theo từng tin — xem "Quyết định".
- Dashboard ghi: `writeJsonAtomic` (tệp tạm `mode 0o600` rồi đổi tên), trước đó chép bản cũ sang `permissions.json.bak` (chmod 600). Không đổi tên tệp hỏng sang chỗ khác (khác `readJson`) — plugin cũng đang đọc nó.
- Ma trận quyền (spec §6): Quản trị **và** Chủ bot đều xem và sửa. Mọi route mới đặt `requireAuth`. Mọi lần lưu ghi `activity.jsonl` (`permissions_group` / `permissions_defaults`), hiện trong Nhật ký.
- Route: `GET /api/permissions`, `PUT /api/permissions/groups/:groupId`, `PUT /api/permissions/defaults`, `GET /api/groups` (spec §7.1). `groupId` khớp `^\d{1,32}$`. Thân PUT bắt buộc đủ `active`, `replyOnlyTagged` và đủ 9 nút, tất cả boolean; sai → 400 tiếng Việt kèm bước tiếp theo.
- Giao diện: tiếng Việt thường, không dùng "sidecar", "bridge", "toolset", "plugin"; mọi lỗi kèm bước tiếp theo; chữ chỉ đi qua htm (cấm `innerHTML`, `dangerouslySetInnerHTML`); không `style=` nội tuyến (CSP); dùng được trên điện thoại (≤ 760 px: danh sách/chi tiết luân phiên như Phiên chat).
- Python: test ở gốc repo, đăng ký trong `scripts/run-python-tests.js`; chạy `HERMES_HOME=E:/Hermes npm run test:py` (dùng venv Hermes). Test **không được đọc** `permissions.json` của bot thật trên máy dev: runner đặt `ZALO_PERMISSIONS_FILE` trỏ tới tệp không tồn tại; test riêng của tính năng tự trỏ vào thư mục tạm.
- Repo checkout với `core.autocrlf=true` (tệp làm việc CRLF): sửa bằng công cụ Edit, đừng dùng script thay chuỗi giả định `\n`.
- Commit theo quy ước repo, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Quyết định (spec không chốt)

1. **Cách thi hành: từ chối khi gọi + dòng ngữ cảnh, không giấu công cụ.** Spec §8.3 chỉ đích danh hook `guard_member_tool_call`. Giấu theo từng tin không làm được sạch: `toolsets_for_source` trả **tên toolset** (`zalo_public` là một khối 20 công cụ) — tách theo 9 nút cần 2⁹ toolset; Hermes còn ghim danh sách công cụ theo phiên nhóm (`restore_agent_tool_prefix`) và công cụ Zalo công khai nằm sau `tool_search`. Hook chặn được cả đường `tool_call`. Dòng ngữ cảnh giúp mô hình khỏi hứa rồi bị chặn.
2. **Ngữ cảnh lượt đã có sẵn, không cần cơ chế mới.** Adapter gọi `set_turn_context` khi nhận tin và `bind_turn` trong `toolsets_for_source` mỗi lượt; `ContextVar _TURN` mang `thread_id`, `is_group`, `is_owner`, đúng thứ hook đang dùng để chặn người ngoài. Hook đọc `_TURN.get()` — đúng lượt kể cả khi gateway chạy song song.
3. **Tin nhắn riêng không theo bảng.** Bảng là "theo nhóm" (spec §4 #5, §8); khoá theo `groupId`. Nhắn riêng đã có `ZALO_DM_POLICY`.
4. **`groupCron` tắt chỉ chặn `create`.** §8.2 xếp cả `zalo_group_cron` vào nút, §8.3 nói "tắt chỉ chặn tạo mới" — xem/xoá việc đã có vẫn cần để dọn.
5. **`replyOnlyTagged` thiếu khoá = theo cờ toàn cục.** Spec "không có tệp → cờ toàn cục". Plugin trả `None` khi cả nhóm lẫn `defaults` không ghi khoá. Dashboard chỉ ghi khoá này vào `defaults` khi người dùng bấm Lưu ở mục Mặc định; khi chưa có, nó hiển thị theo `ZALO_GROUP_REPLY_ONLY_TAGGED` trong `.env` (mặc định bật).
6. **Mục nhóm lưu phần khác mặc định; trùng mặc định thì xoá mục.** Theo §8.1 "chỉ cần ghi khoá khác mặc định". Nút "Dùng mặc định" chỉ đổ mặc định vào form; Lưu sẽ xoá mục — không cần route xoá riêng.
7. **"Mặc định cho nhóm mới" áp cho mọi nhóm chưa chỉnh riêng** (đúng dữ liệu §8.1). Giao diện ghi rõ điều đó.
8. **`ZALO_PERMISSIONS_FILE`** (giống `ZALO_PEOPLE_FILE` của sổ người quen) ghi đè đường dẫn — để test cô lập khỏi bot thật; không cần cho người dùng.
9. **Tên nhóm** ghi vào mục nhóm lúc lưu, lấy từ danh sách nhóm của bot (đệm `threadNames`); bot chưa biết tên thì không ghi `name`.
10. **Danh sách nhóm của trang** = `GET /api/groups` (bot) gộp với nhóm có trong tệp. Kết nối Zalo tắt → báo vàng, vẫn chỉnh được nhóm đã có trong tệp và mục Mặc định.

## Review Focus

1. **`permissions.json` hỏng, sai phiên bản, sai kiểu, hay bị sửa tay** → bot vẫn trả lời, mọi tính năng bật, có cảnh báo trong log; dashboard báo vàng và Lưu ghi lại tệp sạch (bản hỏng nằm ở `.bak`). (Task 1 `test_corrupt_file_logs_warning…`, `test_wrong_types…`; Task 3 `test_corrupt_file_never_silences_the_bot`; Task 4 `tệp hỏng…`; Task 5 `tệp hỏng: GET báo corrupt…`.)
2. **Chủ nhân nhắn trong nhóm đang tắt / tắt tính năng** → vẫn được phục vụ đủ; nhưng lượt của chủ nhân có người ngoài chen vào thì theo luật nhóm. (Task 2 `test_other_group_dm_and_owner_are_not_affected`, `test_owner_turn_with_outsider_interjection…`; Task 3 `test_inactive_group_ignores_members_but_keeps_context_and_owner`.)
3. **Mô hình gọi công cụ qua cầu `tool_call` của Tool Search** → vẫn bị chặn theo công cụ thật bên trong. (Task 2 `test_tool_call_bridge_is_checked_against_the_real_tool`.)
4. **Tắt "Hẹn giờ cho nhóm" khi nhóm đã có việc hẹn giờ** → không tạo mới được, vẫn xem/xoá được, việc cũ vẫn chạy. (Task 2 `test_group_cron_off_blocks_only_create`; cron không có lượt Zalo → `test_no_zalo_turn_means_no_check`.)
5. **Bấm Lưu hai lần liên tiếp trong lúc bot đang chạy** → lượt sau theo bản mới nhất, không cần khởi động lại; xoá tệp → về như cũ. (Task 1 `test_edit_takes_effect_without_restart`.)

---

## File Structure

**Plugin Python (mới):**
- `hermes-plugin/zalo_tools/group_permissions.py` — đường dẫn tệp, đọc theo dấu tệp, gộp 3 lớp, bảng nút → công cụ, nhãn tiếng Việt.
- `test_zalo_permissions.py` (gốc repo) — test đọc tệp, hook, adapter.

**Plugin Python (sửa):**
- `hermes-plugin/zalo_tools/tools.py` — import `group_permissions`; thêm `_group_feature_block`; gọi nó trong `guard_member_tool_call`.
- `hermes-plugin/zalo/adapter.py` — import `group_permissions`; `_group_rules`; `active`/`replyOnlyTagged` trong `_on_message`; dòng "Nhóm này đang tắt".
- `scripts/run-python-tests.js` — đăng ký suite mới; cô lập `ZALO_PERMISSIONS_FILE`.

**Dashboard (mới):** `dashboard/lib/permissions.js` (+ `.test.js`), `dashboard/routes/permissions.js` (+ `.test.js`), `dashboard/public/views/permissions.js`.

**Dashboard (sửa):** `dashboard/app.js`, `dashboard/server.js`, `dashboard/server.test.js`, `dashboard/test-helpers.js`, `dashboard/lib/audit-feed.js` (nhãn Nhật ký), `dashboard/public/views/shell.js`, `dashboard/public/style.css`, `dashboard/public/public.test.js`.

**Phát hành:** `README.vi.md`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`.

Sidecar (`server.js`, `control-api.js`) **không đổi**: `/control/groups` đã có từ GĐ1.

---

### Task 1: `group_permissions.py` — đọc nóng `permissions.json`

**Files:**
- Create: `hermes-plugin/zalo_tools/group_permissions.py`
- Create: `test_zalo_permissions.py`
- Modify: `scripts/run-python-tests.js`

**Interfaces:**
- Consumes: `hermes_constants.get_hermes_home()` (lõi Hermes); `tools.TOOLS`, `tools.TOOLSET_PUBLIC` (chỉ trong test ghim).
- Produces (module `group_permissions`):
  - `FEATURES: tuple[str, ...]` — 9 khoá theo thứ tự ở Global Constraints.
  - `FEATURE_TOOLS: dict[str, tuple[str, ...]]`, `ALWAYS_ON: frozenset[str]`, `FEATURE_LABELS: dict[str, str]` (chữ thường, dùng giữa câu: `"tra cứu web"`…).
  - `permissions_path() -> pathlib.Path` — `ZALO_PERMISSIONS_FILE` nếu đặt, không thì `<get_hermes_home()>/zalo/permissions.json`.
  - `feature_of(tool_name: str) -> Optional[str]`.
  - `group_settings(group_id: str) -> {"active": bool, "reply_only_tagged": Optional[bool], "features": dict[str, bool]}` — đủ 9 khoá `features`; `reply_only_tagged=None` = theo cờ toàn cục.
  - `disabled_features(group_id: str) -> list[str]` — theo thứ tự `FEATURES`.
  - `logger` (tên module) — test bắt cảnh báo qua nó.
- Produces (test): lớp trộn `PermissionsFile` (`self.path`, `self.write(data)`) và hằng `GROUP_A`, `GROUP_B`, `OWNER`, `MEMBER` dùng lại ở Task 2, 3.

- [ ] **Step 1: Viết test** — tạo `test_zalo_permissions.py`:

```python
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
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `HERMES_HOME=E:/Hermes E:/Hermes/hermes-agent/venv/Scripts/python.exe -m unittest test_zalo_permissions -v`
Expected: lỗi import `cannot import name 'group_permissions' from 'plugins.zalo_tools'`.

- [ ] **Step 3: Viết `hermes-plugin/zalo_tools/group_permissions.py`**

```python
"""Phân quyền theo nhóm — đọc nóng ``<HERMES_HOME>/zalo/permissions.json``.

Dashboard ghi tệp này (ghi nguyên tử), plugin chỉ đọc. Mỗi lần hỏi, plugin
``stat`` tệp; dấu (mtime, cỡ, inode) không đổi thì dùng bản đã phân tích trong
bộ nhớ, đổi thì đọc lại — nên bấm Lưu trên dashboard là có hiệu lực ngay, không
phải khởi động lại gateway.

Tệp chỉ **bớt** quyền trong bộ công cụ công khai, không bao giờ cấp quyền chủ
nhân. Không có tệp → y như trước khi có tính năng này. Tệp hỏng → ghi cảnh báo
và dùng mặc định (mọi tính năng bật), không bao giờ làm bot im.

Lớp gộp: mặc định gốc ← ``defaults`` trong tệp ← ``groups[<id>]``. Khoá nào
thiếu hoặc sai kiểu thì rơi xuống lớp dưới. ``reply_only_tagged`` = None nghĩa
là "theo cờ toàn cục" ``ZALO_GROUP_REPLY_ONLY_TAGGED`` của adapter.
"""

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

FEATURES = ("web", "files", "voice", "reminders", "groupCron", "kb", "people", "academic", "video")

FEATURE_TOOLS: Dict[str, tuple] = {
    "web": ("zalo_web_search", "zalo_web_read"),
    "files": ("zalo_send_file", "zalo_make_file", "zalo_pdf"),
    "voice": ("zalo_send_voice",),
    "reminders": ("zalo_create_reminder", "zalo_list_reminders", "zalo_remove_reminder"),
    "groupCron": ("zalo_group_cron",),
    "kb": ("zalo_kb_list", "zalo_kb_read"),
    "people": ("zalo_remember_person", "zalo_recall_person"),
    "academic": ("zalo_academic_search",),
    "video": ("zalo_video_info", "zalo_video_download"),
}

# Công cụ công khai luôn bật, không có nút.
ALWAYS_ON = frozenset({"zalo_send_sticker", "zalo_send_link", "zalo_group_members"})

FEATURE_LABELS: Dict[str, str] = {
    "web": "tra cứu web",
    "files": "gửi và tạo tệp",
    "voice": "tin nhắn thoại",
    "reminders": "nhắc hẹn",
    "groupCron": "hẹn giờ cho nhóm",
    "kb": "kho tài liệu",
    "people": "sổ người quen",
    "academic": "tra cứu học thuật",
    "video": "tải và xem thông tin video",
}

_TOOL_FEATURE = {tool: feature for feature, tools in FEATURE_TOOLS.items() for tool in tools}

_lock = threading.Lock()
_cache: Dict[str, Any] = {"key": None, "data": None}


def permissions_path() -> Path:
    """``ZALO_PERMISSIONS_FILE`` (test, cài đặt đặc biệt) hoặc ``<HERMES_HOME>/zalo/permissions.json``."""
    explicit = (os.getenv("ZALO_PERMISSIONS_FILE") or "").strip()
    if explicit:
        return Path(explicit).expanduser()
    try:
        from hermes_constants import get_hermes_home
        home = Path(get_hermes_home())
    except Exception:
        home = Path(os.getenv("HERMES_HOME") or Path.home() / ".hermes").expanduser()
    return home / "zalo" / "permissions.json"


def feature_of(tool_name: str) -> Optional[str]:
    """Nút điều khiển công cụ này; None nếu công cụ không thuộc nút nào."""
    return _TOOL_FEATURE.get(str(tool_name or ""))


def _bools(raw: Any, keys) -> Dict[str, bool]:
    if not isinstance(raw, dict):
        return {}
    return {key: raw[key] for key in keys if isinstance(raw.get(key), bool)}


def _layer(raw: Any) -> Dict[str, Any]:
    """Một lớp (defaults hoặc một nhóm): chỉ giữ khoá hợp lệ, đúng kiểu bool."""
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Any] = _bools(raw, ("active", "replyOnlyTagged"))
    features = _bools(raw.get("features"), FEATURES)
    if features:
        out["features"] = features
    return out


def _parse(text: str) -> Dict[str, Any]:
    data = json.loads(text)
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError("không phải permissions.json phiên bản 1")
    groups = data.get("groups") if isinstance(data.get("groups"), dict) else {}
    return {
        "defaults": _layer(data.get("defaults")),
        "groups": {str(gid): _layer(entry) for gid, entry in groups.items()},
    }


def _load() -> Dict[str, Any]:
    """Bản đã phân tích của tệp; rỗng khi không có tệp hoặc tệp hỏng."""
    path = permissions_path()
    try:
        st = path.stat()
    except OSError:
        return {}
    key = (str(path), st.st_mtime_ns, st.st_size, st.st_ino)
    with _lock:
        if _cache["key"] == key:
            return _cache["data"]
    try:
        data = _parse(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("[zalo] permissions.json hỏng (%s) — dùng mặc định, mọi tính năng bật: %s", path, exc)
        data = {}
    with _lock:
        _cache["key"] = key
        _cache["data"] = data
    return data


def group_settings(group_id: str) -> Dict[str, Any]:
    """Quyền đã gộp của một nhóm: ``{active, reply_only_tagged, features}``."""
    data = _load()
    defaults = data.get("defaults") or {}
    entry = (data.get("groups") or {}).get(str(group_id or "")) or {}
    features = {feature: True for feature in FEATURES}
    features.update(defaults.get("features") or {})
    features.update(entry.get("features") or {})
    active = entry.get("active", defaults.get("active", True))
    reply = entry.get("replyOnlyTagged", defaults.get("replyOnlyTagged"))
    return {"active": active, "reply_only_tagged": reply, "features": features}


def disabled_features(group_id: str) -> List[str]:
    """Các nút đang tắt ở nhóm này, theo thứ tự FEATURES."""
    features = group_settings(group_id)["features"]
    return [feature for feature in FEATURES if not features[feature]]
```

- [ ] **Step 4: Đăng ký suite và cô lập tệp thật** — sửa `scripts/run-python-tests.js`:

  1. Dòng chú thích đầu tệp: `// Chạy 7 test suite Python của repo (test_zalo_adapter.py, …, test_zalo_model_command.py, scripts/test_lay_token_facebook.py,` → `// Chạy 8 test suite Python của repo (test_zalo_adapter.py, test_zalo_media.py, test_zalo_pdf.py, test_zalo_academic.py, test_zalo_model_command.py, test_zalo_permissions.py, scripts/test_lay_token_facebook.py,`
  2. Import: `import { existsSync } from 'node:fs';` → `import { existsSync, mkdtempSync, rmSync } from 'node:fs';` và `import { platform } from 'node:os';` → `import { platform, tmpdir } from 'node:os';`
  3. Cảnh báo "không tìm thấy Python": `BỎ QUA 6 test suite Python` → `BỎ QUA 8 test suite Python`, và thêm `test_zalo_permissions.py, ` ngay sau `test_zalo_model_command.py, ` trong danh sách trên dòng kế tiếp.
  4. Trong mảng `suites`, ngay sau dòng `test_zalo_model_command.py`:

```js
  { label: 'test_zalo_permissions.py', module: 'test_zalo_permissions', cwd: REPO_ROOT, requires: 'import gateway' },
```

  5. Ngay sau `let anyFailed = false;`:

```js

// Test chạy với HERMES_HOME thật (để dùng venv của Hermes) nhưng không được đọc
// permissions.json của bot đang chạy trên máy này: một nhóm bị tắt tính năng ở đó
// sẽ làm đỏ test không liên quan. Trỏ plugin tới một tệp không tồn tại.
const isolation = mkdtempSync(join(tmpdir(), 'zalo-py-tests-'));
const testEnv = { ...process.env, ZALO_PERMISSIONS_FILE: join(isolation, 'permissions.json') };
process.on('exit', () => rmSync(isolation, { recursive: true, force: true }));
```

  6. Trong `spawnSync(python, ['-m', 'unittest', suite.module, '-v'], { cwd: suite.cwd, encoding: 'utf8' })` thêm `env: testEnv,` sau `encoding: 'utf8',`.

- [ ] **Step 5: Chạy, thấy xanh**

Run: `HERMES_HOME=E:/Hermes E:/Hermes/hermes-agent/venv/Scripts/python.exe -m unittest test_zalo_permissions -v`
Expected: `Ran 6 tests … OK`.
Run: `HERMES_HOME=E:/Hermes npm run test:py`
Expected: `=== test_zalo_permissions.py ===` có mặt; `Tất cả test Python đều xanh.`

- [ ] **Step 6: Commit**

```bash
git add hermes-plugin/zalo_tools/group_permissions.py test_zalo_permissions.py scripts/run-python-tests.js
git commit -m "feat(plugin): đọc nóng permissions.json theo nhóm

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Chặn công cụ thuộc nút đang tắt — `guard_member_tool_call`

**Files:**
- Modify: `hermes-plugin/zalo_tools/tools.py` (import đầu tệp; hàm mới ngay trước `def guard_member_tool_call`; 3 dòng trong `guard_member_tool_call`)
- Test: `test_zalo_permissions.py`

**Interfaces:**
- Consumes: `group_permissions.feature_of`, `group_settings`, `FEATURE_LABELS` (Task 1); `bind_turn`, `_TURN`, `_outsider_spoke_after`, `_member_may_call` (sẵn có trong `tools.py`); `tools.tool_search.resolve_underlying_call(args) -> (name|None, args, error|None)` (lõi Hermes).
- Produces: `_group_feature_block(turn: dict, name: str, args) -> Optional[{"action": "block", "message": str}]`; `guard_member_tool_call` trả khối `block` có câu `"Nhóm này chưa bật tính năng <nhãn>. …"` khi bị chặn theo nhóm.

- [ ] **Step 1: Viết test** — thêm vào `test_zalo_permissions.py`, ngay trên `if __name__ == "__main__":`:

```python
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
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `HERMES_HOME=E:/Hermes E:/Hermes/hermes-agent/venv/Scripts/python.exe -m unittest test_zalo_permissions.GuardFeatureTest -v`
Expected: 4 FAIL/ERROR (`'NoneType' object is not subscriptable`) ở các test chờ `block`; `test_other_group…` và `test_no_zalo_turn…` đã xanh.

- [ ] **Step 3: Sửa `tools.py`**

  1. Ngay sau `from typing import Any, Dict, List, Optional` (dòng 28), thêm:

```python

from . import group_permissions
```

  2. Ngay **trên** `def guard_member_tool_call(` thêm:

```python
def _group_feature_block(turn: Dict[str, Any], name: str, args: Any) -> Optional[Dict[str, str]]:
    """Lượt của thành viên trong nhóm gọi công cụ thuộc nút đang tắt ở nhóm đó → chặn.

    Đọc ``permissions.json`` qua group_permissions (đọc lại khi tệp đổi). Chỉ áp
    trong nhóm: tin nhắn riêng không có bảng quyền nhóm nào. ``zalo_group_cron``
    chỉ bị chặn khi tạo mới — xem và xoá việc đã có vẫn được (spec §8.3).
    """
    if not turn.get("is_group"):
        return None
    real, real_args = name, args if isinstance(args, dict) else {}
    if name == "tool_call":
        try:
            from tools.tool_search import resolve_underlying_call

            real, real_args, error = resolve_underlying_call(real_args)
        except Exception:
            return None  # _member_may_call tự từ chối tool_call không tháo được
        if error or not real:
            return None
    feature = group_permissions.feature_of(real)
    if feature is None:
        return None
    if feature == "groupCron" and str((real_args or {}).get("action") or "").strip().lower() != "create":
        return None
    try:
        if group_permissions.group_settings(str(turn.get("thread_id") or ""))["features"][feature]:
            return None
    except Exception as exc:  # đọc quyền hỏng không được làm hỏng lượt
        logger.warning("[zalo] không đọc được quyền nhóm: %s", exc)
        return None
    label = group_permissions.FEATURE_LABELS[feature]
    logger.info("[zalo] chặn %s — nhóm %s đang tắt %s", real, turn.get("thread_id"), feature)
    return {
        "action": "block",
        "message": (f"Nhóm này chưa bật tính năng {label}. Hãy nói ngắn gọn với người hỏi rằng "
                    f"chủ bot đã tắt {label} trong nhóm này; đừng gọi lại công cụ này và đừng "
                    "dùng công cụ khác để làm thay."),
    }


```

  3. Trong `guard_member_tool_call`, thay

```python
    name = str(tool_name or "")
    if _member_may_call(name, args):
        return None
```

bằng

```python
    name = str(tool_name or "")
    blocked = _group_feature_block(turn, name, args)
    if blocked:
        return blocked
    if _member_may_call(name, args):
        return None
```

(Lượt chủ nhân đã `return None` ở dòng trên — chỉ lượt thành viên, hoặc lượt chủ nhân bị hạ quyền vì có người chen vào, tới được đây.)

- [ ] **Step 4: Chạy, thấy xanh**

Run: `HERMES_HOME=E:/Hermes E:/Hermes/hermes-agent/venv/Scripts/python.exe -m unittest test_zalo_permissions -v`
Expected: `Ran 12 tests … OK`.
Run: `HERMES_HOME=E:/Hermes npm run test:py` → `Tất cả test Python đều xanh.` (test ghim 20/38/1 trong `test_zalo_adapter.py` không đổi.)

- [ ] **Step 5: Commit**

```bash
git add hermes-plugin/zalo_tools/tools.py test_zalo_permissions.py
git commit -m "feat(plugin): chặn công cụ thuộc tính năng nhóm đã tắt

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Adapter — nhóm tắt, chỉ trả lời khi được tag, "không hứa suông"

**Files:**
- Modify: `hermes-plugin/zalo/adapter.py` (import gần dòng 94; `_on_message` quanh dòng 839–845 và 966–969; phương thức mới ngay trên `_remember_turn`)
- Test: `test_zalo_permissions.py`

**Interfaces:**
- Consumes: `group_permissions.group_settings`, `FEATURES`, `FEATURE_LABELS` (Task 1); `ZaloAdapter._is_owner`, `_is_mentioned`, `_recent_group_messages`, `MessageEvent.channel_context` (sẵn có).
- Produces: `ZaloAdapter._group_rules(thread_id: str) -> Optional[dict]` (staticmethod; lỗi bất ngờ → `None` = như chưa có tệp). Hành vi: thành viên trong nhóm `active=False` → không gọi agent, tin vẫn vào `_recent_group_messages`; `reply_only_tagged` của nhóm (khác `None`) thay `self._reply_only_tagged`; lượt thành viên có nút tắt → `channel_context` thêm `"[Nhóm này đang tắt: <nhãn>, <nhãn>. …]"`.

- [ ] **Step 1: Viết test** — thêm vào `test_zalo_permissions.py`, ngay trên `if __name__ == "__main__":`:

```python
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
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `HERMES_HOME=E:/Hermes E:/Hermes/hermes-agent/venv/Scripts/python.exe -m unittest test_zalo_permissions.AdapterGroupRulesTest -v`
Expected: 3 FAIL (`[] != …`, `0 != 1`, `'Nhóm này đang tắt…' not found`); `test_corrupt_file…` FAIL vì không có log WARNING.

- [ ] **Step 3: Sửa `adapter.py`**

  1. Ngay sau `from plugins.zalo_tools.tools import TOOLSET_OWNER, TOOLSET_PUBLIC`:

```python
from plugins.zalo_tools import group_permissions as _group_permissions
```

  2. Trong `_on_message`, thay

```python
        is_owner = self._is_owner(sender_uid)
        mentioned = self._is_mentioned(frame, text, is_owner=is_owner)
        # Trong nhóm: không trả lời khi chưa được gọi, nhưng vẫn giữ tin đó trong
        # rolling memory ở trên để câu tag ngay sau có ảnh/ngữ cảnh gần nhất.
        if is_group and self._reply_only_tagged and not mentioned:
```

bằng

```python
        is_owner = self._is_owner(sender_uid)
        # Bảng phân quyền nhóm của dashboard (permissions.json, đọc lại khi tệp
        # đổi). Nhóm bị tắt: tin của thành viên chỉ giữ làm ngữ cảnh như trên;
        # chủ nhân không bao giờ bị chặn bởi tệp này.
        group_rules = self._group_rules(thread_id) if is_group else None
        if group_rules and not group_rules["active"] and not is_owner:
            logger.debug("[zalo] nhóm %s đang tắt trên dashboard — %s chỉ giữ làm ngữ cảnh", thread_id, sender_uid)
            return
        reply_only_tagged = self._reply_only_tagged
        if group_rules and group_rules["reply_only_tagged"] is not None:
            reply_only_tagged = group_rules["reply_only_tagged"]
        mentioned = self._is_mentioned(frame, text, is_owner=is_owner)
        # Trong nhóm: không trả lời khi chưa được gọi, nhưng vẫn giữ tin đó trong
        # rolling memory ở trên để câu tag ngay sau có ảnh/ngữ cảnh gần nhất.
        if is_group and reply_only_tagged and not mentioned:
```

  3. Ngay sau khối

```python
        channel_context = (
            self._build_channel_context(context_entries, image_count, attach_failures)
            if is_group else self._image_failure_note(attach_failures)
        )
```

thêm

```python
        # Không hứa suông: thành viên hỏi trong nhóm đang tắt vài tính năng thì
        # nói trước cho mô hình biết, khỏi hứa "để mình tra" rồi bị chặn.
        if group_rules and not is_owner:
            off = [feature for feature in _group_permissions.FEATURES if not group_rules["features"][feature]]
            if off:
                labels = ", ".join(_group_permissions.FEATURE_LABELS[feature] for feature in off)
                note = (f"[Nhóm này đang tắt: {labels}. Đừng hứa hay thử làm những việc đó; "
                        "nếu được nhờ, nói rõ chủ bot chưa bật tính năng này trong nhóm.]")
                channel_context = f"{channel_context}\n{note}" if channel_context else note
```

  4. Ngay trên `def _remember_turn(self, turn: Dict[str, Any]) -> None:` thêm

```python
    @staticmethod
    def _group_rules(thread_id: str) -> Optional[Dict[str, Any]]:
        """Quyền nhóm từ permissions.json; lỗi bất ngờ → None (hành xử như chưa có tệp)."""
        try:
            return _group_permissions.group_settings(thread_id)
        except Exception as exc:
            logger.warning("[zalo] không đọc được quyền nhóm %s: %s", thread_id, exc)
            return None

```

- [ ] **Step 4: Chạy, thấy xanh**

Run: `HERMES_HOME=E:/Hermes E:/Hermes/hermes-agent/venv/Scripts/python.exe -m unittest test_zalo_permissions -v`
Expected: `Ran 16 tests … OK`.
Run: `HERMES_HOME=E:/Hermes npm run test:py` → `Tất cả test Python đều xanh.`

- [ ] **Step 5: Commit**

```bash
git add hermes-plugin/zalo/adapter.py test_zalo_permissions.py
git commit -m "feat(plugin): nhóm tắt, chỉ trả lời khi được tag theo nhóm, báo tính năng đang tắt

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `dashboard/lib/permissions.js` — đọc, kiểm, ghi `permissions.json`

**Files:**
- Create: `dashboard/lib/permissions.js`
- Test: `dashboard/lib/permissions.test.js`

**Interfaces:**
- Consumes: `writeJsonAtomic(path, value)` (`dashboard/lib/json-store.js`, GĐ1).
- Produces:
  - `export const FEATURES: Array<{ key, label, hint }>` (9 mục, thứ tự như Python), `export const FEATURE_KEYS: string[]`, `export const GROUP_ID = /^\d{1,32}$/`.
  - `export class InvalidPermissions extends Error` (`name === 'InvalidPermissions'`, `status === 400`).
  - `export function normalize(raw) -> { version: 1, defaults: Layer, groups: { [id]: { name?, ...Layer } } }` — ném khi không phải phiên bản 1.
  - `export function parseSettings(body) -> Settings` với `Settings = { active: boolean, replyOnlyTagged: boolean, features: { [key]: boolean } }` (đủ 9); ném `InvalidPermissions`.
  - `export function createPermissionsStore({ file, globalReplyOnlyTagged = true })` →
    - `get(): { exists: boolean, corrupt: boolean, defaults: Settings, groups: { [id]: { name: string, custom: true, ...Settings } } }` — giá trị đã gộp.
    - `setDefaults(settings: Settings) -> same shape as get()`.
    - `setGroup(groupId: string, settings: Settings, name = '') -> { state: same shape as get(), changed: string[] }` — `changed` liệt kê khoá khác mặc định (`'active'`, `'replyOnlyTagged'`, tên nút).

- [ ] **Step 1: Viết test** `dashboard/lib/permissions.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPermissionsStore, FEATURE_KEYS, normalize, parseSettings } from './permissions.js';

const G = '2054797107487294899';
const allOn = () => Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));
const settings = (over = {}, features = {}) => ({ active: true, replyOnlyTagged: true, ...over, features: { ...allOn(), ...features } });

function setup(t, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-perm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'zalo', 'permissions.json');
  return { file, store: createPermissionsStore({ file, ...opts }), disk: () => JSON.parse(readFileSync(file, 'utf8')) };
}

test('chưa có tệp: mọi tính năng bật, cờ tag theo cài đặt chung, không tạo tệp', (t) => {
  const s = setup(t, { globalReplyOnlyTagged: false });
  const v = s.store.get();
  assert.equal(v.exists, false);
  assert.deepEqual(v.defaults, { active: true, replyOnlyTagged: false, features: allOn() });
  assert.deepEqual(v.groups, {});
  assert.equal(existsSync(s.file), false);
});

test('lưu nhóm chỉ ghi khoá khác mặc định; trùng mặc định thì xoá mục của nhóm', (t) => {
  const s = setup(t);
  const { state, changed } = s.store.setGroup(G, settings({ replyOnlyTagged: false }, { web: false }), 'Tổ Hoá');
  assert.deepEqual(changed, ['replyOnlyTagged', 'web']);
  assert.deepEqual(s.disk(), { version: 1, defaults: {}, groups: { [G]: { name: 'Tổ Hoá', replyOnlyTagged: false, features: { web: false } } } });
  assert.equal(state.groups[G].custom, true);
  assert.equal(state.groups[G].features.kb, true);
  // Nhóm chưa chỉnh "kb" nên đi theo mặc định khi mặc định đổi.
  s.store.setDefaults(settings({}, { kb: false }));
  assert.equal(s.store.get().groups[G].features.kb, false);
  // Đưa về đúng mặc định → mục của nhóm biến mất.
  const back = s.store.setGroup(G, settings({}, { kb: false }));
  assert.deepEqual(back.changed, []);
  assert.deepEqual(s.disk().groups, {});
});

test('ghi nguyên tử, giữ .bak bản trước, quyền 600', (t) => {
  const s = setup(t);
  s.store.setDefaults(settings({}, { video: false }));
  s.store.setDefaults(settings({}, { voice: false }));
  assert.equal(s.disk().defaults.features.voice, false);
  assert.equal(JSON.parse(readFileSync(`${s.file}.bak`, 'utf8')).defaults.features.video, false);
  assert.equal(existsSync(`${s.file}.tmp`), false);
  if (process.platform !== 'win32') {
    assert.equal(statSync(s.file).mode & 0o777, 0o600);
    assert.equal(statSync(`${s.file}.bak`).mode & 0o777, 0o600);
  }
});

test('tệp hỏng: báo corrupt, hiện mặc định, không đổi tên tệp; lưu lại thì .bak giữ bản hỏng', (t) => {
  const s = setup(t);
  s.store.setDefaults(settings());
  writeFileSync(s.file, '{hỏng');
  const v = s.store.get();
  assert.equal(v.corrupt, true);
  assert.deepEqual(v.defaults.features, allOn());
  assert.equal(readFileSync(s.file, 'utf8'), '{hỏng');
  s.store.setGroup(G, settings({ active: false }));
  assert.equal(readFileSync(`${s.file}.bak`, 'utf8'), '{hỏng');
  assert.equal(s.store.get().corrupt, false);
});

test('normalize bỏ khoá lạ, sai kiểu, ID nhóm không phải số; sai phiên bản thì ném', () => {
  const n = normalize({ version: 1, defaults: { active: 'no', features: { web: false, lạ: false, kb: 1 } },
    groups: { abc: { active: false }, [G]: { name: ' Tổ Hoá ', active: false, features: [] }, '1': 'rác' } });
  assert.deepEqual(n, { version: 1, defaults: { features: { web: false } }, groups: { [G]: { name: 'Tổ Hoá', active: false }, 1: {} } });
  assert.throws(() => normalize({ version: 2 }));
  assert.throws(() => normalize([]));
});

test('parseSettings đòi đủ hai công tắc và đủ 9 nút boolean', () => {
  assert.deepEqual(parseSettings(settings({}, { web: false })).features.web, false);
  for (const bad of [null, [], { ...settings(), active: 'true' }, { ...settings(), replyOnlyTagged: undefined },
    { ...settings(), features: { ...allOn(), web: 'off' } }, { ...settings(), features: { ...allOn(), lạ: true } },
    { active: true, replyOnlyTagged: true, features: { web: true } }]) {
    assert.throws(() => parseSettings(bad), (e) => e.name === 'InvalidPermissions' && e.status === 400, JSON.stringify(bad));
  }
});

test('danh sách nút khớp FEATURES của plugin Python', () => {
  const py = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hermes-plugin', 'zalo_tools', 'group_permissions.py'), 'utf8');
  const tuple = /^FEATURES = \(([^)]*)\)/m.exec(py)[1];
  assert.deepEqual([...tuple.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]), FEATURE_KEYS);
});
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `node --test dashboard/lib/permissions.test.js`
Expected: FAIL — `Cannot find module '…/dashboard/lib/permissions.js'`.

- [ ] **Step 3: Viết `dashboard/lib/permissions.js`**

```js
/**
 * Phân quyền Bot theo nhóm (spec §8): đọc/ghi/kiểm `<HERMES_HOME>/zalo/permissions.json`.
 * Plugin Python (hermes-plugin/zalo_tools/group_permissions.py) đọc nóng tệp này — hai bên
 * phải cùng lược đồ: lớp gộp mặc định gốc ← `defaults` ← `groups[id]`, khoá thiếu rơi xuống lớp dưới.
 * Ghi nguyên tử (tệp tạm rồi đổi tên), quyền 600, giữ bản trước ở `.bak`.
 */
import { chmodSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './json-store.js';

export const FEATURES = [
  { key: 'web', label: 'Tra cứu web', hint: 'Tìm và đọc trang web' },
  { key: 'files', label: 'Gửi và tạo tệp', hint: 'Gửi tệp, tạo Word/Excel/PowerPoint, xử lý PDF' },
  { key: 'voice', label: 'Tin nhắn thoại', hint: 'Bot trả lời bằng giọng nói' },
  { key: 'reminders', label: 'Nhắc hẹn', hint: 'Tạo, xem, xoá lời nhắc của Zalo' },
  { key: 'groupCron', label: 'Hẹn giờ cho nhóm', hint: 'Thành viên tạo việc bot tự làm theo lịch. Tắt chỉ chặn tạo mới — việc đã tạo vẫn chạy' },
  { key: 'kb', label: 'Kho tài liệu', hint: 'Đọc tài liệu chủ bot đã mở cho nhóm' },
  { key: 'people', label: 'Sổ người quen', hint: 'Ghi nhớ và tra hồ sơ thành viên' },
  { key: 'academic', label: 'Tra cứu học thuật', hint: 'Tìm bài báo khoa học' },
  { key: 'video', label: 'Video', hint: 'Xem thông tin và tải video từ link' },
];
export const FEATURE_KEYS = FEATURES.map((f) => f.key);
const SWITCHES = ['active', 'replyOnlyTagged'];
export const GROUP_ID = /^\d{1,32}$/;
const MAX_NAME = 120;

export class InvalidPermissions extends Error {
  constructor(message) { super(message); this.name = 'InvalidPermissions'; this.status = 400; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Một lớp: chỉ giữ khoá biết và đúng kiểu boolean — giống `_layer` bên Python. */
function layer(raw) {
  if (!isObj(raw)) return {};
  const out = {};
  for (const k of SWITCHES) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  const features = {};
  if (isObj(raw.features)) for (const k of FEATURE_KEYS) if (typeof raw.features[k] === 'boolean') features[k] = raw.features[k];
  if (Object.keys(features).length) out.features = features;
  return out;
}

/** Chuẩn hoá nội dung tệp; ném lỗi khi không phải lược đồ phiên bản 1. */
export function normalize(raw) {
  if (!isObj(raw) || raw.version !== 1) throw new Error('không phải permissions.json phiên bản 1');
  const groups = {};
  for (const [id, entry] of Object.entries(isObj(raw.groups) ? raw.groups : {})) {
    if (!GROUP_ID.test(id)) continue;
    const l = layer(entry);
    const name = isObj(entry) && typeof entry.name === 'string' ? entry.name.trim().slice(0, MAX_NAME) : '';
    groups[id] = name ? { name, ...l } : l;
  }
  return { version: 1, defaults: layer(raw.defaults), groups };
}

/** Kiểm thân request: đủ hai công tắc và đủ 9 nút, tất cả boolean. */
export function parseSettings(body) {
  if (!isObj(body)) throw new InvalidPermissions('Dữ liệu phân quyền không hợp lệ — tải lại trang rồi thử lại.');
  for (const k of SWITCHES) {
    if (typeof body[k] !== 'boolean') throw new InvalidPermissions('Thiếu công tắc Hoạt động hoặc Chỉ trả lời khi được tag — tải lại trang rồi thử lại.');
  }
  const f = body.features;
  if (!isObj(f) || Object.keys(f).some((k) => !FEATURE_KEYS.includes(k)) || FEATURE_KEYS.some((k) => typeof f[k] !== 'boolean')) {
    throw new InvalidPermissions('Danh sách tính năng không hợp lệ — tải lại trang rồi thử lại.');
  }
  return { active: body.active, replyOnlyTagged: body.replyOnlyTagged, features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, f[k]])) };
}

/**
 * @param {{ file: string, globalReplyOnlyTagged?: boolean }} opts
 *   globalReplyOnlyTagged — cờ ZALO_GROUP_REPLY_ONLY_TAGGED đang dùng, chỉ để hiển thị khi tệp chưa ghi khoá này.
 */
export function createPermissionsStore({ file, globalReplyOnlyTagged = true }) {
  const builtin = () => ({ active: true, replyOnlyTagged: globalReplyOnlyTagged, features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) });
  const merge = (base, l) => ({
    active: l.active ?? base.active,
    replyOnlyTagged: l.replyOnlyTagged ?? base.replyOnlyTagged,
    features: { ...base.features, ...(l.features || {}) },
  });

  /** `{ data, exists, corrupt }` — tệp hỏng thì data rỗng (bot cũng đang dùng mặc định), không đổi tên tệp. */
  function read() {
    if (!existsSync(file)) return { data: { version: 1, defaults: {}, groups: {} }, exists: false, corrupt: false };
    try {
      return { data: normalize(JSON.parse(readFileSync(file, 'utf8'))), exists: true, corrupt: false };
    } catch (err) {
      console.warn(`[dashboard] ${file} hỏng — bot đang dùng mặc định: ${err.message}`);
      return { data: { version: 1, defaults: {}, groups: {} }, exists: true, corrupt: true };
    }
  }

  function write(data) {
    if (existsSync(file)) {
      copyFileSync(file, `${file}.bak`);
      try { chmodSync(`${file}.bak`, 0o600); } catch { /* Windows */ }
    }
    writeJsonAtomic(file, data);
  }

  const view = ({ data, exists, corrupt }) => {
    const defaults = merge(builtin(), data.defaults);
    const groups = Object.fromEntries(Object.entries(data.groups).map(([id, g]) => [id, { name: g.name || '', custom: true, ...merge(defaults, g) }]));
    return { exists, corrupt, defaults, groups };
  };

  return {
    /** Trạng thái đã gộp cho giao diện: `{ exists, corrupt, defaults, groups: { id: { name, custom, active, replyOnlyTagged, features } } }`. */
    get() { return view(read()); },
    /** Lưu mặc định: ghi đủ mọi khoá (người dùng đã chọn từng nút). */
    setDefaults(settings) {
      const { data } = read();
      data.defaults = settings;
      write(data);
      return view({ data, exists: true, corrupt: false });
    },
    /**
     * Lưu một nhóm: chỉ ghi khoá khác mặc định (spec §8.1), để nút chưa đụng tới đi theo mặc định sau này.
     * Không còn khoá nào khác → xoá mục của nhóm. Trả `{ state, changed: string[] }` (các khoá khác mặc định).
     */
    setGroup(groupId, settings, name = '') {
      if (!GROUP_ID.test(groupId)) throw new InvalidPermissions('Nhóm không hợp lệ — chọn lại từ danh sách.');
      const { data } = read();
      const defaults = merge(builtin(), data.defaults);
      const entry = {};
      for (const k of SWITCHES) if (settings[k] !== defaults[k]) entry[k] = settings[k];
      const features = Object.fromEntries(FEATURE_KEYS.filter((k) => settings.features[k] !== defaults.features[k]).map((k) => [k, settings.features[k]]));
      if (Object.keys(features).length) entry.features = features;
      const changed = [...Object.keys(entry).filter((k) => k !== 'features'), ...Object.keys(features)];
      const cleanName = String(name || data.groups[groupId]?.name || '').trim().slice(0, MAX_NAME);
      if (changed.length) data.groups[groupId] = cleanName ? { name: cleanName, ...entry } : entry;
      else delete data.groups[groupId];
      write(data);
      return { state: view({ data, exists: true, corrupt: false }), changed };
    },
  };
}
```

- [ ] **Step 4: Chạy, thấy xanh**

Run: `node --test dashboard/lib/permissions.test.js`
Expected: `# pass 7`, `# fail 0` (trên Windows hai `assert` quyền 600 được bỏ qua bên trong test).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/permissions.js dashboard/lib/permissions.test.js
git commit -m "feat(dashboard): đọc, kiểm, ghi nguyên tử permissions.json

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Route phân quyền + danh sách nhóm, nối vào app và Nhật ký

**Files:**
- Create: `dashboard/routes/permissions.js`
- Test: `dashboard/routes/permissions.test.js`
- Modify: `dashboard/app.js`, `dashboard/server.js` (`buildDeps`), `dashboard/server.test.js`, `dashboard/test-helpers.js` (`makeDeps`), `dashboard/lib/audit-feed.js` (`ACTION_LABELS`)

**Interfaces:**
- Consumes: `FEATURES`, `GROUP_ID`, `parseSettings`, `createPermissionsStore` (Task 4); `requireAuth`; `failSidecar` (`route-errors.js`); `fallbackName(id, 1)` và `threadNames.load(): Promise<Map<id, name>>` (`thread-names.js`); `sidecar.groups(): Promise<Array<{ id, name, members }>>`; `activity.append({ actor, action, detail })`; `paths.permissionsFile`.
- Produces:
  - `export function permissionRoutes({ permissions, sidecar, threadNames, activity }) -> express.Router`.
  - `export function describeSettings(settings) -> string` (ví dụ `"Tạm tắt · chỉ trả lời khi được tag · tắt: Tra cứu web"`).
  - `GET /api/permissions` → `{ ok, features: FEATURES, exists, corrupt, defaults: Settings, groups: { [id]: { name, custom, ...Settings } } }`.
  - `GET /api/groups` → `{ ok, groups: Array<{ id: string, name: string, members: number }> }` (tên trùng ID → `Nhóm …1234`; ID không phải số bị bỏ); lỗi bot → mã như `failSidecar`.
  - `PUT /api/permissions/defaults` và `PUT /api/permissions/groups/:groupId` (thân `Settings`) → cùng dạng `GET /api/permissions`.
  - `deps.permissions` trong `buildDeps` và `makeDeps`; nhãn Nhật ký `permissions_defaults` = "Đổi phân quyền mặc định", `permissions_group` = "Đổi phân quyền nhóm".

- [ ] **Step 1: Viết test** `dashboard/routes/permissions.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURE_KEYS } from '../lib/permissions.js';
import { fakeSidecar, loginAs, makeDeps, startApp } from '../test-helpers.js';

const G = '2054797107487294899';
const allOn = () => Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));
const body = (over = {}, features = {}) => ({ active: true, replyOnlyTagged: true, ...over, features: { ...allOn(), ...features } });

async function ready(t, overrides = {}) {
  const deps = makeDeps(t, overrides);
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const disk = () => JSON.parse(readFileSync(join(deps.dir, 'zalo', 'permissions.json'), 'utf8'));
  return { deps, call, admin, owner, disk };
}

test('chưa đăng nhập → 401 ở mọi route phân quyền', async (t) => {
  const { call } = await ready(t);
  for (const [path, method] of [['/api/permissions', 'GET'], ['/api/groups', 'GET'],
    ['/api/permissions/defaults', 'PUT'], [`/api/permissions/groups/${G}`, 'PUT']]) {
    assert.equal((await call(path, { method, body: method === 'PUT' ? body() : undefined })).status, 401, path);
  }
});

test('Chủ bot xem và sửa được phân quyền (spec §6), có hiệu lực trong tệp ngay', async (t) => {
  const { call, owner, disk, deps } = await ready(t, { sidecar: fakeSidecar({ groups: async () => [{ id: G, name: 'Tổ Hoá', members: 12 }] }) });
  const first = await call('/api/permissions', { cookie: owner });
  assert.equal(first.status, 200);
  assert.equal(first.json.exists, false);
  assert.deepEqual(first.json.features.map((f) => f.key), FEATURE_KEYS);
  assert.deepEqual(first.json.defaults.features, allOn());

  const saved = await call(`/api/permissions/groups/${G}`, { method: 'PUT', cookie: owner, body: body({ active: false }, { web: false }) });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.groups[G], { name: 'Tổ Hoá', custom: true, active: false, replyOnlyTagged: true, features: { ...allOn(), web: false } });
  assert.deepEqual(disk().groups[G], { name: 'Tổ Hoá', active: false, features: { web: false } });

  const log = deps.activity.list();
  assert.equal(log[0].actor, 'khach');
  assert.equal(log[0].action, 'permissions_group');
  assert.equal(log[0].detail, 'Tổ Hoá: Tạm tắt · chỉ trả lời khi được tag · tắt: Tra cứu web');
});

test('lưu mặc định ghi đủ khoá; nhóm đưa về đúng mặc định thì mục riêng biến mất', async (t) => {
  const { call, admin, disk, deps } = await ready(t);
  const d = await call('/api/permissions/defaults', { method: 'PUT', cookie: admin, body: body({ replyOnlyTagged: false }, { video: false }) });
  assert.equal(d.status, 200);
  assert.deepEqual(disk().defaults, { active: true, replyOnlyTagged: false, features: { ...allOn(), video: false } });
  await call(`/api/permissions/groups/${G}`, { method: 'PUT', cookie: admin, body: body({}, { video: false }) });
  assert.deepEqual(disk().groups[G], { replyOnlyTagged: true }); // bot chưa biết tên nhóm này → không ghi name
  await call(`/api/permissions/groups/${G}`, { method: 'PUT', cookie: admin, body: body({ replyOnlyTagged: false }, { video: false }) });
  assert.deepEqual(disk().groups, {});
  assert.match(deps.activity.list()[0].detail, /: dùng mặc định$/);
});

test('dữ liệu sai → 400 tiếng Việt, tệp không đổi', async (t) => {
  const { call, admin, deps } = await ready(t);
  for (const [path, payload] of [
    ['/api/permissions/groups/abc', body()],
    [`/api/permissions/groups/${G}`, { ...body(), active: 'true' }],
    [`/api/permissions/groups/${G}`, { ...body(), features: { web: true } }],
    ['/api/permissions/defaults', { ...body(), features: { ...allOn(), lạ: true } }],
  ]) {
    const res = await call(path, { method: 'PUT', cookie: admin, body: payload });
    assert.equal(res.status, 400, path);
    assert.match(res.json.error, /—/);
  }
  assert.equal(deps.permissions.get().exists, false);
});

test('tệp hỏng: GET báo corrupt và mặc định; lưu ghi lại tệp sạch', async (t) => {
  const { call, admin, deps, disk } = await ready(t);
  await call('/api/permissions/defaults', { method: 'PUT', cookie: admin, body: body() });
  writeFileSync(join(deps.dir, 'zalo', 'permissions.json'), 'không phải json');
  const res = await call('/api/permissions', { cookie: admin });
  assert.equal(res.json.corrupt, true);
  assert.deepEqual(res.json.defaults.features, allOn());
  await call(`/api/permissions/groups/${G}`, { method: 'PUT', cookie: admin, body: body({}, { kb: false }) });
  assert.equal(disk().version, 1);
});

test('GET /api/groups: tên trùng ID thành tên dự phòng; bot tắt → 503 tiếng Việt', async (t) => {
  const { call, admin } = await ready(t, { sidecar: fakeSidecar({ groups: async () => [
    { id: G, name: G, members: 3 }, { id: '200', name: 'Tổ Hoá', members: 12 }, { id: 'x', name: 'lạ' },
  ] }) });
  const res = await call('/api/groups', { cookie: admin });
  assert.deepEqual(res.json.groups, [
    { id: G, name: 'Nhóm …4899', members: 3 }, { id: '200', name: 'Tổ Hoá', members: 12 },
  ]);
  const down = await ready(t, { sidecar: fakeSidecar({ groups: async () => { throw Object.assign(new Error('x'), { name: 'SidecarDown' }); } }) });
  const off = await down.call('/api/groups', { cookie: down.admin });
  assert.equal(off.status, 503);
  assert.match(off.json.error, /Kết nối Zalo đang tắt/);
});
```

Và trong `dashboard/server.test.js`, mảng `requiredKeys` của test `buildDeps returns all required keys`: thêm `'permissions'` sau `'threadNames'`.

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `node --test dashboard/routes/permissions.test.js dashboard/server.test.js`
Expected: FAIL — `Cannot find module '…/routes/permissions.js'`.

- [ ] **Step 3: Viết `dashboard/routes/permissions.js`**

```js
// Phân quyền Bot theo nhóm (spec §7.1, §8): Quản trị và Chủ bot đều xem và sửa (spec §6).
// Lưu là có hiệu lực ngay — plugin đọc lại permissions.json khi tệp đổi.
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { FEATURES, GROUP_ID, parseSettings } from '../lib/permissions.js';
import { fallbackName } from '../lib/thread-names.js';
import { failSidecar } from '../lib/route-errors.js';

const SAVE_FAIL = 'Chưa lưu được phân quyền — thử lại, nếu vẫn lỗi hãy báo người cài đặt.';
const READ_FAIL = 'Chưa đọc được phân quyền — tải lại trang, nếu vẫn lỗi hãy báo người cài đặt.';
const label = Object.fromEntries(FEATURES.map((f) => [f.key, f.label]));

/** Một dòng dễ đọc cho Nhật ký: "Hoạt động · chỉ trả lời khi được tag · tắt: Tra cứu web, Video". */
export function describeSettings(s) {
  const off = FEATURES.filter((f) => !s.features[f.key]).map((f) => label[f.key]);
  return [s.active ? 'Hoạt động' : 'Tạm tắt', s.replyOnlyTagged ? 'chỉ trả lời khi được tag' : 'trả lời mọi tin',
    off.length ? `tắt: ${off.join(', ')}` : 'bật mọi tính năng'].join(' · ');
}

export function permissionRoutes({ permissions, sidecar, threadNames, activity }) {
  const r = express.Router();
  const fail = (res, err, fallback) => {
    if (err?.name === 'InvalidPermissions') return res.status(400).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };

  r.get('/permissions', requireAuth, (req, res) => {
    try { res.json({ ok: true, features: FEATURES, ...permissions.get() }); } catch (err) { fail(res, err, READ_FAIL); }
  });

  r.get('/groups', requireAuth, async (req, res) => {
    try {
      const groups = await sidecar.groups();
      res.json({
        ok: true,
        groups: (Array.isArray(groups) ? groups : []).filter((g) => GROUP_ID.test(String(g?.id ?? ''))).map((g) => {
          const id = String(g.id);
          const name = String(g.name || '').trim();
          return { id, name: name && name !== id ? name : fallbackName(id, 1), members: Number(g.members) || 0 };
        }),
      });
    } catch (err) { failSidecar(res, err); }
  });

  r.put('/permissions/defaults', requireAuth, (req, res) => {
    try {
      const s = parseSettings(req.body);
      const state = permissions.setDefaults(s);
      activity.append({ actor: req.user.username, action: 'permissions_defaults', detail: describeSettings(s) });
      res.json({ ok: true, features: FEATURES, ...state });
    } catch (err) { fail(res, err, SAVE_FAIL); }
  });

  r.put('/permissions/groups/:groupId', requireAuth, async (req, res) => {
    const { groupId } = req.params;
    if (!GROUP_ID.test(groupId)) return res.status(400).json({ ok: false, error: 'Nhóm không hợp lệ — chọn lại từ danh sách.' });
    let s;
    try { s = parseSettings(req.body); } catch (err) { return fail(res, err, SAVE_FAIL); }
    const name = (await threadNames.load()).get(groupId) || '';
    try {
      const { state, changed } = permissions.setGroup(groupId, s, name);
      activity.append({
        actor: req.user.username, action: 'permissions_group',
        detail: `${name || fallbackName(groupId, 1)}: ${changed.length ? describeSettings(s) : 'dùng mặc định'}`,
      });
      res.json({ ok: true, features: FEATURES, ...state });
    } catch (err) { fail(res, err, SAVE_FAIL); }
  });

  return r;
}
```

- [ ] **Step 4: Nối vào app, deps, Nhật ký**

`dashboard/app.js` — sau `import { adminRoutes } from './routes/admin.js';` thêm `import { permissionRoutes } from './routes/permissions.js';`; sau `app.use('/api', auditRoutes(deps));` thêm `app.use('/api', permissionRoutes(deps));`.

`dashboard/server.js` — sau `import { createThreadNames } from './lib/thread-names.js';` thêm `import { createPermissionsStore } from './lib/permissions.js';`; trong object trả về của `buildDeps`, ngay sau `activity: createActivityLog(paths.activityFile),` thêm:

```js
    // Cờ tag chung của bot (adapter: mặc định bật) — chỉ để hiện đúng khi permissions.json chưa ghi khoá này.
    permissions: createPermissionsStore({
      file: paths.permissionsFile,
      globalReplyOnlyTagged: ['1', 'true', 'yes', 'on'].includes(String(env.ZALO_GROUP_REPLY_ONLY_TAGGED ?? 'true').trim().toLowerCase()),
    }),
```

`dashboard/test-helpers.js` — sau `import { createThreadNames } from './lib/thread-names.js';` thêm `import { createPermissionsStore } from './lib/permissions.js';`; trong `makeDeps`, sau `activity: createActivityLog(join(dir, 'activity.jsonl')),` thêm:

```js
    permissions: createPermissionsStore({ file: join(dir, 'zalo', 'permissions.json') }),
```

`dashboard/lib/audit-feed.js` — trong `ACTION_LABELS`, sau `telegram_settings: 'Đổi cài đặt Telegram cảnh báo',` thêm:

```js
  permissions_defaults: 'Đổi phân quyền mặc định',
  permissions_group: 'Đổi phân quyền nhóm',
```

- [ ] **Step 5: Chạy, thấy xanh**

Run: `node --test dashboard/routes/permissions.test.js dashboard/server.test.js`
Expected: `# fail 0`.
Run: `HERMES_HOME=E:/Hermes npm run test:js` → `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add dashboard/routes/permissions.js dashboard/routes/permissions.test.js dashboard/app.js dashboard/server.js dashboard/server.test.js dashboard/test-helpers.js dashboard/lib/audit-feed.js
git commit -m "feat(dashboard): API phân quyền theo nhóm và danh sách nhóm

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Giao diện **Phân quyền Bot**

**Files:**
- Create: `dashboard/public/views/permissions.js`
- Modify: `dashboard/public/views/shell.js`, `dashboard/public/style.css`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `GET /api/permissions`, `GET /api/groups`, `PUT /api/permissions/defaults`, `PUT /api/permissions/groups/:id` (Task 5); `api` (`api.js`); `html, Icon, Live, Notice, PageHead, Spinner` (`ui.js`); `fold` (`fold.js`); lớp CSS sẵn có `card, conv-list, conv, conv-top, conv-name, conv-preview, chat-search, thread-head, only-mobile, chat-empty, check, badge badge-*, tag, row, btn*`.
- Produces: `export function Permissions()`; hàm thuần `mergeGroups(groups, perms)`, `sameSettings(a, b)`, `groupBadge(g) -> { kind, text } | null`, hằng `DEFAULTS_KEY = 'defaults'`; route `#/permissions`, mục "Phân quyền Bot" (biểu tượng `shield`) trong nhóm "Hội thoại" của thanh bên.

- [ ] **Step 1: Viết test** — thêm vào cuối `dashboard/public/public.test.js`:

```js
test('phân quyền: gộp nhóm của bot với tệp, so thay đổi, nhãn trong danh sách', async () => {
  const { mergeGroups, sameSettings, groupBadge } = await import('./views/permissions.js');
  const on = { web: true, kb: true };
  const perms = {
    defaults: { active: true, replyOnlyTagged: true, features: on },
    groups: {
      '300': { name: 'Tổ Hoá', custom: true, active: true, replyOnlyTagged: false, features: { web: false, kb: true } },
      '400': { name: '', custom: true, active: false, replyOnlyTagged: true, features: on },
    },
  };
  const list = mergeGroups([{ id: '200', name: 'Đoàn trường', members: 40 }, { id: '300', name: 'Tổ Hoá mới', members: 12 }], perms);
  assert.deepEqual(list.map((g) => [g.id, g.name, g.members, g.custom]), [
    ['200', 'Đoàn trường', 40, false], ['300', 'Tổ Hoá mới', 12, true], ['400', 'Nhóm …400', null, true],
  ]);
  assert.deepEqual(list[0].features, on);
  assert.equal(list[1].replyOnlyTagged, false);
  list[0].features.web = false;
  assert.equal(perms.defaults.features.web, true, 'không sửa nhầm vào mặc định');
  assert.equal(sameSettings(perms.defaults, { active: true, replyOnlyTagged: true, features: { kb: true, web: true } }), true);
  assert.equal(sameSettings(perms.defaults, { active: true, replyOnlyTagged: true, features: { kb: true, web: false } }), false);
  assert.deepEqual(groupBadge(list[2]), { kind: 'danger', text: 'Đang tắt' });
  assert.deepEqual(groupBadge(list[1]), { kind: 'warn', text: 'Tắt 1 tính năng' });
  assert.equal(groupBadge({ active: true, custom: false, features: on }), null);
  assert.deepEqual(groupBadge({ active: true, custom: true, features: on }), { kind: 'idle', text: 'Chỉnh riêng' });
});
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `node --test dashboard/public/public.test.js`
Expected: FAIL — `Cannot find module '…/views/permissions.js'`.

- [ ] **Step 3: Viết `dashboard/public/views/permissions.js`**

```js
// Phân quyền Bot (spec §9): trái là "Mặc định" + danh sách nhóm có ô tìm; phải là Hoạt động,
// Chỉ trả lời khi được tag và 9 nút tính năng. Lưu là có hiệu lực ngay.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Notice, PageHead, Spinner } from '../ui.js';
import { fold } from '../fold.js';

export const DEFAULTS_KEY = 'defaults';
const pick = (s) => ({ active: s.active, replyOnlyTagged: s.replyOnlyTagged, features: { ...s.features } });

/**
 * Gộp danh sách nhóm của bot với permissions.json: nhóm bot đang ở (theo thứ tự bot trả) trước,
 * rồi nhóm chỉ còn trong tệp (bot đã rời hoặc Zalo đang tắt). Mỗi nhóm mang quyền đang hiệu lực.
 */
export function mergeGroups(groups, perms) {
  const seen = new Set();
  const out = [];
  const add = (id, name, members) => {
    if (seen.has(id)) return;
    seen.add(id);
    const own = perms.groups[id];
    out.push({ id, name: name || `Nhóm …${id.slice(-4)}`, members, custom: Boolean(own), ...pick(own || perms.defaults) });
  };
  for (const g of groups || []) add(g.id, g.name, g.members);
  for (const [id, g] of Object.entries(perms.groups)) add(id, g.name, null);
  return out;
}

export function sameSettings(a, b) {
  return a.active === b.active && a.replyOnlyTagged === b.replyOnlyTagged
    && Object.keys({ ...a.features, ...b.features }).every((k) => a.features[k] === b.features[k]);
}

/** Nhãn ngắn cạnh tên nhóm trong danh sách; null khi nhóm đang đúng mặc định. */
export function groupBadge(g) {
  if (!g.active) return { kind: 'danger', text: 'Đang tắt' };
  const off = Object.values(g.features).filter((v) => !v).length;
  if (off) return { kind: 'warn', text: `Tắt ${off} tính năng` };
  return g.custom ? { kind: 'idle', text: 'Chỉnh riêng' } : null;
}

function Toggle({ id, checked, onChange, label, hint }) {
  return html`<div class="perm-row">
    <label class="check" for=${id}><input id=${id} type="checkbox" checked=${checked}
      aria-describedby=${hint ? `${id}-hint` : undefined} onChange=${(e) => onChange(e.currentTarget.checked)} />${label}</label>
    ${hint ? html`<small id=${`${id}-hint`} class="muted">${hint}</small>` : null}
  </div>`;
}

function Editor({ target, value, defaults, features, onSaved, onBack }) {
  const isGroup = target.id !== DEFAULTS_KEY;
  const [draft, setDraft] = useState(() => pick(value));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const dirty = !sameSettings(draft, value);
  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setMsg({}); };
  const setFeature = (k, v) => { setDraft((d) => ({ ...d, features: { ...d.features, [k]: v } })); setMsg({}); };

  async function save(e) {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy(true); setMsg({});
    try {
      const path = isGroup ? `/api/permissions/groups/${encodeURIComponent(target.id)}` : '/api/permissions/defaults';
      const r = await api(path, { method: 'PUT', body: draft });
      onSaved(r);
      setMsg({ ok: 'Đã lưu — bot áp dụng ngay, không cần khởi động lại.' });
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }

  const p = `perm-${target.id}`;
  return html`<form onSubmit=${save} novalidate>
    <header class="thread-head">
      <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
      <h2>${target.name}</h2>
      ${isGroup && target.members ? html`<span class="tag">${target.members} thành viên</span>` : null}
    </header>
    <p class="muted small">${isGroup
      ? 'Chỉ áp cho thành viên trong nhóm này. Chủ nhân bot luôn dùng được mọi tính năng.'
      : 'Áp cho nhóm mới và mọi nhóm chưa chỉnh riêng. Chủ nhân bot luôn dùng được mọi tính năng; tin nhắn riêng không theo bảng này.'}</p>
    <fieldset class="perm-set">
      <legend>Cách bot trả lời</legend>
      <${Toggle} id=${`${p}-active`} checked=${draft.active} onChange=${(v) => set({ active: v })} label="Hoạt động"
        hint="Tắt thì bot không trả lời thành viên trong nhóm (vẫn đọc tin để hiểu ngữ cảnh khi chủ nhân hỏi)." />
      <${Toggle} id=${`${p}-tag`} checked=${draft.replyOnlyTagged} onChange=${(v) => set({ replyOnlyTagged: v })} label="Chỉ trả lời khi được tag"
        hint="Tắt thì bot trả lời mọi tin trong nhóm." />
    </fieldset>
    <fieldset class="perm-set" disabled=${!draft.active}>
      <legend>Tính năng cho thành viên</legend>
      ${features.map((f) => html`<${Toggle} key=${f.key} id=${`${p}-${f.key}`} checked=${draft.features[f.key]}
        onChange=${(v) => setFeature(f.key, v)} label=${f.label} hint=${f.hint} />`)}
    </fieldset>
    <div class="row">
      <button class="btn btn-primary" disabled=${busy || !dirty}>${busy ? 'Đang lưu…' : 'Lưu'}</button>
      ${isGroup ? html`<button type="button" class="btn btn-secondary" disabled=${busy || sameSettings(draft, defaults)}
        onClick=${() => set(pick(defaults))}>Dùng mặc định</button>` : null}
      ${dirty ? html`<small class="muted">Có thay đổi chưa lưu.</small>` : null}
    </div>
    <${Live} error=${msg.error} ok=${msg.ok} />
  </form>`;
}

export function Permissions() {
  const [perms, setPerms] = useState(null);
  const [groups, setGroups] = useState(null);
  const [groupsError, setGroupsError] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    api('/api/permissions').then((r) => { if (alive) setPerms(r); }, (err) => { if (alive) setError(err.message); });
    api('/api/groups').then((r) => { if (alive) setGroups(r.groups); },
      (err) => { if (alive) { setGroups([]); setGroupsError(err.message); } });
    return () => { alive = false; };
  }, []);

  if (error) return html`<${PageHead} title="Phân quyền Bot" /><${Notice} kind="danger">${error}<//>`;
  if (!perms || groups === null) return html`<${PageHead} title="Phân quyền Bot" /><${Spinner} />`;

  const list = mergeGroups(groups, perms);
  const needle = fold(query.trim());
  const shown = list.filter((g) => !needle || fold(g.name).includes(needle));
  const defaultsTarget = { id: DEFAULTS_KEY, name: 'Mặc định cho nhóm mới', members: null, ...pick(perms.defaults) };
  const target = selected === DEFAULTS_KEY ? defaultsTarget : list.find((g) => g.id === selected) || null;

  return html`
    <${PageHead} title="Phân quyền Bot" sub="Chọn bot được làm gì trong từng nhóm. Lưu là có hiệu lực ngay." />
    ${perms.corrupt ? html`<${Notice} kind="warn">Tệp phân quyền bị hỏng nên bot đang dùng mặc định (mọi tính năng bật). Lưu lại một mục bất kỳ để ghi tệp mới.<//>` : null}
    ${groupsError ? html`<${Notice} kind="warn">Chưa lấy được danh sách nhóm: ${groupsError} Danh sách dưới đây chỉ có nhóm đã chỉnh trước đó.<//>` : null}
    <div class=${`perm${target ? ' has-sel' : ''}`}>
      <section class="card perm-list" aria-label="Nhóm">
        <div class="chat-search">
          <label for="perm-q" class="sr-only">Lọc nhóm theo tên</label>
          <input id="perm-q" type="search" maxlength="100" placeholder="Lọc nhóm theo tên" value=${query}
            onInput=${(e) => setQuery(e.currentTarget.value)} />
        </div>
        <ul class="conv-list">
          <li><button type="button" class=${`conv${selected === DEFAULTS_KEY ? ' active' : ''}`} onClick=${() => setSelected(DEFAULTS_KEY)}>
            <span class="conv-top"><span class="conv-name"><${Icon} name="shield" size=${16} /> Mặc định cho nhóm mới</span></span>
            <span class="conv-preview">Nhóm chưa chỉnh riêng dùng mục này</span>
          </button></li>
          ${shown.map((g) => {
            const badge = groupBadge(g);
            return html`<li key=${g.id}><button type="button" class=${`conv${selected === g.id ? ' active' : ''}`}
              aria-current=${selected === g.id ? 'true' : undefined} onClick=${() => setSelected(g.id)}>
              <span class="conv-top"><span class="conv-name">${g.name}</span>
                ${badge ? html`<span class=${`badge badge-${badge.kind}`}>${badge.text}</span>` : null}</span>
              <span class="conv-preview">${g.members ? `${g.members} thành viên` : 'Bot không còn thấy nhóm này'}</span>
            </button></li>`;
          })}
        </ul>
        ${list.length && !shown.length ? html`<p class="muted small">Không có nhóm nào trùng tên.</p>` : null}
        ${!list.length && !groupsError ? html`<p class="muted small">Bot chưa ở nhóm nào.</p>` : null}
      </section>
      <section class="card perm-edit" aria-label="Quyền của nhóm">
        ${target
          ? html`<${Editor} key=${target.id} target=${target} value=${pick(target)}
              defaults=${pick(perms.defaults)} features=${perms.features} onSaved=${setPerms} onBack=${() => setSelected(null)} />`
          : html`<p class="muted chat-empty">Chọn "Mặc định" hoặc một nhóm bên trái để chỉnh.</p>`}
      </section>
    </div>`;
}
```

- [ ] **Step 4: Thanh bên, route, CSS**

`dashboard/public/views/shell.js`:
  - sau `import { Audit } from './audit.js';` thêm `import { Permissions } from './permissions.js';`
  - trong `ROUTES`, sau `'/chats': { view: Chats },` thêm `'/permissions': { view: Permissions },`
  - trong `GROUPS` thay dòng `{ label: 'Hội thoại', items: [{ path: '/chats', text: 'Phiên chat', icon: 'chat' }] },` bằng:

```js
  { label: 'Hội thoại', items: [
    { path: '/chats', text: 'Phiên chat', icon: 'chat' },
    { path: '/permissions', text: 'Phân quyền Bot', icon: 'shield' },
  ] },
```

`dashboard/public/style.css` — ngay sau `.load-more { margin-top: 12px; }` thêm:

```css

/* ---------- Phân quyền Bot ---------- */
.perm { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 20px; align-items: start; }
.perm > .card { margin: 0; display: flex; flex-direction: column; min-height: 0; }
.perm-list { max-height: calc(100vh - 190px); }
.perm-list .conv-name .icon { margin-right: 4px; }
.perm-set { border: 1px solid var(--border); border-radius: 10px; margin: 14px 0; padding: 6px 14px 10px; min-width: 0; }
.perm-set legend { padding: 0 6px; font-weight: 650; font-size: 14px; }
.perm-set:disabled { opacity: .6; }
.perm-row { display: flex; flex-direction: column; gap: 2px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.perm-row:last-child { border-bottom: 0; }
.perm-row small { padding-left: 26px; }
```

và trong `@media (max-width: 760px)`, ngay sau `.only-mobile { display: inline-flex; }` thêm:

```css
  .perm { grid-template-columns: minmax(0, 1fr); }
  .perm.has-sel .perm-list, .perm:not(.has-sel) .perm-edit { display: none; }
  .perm-list { max-height: none; }
```

- [ ] **Step 5: Chạy, thấy xanh**

Run: `node --test dashboard/public/public.test.js`
Expected: `# fail 0` (kể cả test "mọi import tương đối … trỏ tới tệp có thật").
Run: `HERMES_HOME=E:/Hermes npm test` → JS `# fail 0`, Python `Tất cả test Python đều xanh.`

- [ ] **Step 6: Kiểm tay nhanh trên trình duyệt** (`npm run dashboard` với `HERMES_HOME` trỏ bản thử): mục "Phân quyền Bot" có trong thanh bên cho cả hai vai trò; chọn một nhóm, tắt "Tra cứu web", Lưu → hiện "Đã lưu — bot áp dụng ngay…", nhóm có nhãn "Tắt 1 tính năng"; bấm "Dùng mặc định" rồi Lưu → nhãn biến mất; thu hẹp cửa sổ < 760 px → danh sách và chi tiết luân phiên, có nút "← Danh sách".

- [ ] **Step 7: Commit**

```bash
git add dashboard/public/views/permissions.js dashboard/public/views/shell.js dashboard/public/style.css dashboard/public/public.test.js
git commit -m "feat(dashboard): màn Phân quyền Bot theo nhóm

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Tài liệu, phát hành v1.21.0 và danh sách tệp triển khai

**Files:**
- Modify: `README.vi.md` (mục "Dashboard quản trị"), `README.md` (mục "Admin dashboard"), `CHANGELOG.md`, `package.json`, `package-lock.json` (2 chỗ), `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`

**Interfaces:**
- Consumes: mọi task trên.
- Produces: phiên bản `1.21.0` đồng bộ ở 5 chỗ; tài liệu người dùng + kiểm tay GĐ3; danh sách tệp triển khai.

- [ ] **Step 1: README.vi.md** — trong `## Dashboard quản trị`, ngay **trước** `### Kiểm tay sau khi cài (Giai đoạn 1)`, thêm:

```markdown
### Phân quyền Bot

Mục **Phân quyền Bot** chọn bot được làm gì trong từng nhóm. Bên trái là **Mặc định cho nhóm mới** (áp cho mọi nhóm chưa chỉnh riêng) và danh sách nhóm bot đang ở; bên phải là:

- **Hoạt động** — tắt thì bot không trả lời thành viên trong nhóm đó (vẫn đọc tin để hiểu ngữ cảnh khi chủ nhân hỏi).
- **Chỉ trả lời khi được tag** — tắt thì bot trả lời mọi tin trong nhóm.
- Chín tính năng: Tra cứu web, Gửi và tạo tệp, Tin nhắn thoại, Nhắc hẹn, Hẹn giờ cho nhóm, Kho tài liệu, Sổ người quen, Tra cứu học thuật, Video. Gửi nhãn dán, gửi liên kết và xem thành viên nhóm luôn bật.

Bấm **Lưu** là bot áp dụng ngay, không cần khởi động lại. Thành viên nhờ việc thuộc tính năng đang tắt thì bot trả lời rằng nhóm chưa bật tính năng đó. **Chủ nhân bot luôn dùng được mọi thứ**, kể cả trong nhóm đang tắt. Tắt "Hẹn giờ cho nhóm" chỉ chặn tạo việc mới — việc đã tạo vẫn chạy và vẫn xem, xoá được. Tin nhắn riêng không theo bảng này.

Bảng nằm ở `<HERMES_HOME>/zalo/permissions.json` (bản trước ở `permissions.json.bak`). Xoá tệp này thì bot trở lại như khi chưa có phân quyền. Tệp hỏng thì bot dùng mặc định (mọi tính năng bật) và dashboard báo để lưu lại.
```

và **sau** danh sách kiểm tay GĐ2 (trước dòng "Gỡ cài đặt (`npm run uninstall:hermes`) …"), thêm:

```markdown
### Kiểm tay sau khi cài (Giai đoạn 3)

- [ ] Mục "Phân quyền Bot" hiện danh sách nhóm đúng tên, có cả mục "Mặc định cho nhóm mới".
- [ ] Tắt "Tra cứu web" ở nhóm thử, Lưu; một thành viên tag bot nhờ tra web → bot nói nhóm chưa bật tính năng này. Chủ nhân nhờ y hệt → bot vẫn tra.
- [ ] Tắt "Hoạt động" ở nhóm thử: thành viên tag bot → bot im; chủ nhân tag → bot trả lời.
- [ ] Tắt "Chỉ trả lời khi được tag" ở nhóm thử: thành viên nhắn không tag → bot trả lời.
- [ ] Nhật ký có dòng "Đổi phân quyền nhóm" kèm tên mình và tên nhóm.
- [ ] Tài khoản Chủ bot chỉnh và lưu được phân quyền.
- [ ] Bấm "Dùng mặc định" rồi Lưu → nhóm về như cũ, nhãn bên trái biến mất.
```

- [ ] **Step 2: README.md** — trong `## Admin dashboard`, sau đoạn "Phase 2 adds …", thêm:

```markdown
Phase 3 adds **Bot permissions**: per-group switches stored in `<HERMES_HOME>/zalo/permissions.json` — *Active*, *Reply only when tagged*, and nine features (web search, files, voice, reminders, group schedules, knowledge base, people notes, academic search, video), plus a default for groups without their own entry. Saving takes effect on the bot's next turn without a restart: the Hermes plugin re-reads the file when it changes, refuses member tool calls for disabled features with a plain Vietnamese reason, and tells the model which features are off. The bot owner (`ZALO_ALLOWED_USERS`) is never restricted by this file, direct messages are not affected, and a missing or corrupt file means everything is on.
```

- [ ] **Step 3: CHANGELOG.md** — chèn ngay dưới dòng "Theo chuẩn [Keep a Changelog]…":

```markdown
## [1.21.0] — <ngày phát hành>

### Thêm

- **Dashboard: Phân quyền Bot theo nhóm.** Mỗi nhóm có công tắc Hoạt động, Chỉ trả lời khi được tag và 9 tính năng (tra cứu web, gửi và tạo tệp, tin nhắn thoại, nhắc hẹn, hẹn giờ cho nhóm, kho tài liệu, sổ người quen, tra cứu học thuật, video); có mục mặc định cho nhóm chưa chỉnh riêng. Quản trị và Chủ bot đều chỉnh được; mọi lần lưu ghi vào Nhật ký.
- **Bot áp dụng phân quyền ngay khi lưu**, không cần khởi động lại: thành viên nhờ việc thuộc tính năng đang tắt thì bot nói rõ nhóm chưa bật; nhóm tắt thì bot không trả lời thành viên; chủ nhân không bao giờ bị chặn. Tắt "Hẹn giờ cho nhóm" chỉ chặn tạo việc mới.

### An toàn

- Không có `permissions.json` → bot hoạt động y như bản trước. Tệp hỏng → bot dùng mặc định (mọi tính năng bật) và ghi cảnh báo, không bao giờ im lặng.
```

(`<ngày phát hành>` thay bằng ngày thật lúc phát hành, dạng `2026-10-0X`.)

- [ ] **Step 4: Bump phiên bản** `1.20.0` → `1.21.0` ở: `package.json` (`"version"`), `package-lock.json` (trường `"version"` ở gốc và ở `packages[""]`), `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`. Kiểm:

```bash
grep -n '"version": "1.21.0"' package.json package-lock.json
grep -n "^version: 1.21.0" hermes-plugin/zalo/plugin.yaml hermes-plugin/zalo_tools/plugin.yaml
```

Expected: 1 dòng ở `package.json`, 2 dòng ở `package-lock.json`, 1 dòng ở mỗi `plugin.yaml`.

- [ ] **Step 5: Chạy toàn bộ** — `HERMES_HOME=E:/Hermes npm test` → JS `# fail 0`; Python có `=== test_zalo_permissions.py ===` và `Tất cả test Python đều xanh.`

- [ ] **Step 6: Commit**

```bash
git add README.vi.md README.md CHANGELOG.md package.json package-lock.json hermes-plugin/zalo/plugin.yaml hermes-plugin/zalo_tools/plugin.yaml
git commit -m "docs(dashboard): Phân quyền Bot, kiểm tay giai đoạn 3 (v1.21.0)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Triển khai (người điều phối làm sau review cuối, như GĐ1–2)** — đúng các tệp sau đổi ở bản cài:

  **Plugin Hermes** — chép từ repo, giữ bản cũ dạng `*.bak-12100-<ngày>` như các lần trước, rồi **khởi động lại gateway** (Lăng Tiêu: `hermes gateway stop` rồi chạy lại như `restart-assistant`; Uyển Nhi: `systemctl restart` dịch vụ gateway Hermes):
  - `<hermes-agent>/plugins/zalo_tools/group_permissions.py` ← `hermes-plugin/zalo_tools/group_permissions.py` (**tệp mới**)
  - `<hermes-agent>/plugins/zalo_tools/tools.py` ← `hermes-plugin/zalo_tools/tools.py`
  - `<hermes-agent>/plugins/zalo_tools/plugin.yaml` ← `hermes-plugin/zalo_tools/plugin.yaml`
  - `<hermes-agent>/plugins/platforms/zalo/adapter.py` ← `hermes-plugin/zalo/adapter.py`
  - `<hermes-agent>/plugins/platforms/zalo/plugin.yaml` ← `hermes-plugin/zalo/plugin.yaml`

  (Hoặc chạy `npm run install:hermes`, bộ cài thay nguyên hai thư mục plugin.) Trên Lăng Tiêu `<hermes-agent>` = `E:/Hermes/hermes-agent`.

  **Dashboard** — cập nhật thư mục sidecar (Lăng Tiêu: `E:/Hermes/zca-test`; Uyển Nhi: checkout tag `v1.21.0`) rồi **khởi động lại dịch vụ dashboard** (Linux `systemctl restart zalo-dashboard`; Windows: dừng tiến trình đang nghe cổng 3880 rồi chạy lại `.vbs` trong Startup). Tệp đổi: `dashboard/app.js`, `dashboard/server.js`, `dashboard/lib/permissions.js` (mới), `dashboard/lib/audit-feed.js`, `dashboard/routes/permissions.js` (mới), `dashboard/public/views/permissions.js` (mới), `dashboard/public/views/shell.js`, `dashboard/public/style.css`, cùng `package.json`/`package-lock.json` (chỉ số phiên bản).

  **Sidecar** (`server.js`, `control-api.js`, `bot-handler.js`) **không đổi** — không cần khởi động lại `zalo-bridge`.

  Sau triển khai: chạy danh sách kiểm tay GĐ3 trên cả hai bot; kiểm `<HERMES_HOME>/zalo/permissions.json` có quyền 600 trên VPS (`stat -c %a`); gắn tag `v1.21.0`, GitHub Release, gộp vào `main`.

---

## Self-Review

**1. Phủ spec:**
- §8.1 tệp + lược đồ + "không có tệp → như hôm nay" → Task 1 (`test_missing_file…`), Task 4 (`chưa có tệp…`); "mục riêng chỉ cần ghi khoá khác mặc định" → Task 4 `setGroup`.
- §8.2 bảng nút → công cụ + "công cụ công khai mới phải được xếp vào một nút (test ghim)" → Task 1 `test_every_public_tool_belongs…`.
- §8.3 đọc theo `mtime` → Task 1; `active=false` bỏ qua thành viên, chủ nhân vẫn được → Task 3; `replyOnlyTagged` ghi đè cờ toàn cục → Task 3; hook `guard_member_tool_call` từ chối với câu dễ hiểu → Task 2; "không hứa suông" → Task 3; chủ nhân không bị chặn, tệp hỏng → cảnh báo + mặc định → Task 1–3; cron nhóm đã tạo vẫn chạy, chỉ chặn tạo mới, ghi rõ trên giao diện → Task 2 + gợi ý nút `groupCron` ở Task 4/6.
- §5.1 `dashboard/lib/permissions.js` "ghi nguyên tử + `.bak`", §5.1 "mọi tệp quyền 600" → Task 4; `group_permissions.py` → Task 1.
- §6 ma trận "Phân quyền Bot theo nhóm" ✅ cả hai vai trò; "mọi thay đổi … phân quyền ghi activity.jsonl" → Task 5.
- §7.1 bốn route → Task 5.
- §9 màn Phân quyền Bot (trái nhóm + tìm, phải Hoạt động, tag, 9 nút, mẫu mặc định, Lưu = hiệu lực ngay), thanh bên "HỘI THOẠI: Phiên chat · Phân quyền Bot", dùng được trên điện thoại → Task 6.
- §12 `uninstall` giữ `permissions.json` → đã đúng sẵn (`uninstallHermes` chỉ xoá hai thư mục plugin); không cần sửa.
- §13 permissions (Python): nhóm A tắt `web` → thành viên A bị từ chối, nhóm B vẫn dùng; chủ nhân không bị chặn; `active=false`; sửa tệp có hiệu lực không cần khởi động lại; tệp hỏng → mặc định; mọi công cụ công khai thuộc đúng một nút → Task 1–3.
- §14 GĐ3 → Task 1–7.

**2. Placeholder:** chỉ còn `<ngày phát hành>` (CHANGELOG) và `<hermes-agent>`/`<HERMES_HOME>` trong bước triển khai — giá trị biết lúc phát hành, có chỉ dẫn.

**3. Nhất quán kiểu:** Python `group_settings()` trả `reply_only_tagged` (snake) — adapter Task 3 đọc đúng khoá đó; tệp JSON dùng `replyOnlyTagged` (camel) ở cả Python `_layer` lẫn JS `layer`. `FEATURES` 9 khoá cùng thứ tự ở Python và JS (test chéo ở Task 4). `parseSettings` → `Settings` dùng trong `setDefaults/setGroup` (Task 4) và route (Task 5); `GET`/`PUT` trả cùng dạng `{ features, exists, corrupt, defaults, groups }` mà `Permissions()` (Task 6) đọc qua `perms.features`, `perms.defaults`, `perms.groups`, `perms.corrupt`. `fallbackName(id, 1)` → `Nhóm …1234` khớp chuỗi dự phòng của `mergeGroups`.

**4. Review Focus:** năm mục ở đầu đều có test trong task sở hữu mã (đã ghi tên test ở từng dòng). Đã chạy thử toàn bộ mã của kế hoạch trên một bản sao: `npm test` với `HERMES_HOME=E:/Hermes` → JS 460 test (458 pass, 2 bỏ qua trên Windows, 0 fail), Python 257 test xanh (16 test mới).
