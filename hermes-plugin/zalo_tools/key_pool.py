"""Kho khoá dự phòng: nhiều khoá cho một dịch vụ, tự đổi sang khoá kế khi khoá đang dùng lỗi hoặc hết lượt.

Dashboard (trang Khoá API & Model) quản lý ``<HERMES_HOME>/zalo/key-pool.json`` (quyền 600)::

    {"version": 1, "keys": {"TAVILY_API_KEY": {"active": "k1", "list": [
        {"id": "k1", "value": "...", "label": "", "cool_until": 0, "last_error": ""}, ...]}}}

Hermes và các công cụ đọc khoá từ ``os.environ`` ở MỖI lần gọi (``get_env_value`` / ``get_secret``), còn gateway không
tự nạp lại ``.env``. Plugin chạy trong chính tiến trình gateway nên:

- ``sync()`` (đầu mỗi lời gọi công cụ, chỉ đọc lại tệp khi đổi): đặt ``os.environ[KEY]`` = khoá đang dùng trong kho —
  dashboard đổi/thêm khoá là có hiệu lực ngay, không cần khởi động lại.
- ``on_tool_result`` (móc ``transform_tool_result``): kết quả công cụ báo lỗi khoá (401/402/403/429, "quota",
  "insufficient credits"…) của một dịch vụ có ≥ 2 khoá → cho khoá đó nghỉ (1 giờ; khoá sai 24 giờ), chuyển sang khoá
  kế còn dùng được, ghi ``os.environ`` + ``.env`` (lần khởi động sau vẫn đúng) + ``key-events.jsonl`` (dashboard hiện),
  và dặn model gọi lại công cụ một lần nữa.

Không bao giờ ghi giá trị khoá vào log hay kết quả trả cho model.
"""

import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

COOL_QUOTA_SECONDS = 3600          # hết lượt / bị giới hạn: thử lại sau 1 giờ
COOL_INVALID_SECONDS = 24 * 3600   # khoá sai / bị thu hồi: thử lại sau 1 ngày
MIN_ROTATE_GAP_SECONDS = 30        # nhiều lời gọi song song cùng lỗi chỉ đổi một lần

# Dấu hiệu lỗi do KHOÁ (không phải lỗi nội dung): mã HTTP và câu thường gặp của các dịch vụ.
KEY_ERROR = re.compile(
    r"\b(401|402|403|429)\b|unauthori[sz]ed|forbidden|invalid[ _-]?api[ _-]?key|api[ _-]?key (?:is )?(?:invalid|expired|not valid|revoked)"
    r"|quota|rate[ _-]?limit|usage limit|insufficient (?:credits?|balance|quota|funds)|out of credits|credit balance"
    r"|payment required|exceeded your|too many requests",
    re.I,
)
INVALID = re.compile(r"\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[ _-]?api[ _-]?key|not valid|revoked|expired", re.I)

# Dịch vụ ↔ chữ nhận ra trong thông báo lỗi; công cụ ↔ khoá nó dùng (khi lỗi không nêu tên dịch vụ).
SERVICE_HINTS: Dict[str, re.Pattern] = {
    "TAVILY_API_KEY": re.compile(r"tavily", re.I),
    "EXA_API_KEY": re.compile(r"\bexa\b|exa\.ai", re.I),
    "FIRECRAWL_API_KEY": re.compile(r"firecrawl", re.I),
    "PARALLEL_API_KEY": re.compile(r"parallel\.ai|\bparallel\b", re.I),
    "APIFY_TOKEN": re.compile(r"apify", re.I),
    "CORE_API_KEY": re.compile(r"core\.ac\.uk|\bCORE\b", re.I),
    "OPENALEX_API_KEY": re.compile(r"openalex", re.I),
    "VBEE_API_KEY": re.compile(r"vbee", re.I),
    "VBEE_ACCESS_TOKEN": re.compile(r"vbee", re.I),
    "ELEVENLABS_API_KEY": re.compile(r"elevenlabs", re.I),
    "GEMINI_API_KEY": re.compile(r"generativelanguage|gemini api", re.I),
    # Chỉ khi chính nguồn Stali báo lỗi HTTP về khoá (không đổi khoá Stali vì lỗi của 9router/ChatGPT cùng lượt).
    "STALI_API_KEY": re.compile(r"Stali[^;]{0,40}lỗi (401|402|403|429)", re.I),
}
TOOL_KEYS: Dict[str, List[str]] = {
    "web_search": ["TAVILY_API_KEY", "EXA_API_KEY", "FIRECRAWL_API_KEY", "PARALLEL_API_KEY"],
    "web_extract": ["TAVILY_API_KEY", "EXA_API_KEY", "FIRECRAWL_API_KEY", "PARALLEL_API_KEY"],
    "zalo_academic_search": ["CORE_API_KEY", "OPENALEX_API_KEY"],
    "zalo_studio": ["ANH_AI_KEY"],
    # image_generate có nhiều nguồn (Stali/9router/ChatGPT) → chỉ đổi khoá Stali khi lỗi nêu đúng Stali (SERVICE_HINTS).
    "video_generate": ["STALI_API_KEY"],
}
ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")

