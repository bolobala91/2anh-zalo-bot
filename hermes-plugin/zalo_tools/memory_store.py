"""Chủ nhân dặn bot nhớ / quên trong trí nhớ dài hạn của ĐÚNG cuộc trò chuyện đang diễn ra (spec §19.5.2).

Phạm vi lấy từ turn (ContextVar của tools.py), không bao giờ từ tham số mô hình: nhóm → ``zalo-g-<id>``,
nhắn riêng → ``zalo-u-<uid>`` — trùng cách provider ``zalo_memory`` đặt tên. Chỉ chạy khi trí nhớ dài hạn đang
bật (``memory.provider: zalo_memory`` và provider đang chạy), không trên Windows, không khi lớp gốc sẽ gửi khoá
API, và chỉ tới OpenViking trên cùng máy (endpoint theo bộ phân giải của lớp gốc). Ghi = một tệp ``memories/preferences/mem_owner_<hex>.md`` (không gọi LLM); quên = tìm
trong đúng kho rồi xoá từng tệp mà URI nằm dưới gốc của kho đó.
"""

import re
import sys
import uuid
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

OV_ACCOUNT = "zalo"
PROVIDER = "zalo_memory"
MAX_REMEMBER_CHARS = 1000
MAX_FORGET = 5
_ID = re.compile(r"^\d{1,32}$")
_LOOPBACK = {"127.0.0.1", "localhost", "::1"}
_GENERATED = {".abstract.md", ".overview.md"}


class MemoryUnavailable(RuntimeError):
    """Trí nhớ dài hạn đang tắt hoặc không dùng được — câu thông báo dành cho chủ nhân."""


def _host_platform() -> str:
    return sys.platform


def scope_of_turn(turn: Dict[str, Any]) -> Optional[str]:
    thread = str(turn.get("thread_id") or "").strip()
    if not _ID.match(thread):
        return None
    return f"zalo-g-{thread}" if turn.get("is_group") else f"zalo-u-{thread}"


def root_of(scope: str) -> str:
    return f"viking://user/{scope}/memories"


def _provider() -> str:
    try:
        from hermes_cli.config import load_config_readonly
        return str(((load_config_readonly() or {}).get("memory") or {}).get("provider") or "").strip()
    except Exception:
        return ""


_USER_MEMORY_NS = "_hermes_user_memory."


def _is_provider_module_name(name: str) -> bool:
    """Tên module gói zalo_memory trong mọi cách Hermes nạp: trong mã Hermes (``plugins.memory.zalo_memory``),
    plugin người dùng bản cũ (``_hermes_user_memory.zalo_memory``) và bản mới
    (``_hermes_user_memory.zalo_memory__source_<sha16>``). Không nhận module con (``….openviking_base``)."""
    if name == "plugins.memory.zalo_memory":
        return True
    if not name.startswith(_USER_MEMORY_NS):
        return False
    rest = name[len(_USER_MEMORY_NS):]
    return "." not in rest and (rest == PROVIDER or rest.startswith(PROVIDER + "__source_"))


def _provider_module():
    """Module provider zalo_memory đang nạp trong tiến trình (Hermes nạp plugin người dùng dưới
    ``_hermes_user_memory``); chưa nạp = provider không chạy → None."""
    for name, mod in list(sys.modules.items()):
        if mod is not None and _is_provider_module_name(name) and getattr(mod, "PROVIDER_NAME", None) == PROVIDER:
            return mod
    return None


def endpoint() -> str:
    """OpenViking dùng được cho công cụ, hoặc ném MemoryUnavailable kèm lý do dễ hiểu.

    Cùng luật với provider: không Windows, provider zalo_memory đang chạy, lớp gốc không gửi khoá API (từ bất kỳ
    nguồn nào), endpoint lấy từ CHÍNH bộ phân giải kết nối của lớp gốc và phải là loopback.
    """
    if _host_platform() == "win32":
        raise MemoryUnavailable("trí nhớ dài hạn chỉ chạy trên máy chủ Linux")
    if _provider() != PROVIDER:
        raise MemoryUnavailable("trí nhớ dài hạn đang tắt (memory.provider chưa là zalo_memory)")
    zm = _provider_module()
    if zm is None:
        raise MemoryUnavailable("trí nhớ dài hạn đang tắt (provider zalo_memory chưa chạy)")
    if zm.api_key_would_be_sent():
        raise MemoryUnavailable("OpenViking đang dùng khoá API — trí nhớ theo nhóm/người không bật được")
    try:
        base = sys.modules[zm.OpenVikingMemoryProvider.__module__]
        url = str(base._resolve_connection_settings(base._load_hermes_openviking_config()).get("endpoint") or "").strip()
    except Exception as exc:
        raise MemoryUnavailable("không đọc được cấu hình OpenViking") from exc
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in _LOOPBACK or parsed.username:
        raise MemoryUnavailable("OPENVIKING_ENDPOINT phải là địa chỉ trên cùng máy")
    return f"{parsed.scheme}://{parsed.netloc}"


