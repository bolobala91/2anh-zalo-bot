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
        data = _parse(path.read_text(encoding="utf-8-sig"))
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