_lock = threading.Lock()
_state: Dict[str, Any] = {"mtime": None, "data": None, "last_rotate": {}}


def _hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        return Path(os.getenv("HERMES_HOME") or Path.home() / ".hermes").expanduser()


def pool_path() -> Path:
    explicit = (os.getenv("ZALO_KEY_POOL_FILE") or "").strip()
    return Path(explicit).expanduser() if explicit else _hermes_home() / "zalo" / "key-pool.json"


def events_path() -> Path:
    return pool_path().with_name("key-events.jsonl")


def env_path() -> Path:
    explicit = (os.getenv("ZALO_HERMES_ENV_FILE") or "").strip()
    return Path(explicit).expanduser() if explicit else _hermes_home() / ".env"


def _load() -> Dict[str, Any]:
    """Kho khoá (đọc lại chỉ khi tệp đổi). Hỏng/không có → kho rỗng (không làm gì)."""
    path = pool_path()
    try:
        mtime = path.stat().st_mtime_ns
    except OSError:
        _state.update(mtime=None, data={"version": 1, "keys": {}})
        return _state["data"]
    if _state["mtime"] != mtime or _state["data"] is None:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("keys"), dict):
                raise ValueError("sai cấu trúc")
        except (OSError, ValueError) as exc:
            logger.warning("[zalo] không đọc được kho khoá dự phòng: %s", exc)
            data = {"version": 1, "keys": {}}
        _state.update(mtime=mtime, data=data)
    return _state["data"]