def _call(scope: str, method: str, path: str, *, params=None, body=None) -> Any:
    import httpx

    headers = {"X-OpenViking-Account": OV_ACCOUNT, "X-OpenViking-User": scope}
    try:
        resp = httpx.request(method, endpoint() + path, params=params, json=body, headers=headers, timeout=10.0)
        data = resp.json()
    except MemoryUnavailable:
        raise
    except Exception as exc:
        raise MemoryUnavailable("OpenViking không trả lời — thử lại sau") from exc
    if resp.status_code >= 400 or data.get("status") != "ok":
        raise MemoryUnavailable("OpenViking từ chối yêu cầu")
    return data.get("result")


def remember(scope: str, text: str) -> str:
    """Ghi một mục trí nhớ do chủ nhân dặn vào kho của phạm vi; trả URI."""
    body = " ".join(str(text or "").split())
    if not body:
        raise ValueError("cần nội dung cần nhớ")
    if len(body) > MAX_REMEMBER_CHARS:
        raise ValueError(f"tối đa {MAX_REMEMBER_CHARS} ký tự mỗi lần nhớ — tách thành vài ý")
    uri = f"{root_of(scope)}/preferences/mem_owner_{uuid.uuid4().hex[:12]}.md"
    _call(scope, "POST", "/api/v1/content/write", body={"uri": uri, "content": f"{body}\n", "mode": "create"})
    return uri


def _deletable(uri: Any, scope: str) -> bool:
    s = str(uri or "")
    root = root_of(scope) + "/"
    return (s.startswith(root) and s.endswith(".md") and ".." not in s and not re.search(r"[%\\?#\x00-\x1f\x7f]|[^\S ]", s)
            and s.rsplit("/", 1)[-1] not in _GENERATED)


def find(scope: str, query: str) -> List[Dict[str, str]]:
    """Ứng viên để quên: tối đa 5 mục trong đúng kho này, kèm tóm tắt."""
    q = str(query or "").strip()[:200]
    if len(q) < 2:
        raise ValueError("cần mô tả chuyện cần quên (ít nhất 2 ký tự)")
    result = _call(scope, "POST", "/api/v1/search/find",
                   body={"query": q, "limit": 10, "context_type": "memory", "target_uri": root_of(scope)}) or {}
    hits = [h for h in (result.get("memories") or []) if isinstance(h, dict) and _deletable(h.get("uri"), scope)]
    return [{"uri": h["uri"], "abstract": str(h.get("abstract") or "")[:300]} for h in hits[:MAX_FORGET]]


def forget(scope: str, uris: List[Any]) -> List[str]:
    """Xoá các mục đã chọn. Kiểm TOÀN BỘ URI trước: một URI ngoài kho của phạm vi này → từ chối cả lô; quá 5 mục →
    từ chối (không lặng lẽ xoá 5 mục đầu). Mọi từ chối xảy ra trước khi gọi mạng."""
    chosen = list(dict.fromkeys(str(u) for u in (uris or [])))
    if not chosen:
        raise ValueError("chưa chọn mục nào để quên")
    bad = [u for u in chosen if not _deletable(u, scope)]
    if bad:
        raise ValueError("chỉ quên được mục của chính cuộc trò chuyện này — gọi lại với `query` để lấy danh sách")
    if len(chosen) > MAX_FORGET:
        raise ValueError(f"mỗi lần quên tối đa {MAX_FORGET} mục — chọn lại tối đa {MAX_FORGET} URI rồi gọi lại")
    for uri in chosen:
        _call(scope, "DELETE", "/api/v1/fs", params={"uri": uri, "recursive": "false"})
    return chosen