def _write_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    with open(tmp, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


def _save(data: Dict[str, Any]) -> None:
    path = pool_path()
    _write_atomic(path, json.dumps(data, ensure_ascii=False, indent=2))
    try:
        _state.update(mtime=path.stat().st_mtime_ns, data=data)
    except OSError:
        _state.update(mtime=None, data=data)


def _entry(pool: Dict[str, Any], entry_id: Any) -> Optional[Dict[str, Any]]:
    return next((e for e in pool.get("list") or [] if isinstance(e, dict) and e.get("id") == entry_id), None)


def _active_value(pool: Dict[str, Any]) -> str:
    e = _entry(pool, pool.get("active"))
    return str(e.get("value") or "") if e else ""


def sync() -> int:
    """Đặt ``os.environ`` theo khoá đang dùng trong kho. Trả số khoá vừa đổi."""
    with _lock:
        data = _load()
        changed = 0
        for name, pool in (data.get("keys") or {}).items():
            if not ENV_NAME.match(str(name)) or not isinstance(pool, dict):
                continue
            value = _active_value(pool)
            if value and os.environ.get(name) != value:
                os.environ[name] = value
                changed += 1
        return changed


def _set_env_file(name: str, value: str) -> None:
    """Thay dòng ``NAME=…`` trong .env của Hermes (giữ "export ", kiểu xuống dòng); không có thì thêm cuối tệp."""
    path = env_path()
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        raw = ""
    eol = "\r\n" if "\r\n" in raw else "\n"
    pattern = re.compile(rf"^(\s*(?:export\s+)?){re.escape(name)}\s*=.*$")
    lines = raw.split(eol) if raw else []
    rendered = value if re.fullmatch(r"[A-Za-z0-9_.,*?:/-]*", value) else f'"{value}"'
    found = False
    for i, line in enumerate(lines):
        m = pattern.match(line)
        if m:
            lines[i] = f"{m.group(1)}{name}={rendered}"
            found = True
    if not found:
        if lines and lines[-1] == "":
            lines.pop()
        lines += [f"{name}={rendered}", ""]
    _write_atomic(path, eol.join(lines))


def _event(name: str, from_id: str, to_id: str, reason: str) -> None:
    try:
        with open(events_path(), "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"at": int(time.time() * 1000), "key": name, "from": from_id, "to": to_id, "reason": reason[:160]}, ensure_ascii=False) + "\n")
    except OSError:
        logger.warning("[zalo] không ghi được key-events.jsonl", exc_info=True)


def rotate(name: str, reason: str, now: Optional[float] = None) -> Optional[Dict[str, str]]:
    """Cho khoá đang dùng của ``name`` nghỉ, chuyển sang khoá kế còn dùng được. Trả {from, to, label} hoặc None."""
    now = time.time() if now is None else now
    with _lock:
        data = _load()
        pool = (data.get("keys") or {}).get(name)
        if not isinstance(pool, dict) or len(pool.get("list") or []) < 2:
            return None
        if now - _state["last_rotate"].get(name, 0) < MIN_ROTATE_GAP_SECONDS:
            return None
        entries = [e for e in pool["list"] if isinstance(e, dict) and e.get("value")]
        current = _entry(pool, pool.get("active"))
        if current is not None:
            current["cool_until"] = int(now + (COOL_INVALID_SECONDS if INVALID.search(reason) else COOL_QUOTA_SECONDS))
            current["last_error"] = reason[:160]
        start = entries.index(current) + 1 if current in entries else 0
        candidates = entries[start:] + entries[:start]
        nxt = next((e for e in candidates if e is not current and float(e.get("cool_until") or 0) <= now), None)
        if nxt is None:
            _save(data)
            _event(name, str(pool.get("active") or ""), "", f"hết khoá dự phòng — {reason}")
            return None
        pool["active"] = nxt["id"]
        _save(data)
        os.environ[name] = str(nxt["value"])
        try:
            _set_env_file(name, str(nxt["value"]))
        except OSError:
            logger.warning("[zalo] đổi khoá %s trong bộ nhớ nhưng chưa ghi được .env", name, exc_info=True)
        _state["last_rotate"][name] = now
        _event(name, str(current.get("id") if current else ""), str(nxt["id"]), reason)
        logger.warning("[zalo] khoá %s lỗi (%s) — đã chuyển sang khoá dự phòng %s", name, reason[:80], nxt["id"])
        return {"from": str(current.get("id") if current else ""), "to": str(nxt["id"]), "label": str(nxt.get("label") or "")}


def _result_text(result: Any) -> str:
    return str(result if result is not None else "")[:4000]


def keys_for(tool_name: str, text: str) -> List[str]:
    """Khoá có thể là thủ phạm: dịch vụ được nêu trong lỗi; không nêu thì theo công cụ (chỉ khoá đang có kho ≥ 2)."""
    data = _load()
    pooled = {n for n, p in (data.get("keys") or {}).items() if isinstance(p, dict) and len(p.get("list") or []) >= 2}
    named = [n for n, rx in SERVICE_HINTS.items() if n in pooled and rx.search(text)]
    if named:
        return named
    by_tool = [n for n in TOOL_KEYS.get(str(tool_name), []) if n in pooled and os.environ.get(n)]
    return by_tool[:1] if len(by_tool) == 1 else []


def on_tool_result(tool_name: str = "", result: Any = None, status: str = "", error_message: str = "", **_kw) -> Optional[str]:
    """Móc ``transform_tool_result``: lỗi khoá → đổi khoá dự phòng và dặn model gọi lại. Không lỗi khoá → None (giữ nguyên)."""
    try:
        text = f"{error_message or ''}\n{_result_text(result)}"
        if not KEY_ERROR.search(text):
            return None
        reason_m = KEY_ERROR.search(text)
        reason = reason_m.group(0) if reason_m else "lỗi khoá"
        rotated = [(n, r) for n in keys_for(tool_name, text) for r in [rotate(n, reason)] if r]
        if not rotated:
            return None
        names = ", ".join(n for n, _ in rotated)
        note = (f"[Hệ thống] Khoá dịch vụ ({names}) vừa báo lỗi \"{reason}\" nên đã tự chuyển sang khoá dự phòng. "
                "Hãy gọi lại đúng công cụ này một lần nữa với cùng tham số.")
        try:
            obj = json.loads(result) if isinstance(result, str) else None
        except ValueError:
            obj = None
        if isinstance(obj, dict):
            obj["he_thong"] = note
            return json.dumps(obj, ensure_ascii=False)
        return f"{_result_text(result)}\n\n{note}"
    except Exception:  # không bao giờ làm hỏng lượt trả lời
        logger.warning("[zalo] lỗi khi xử lý kho khoá dự phòng", exc_info=True)
        return None


def before_tool_call(**_kw) -> None:
    """Móc ``pre_tool_call`` (chạy cùng rào chắn quyền): đồng bộ khoá trước mỗi lần gọi công cụ."""
    try:
        sync()
    except Exception:
        logger.warning("[zalo] không đồng bộ được kho khoá dự phòng", exc_info=True)
    return None
