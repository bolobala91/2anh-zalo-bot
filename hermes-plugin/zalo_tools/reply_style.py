"""Phong cách trả lời do chủ bot cài (dashboard › Cấu hình, hoặc dặn bot qua ``zalo_reply_style``).

Đây là **cài đặt**, không phải trí nhớ: xưng hô, giọng, độ dài, emoji, bộ màu, mẫu tên tệp. Để trong
``<HERMES_HOME>/zalo/reply-style.json`` thì sửa là áp dụng ngay, không chiếm chỗ bộ nhớ và bàn giao được cho khách.

Mỗi lượt Zalo, hook ``pre_llm_call`` đính một dòng tóm tắt (kèm giờ hiện tại — lời nhắc hệ thống chỉ ghi ngày lúc
phiên bắt đầu, phiên kéo dài vài ngày là lệch). Hermes lưu dòng này cùng tin của lượt, nên phải giữ thật ngắn.
Dashboard (``dashboard/lib/reply-style.js``) kiểm hợp lệ theo đúng các giới hạn dưới đây.
"""

import json
import logging
import os
import re
import time
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

FILE = "reply-style.json"
COLORS = ("red", "green", "orange", "yellow")
CHOICES = {
    "tone": ("friendly", "playful", "formal"),
    "length": ("short", "medium", "detailed"),
    "emoji": ("none", "few", "many"),
    "color_level": ("none", "few", "normal"),
    "file_name": ("name_time", "name_date", "name"),
}
TEXT_LIMITS = {"self_name": 20, "owner_name": 30, "others_name": 30, "extra": 500}
DEFAULTS: Dict[str, Any] = {
    "self_name": "em",
    "owner_name": "anh/chị",
    "others_name": "anh/chị",
    "tone": "friendly",
    "length": "medium",
    "emoji": "few",
    "colors": list(COLORS),
    "color_level": "normal",
    "file_name": "name_time",
    "extra": "",
}

_TONE = {"friendly": "thân thiện, tự nhiên", "playful": "vui vẻ, dí dỏm (việc nghiêm túc vẫn nghiêm túc)",
         "formal": "trang trọng, lịch sự"}
_LENGTH = {"short": "ngắn gọn, đi thẳng ý chính", "medium": "vừa phải", "detailed": "chi tiết, đủ ý"}
_EMOJI = {"none": "không dùng", "few": "ít, vừa đủ", "many": "thoải mái"}
_LEVEL = {"few": "tô 1–2 chỗ mỗi tin", "normal": "tô 2–5 chỗ mỗi tin"}
_WEEKDAYS = ("Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật")
_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}


class StyleError(ValueError):
    pass


def _home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def path(home: Optional[Path] = None) -> Path:
    return (home or _home()) / "zalo" / FILE


def _clean_text(value: Any, limit: int) -> str:
    text = unicodedata.normalize("NFC", str(value or ""))
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", text).strip()
    return text[:limit].strip()


def normalize(raw: Any, *, strict: bool = False) -> Dict[str, Any]:
    """Cài đặt hợp lệ từ ``raw``. ``strict``: giá trị sai → ``StyleError`` (dùng khi ghi); không thì về mặc định."""
    raw = raw if isinstance(raw, dict) else {}
    out = dict(DEFAULTS)
    for key, limit in TEXT_LIMITS.items():
        if key in raw:
            text = _clean_text(raw[key], limit)
            if strict and len(unicodedata.normalize("NFC", str(raw[key] or "")).strip()) > limit:
                raise StyleError(f"{key} dài quá {limit} ký tự")
            out[key] = text if (text or key == "extra") else DEFAULTS[key]
    for key, allowed in CHOICES.items():
        if key in raw:
            if raw[key] in allowed:
                out[key] = raw[key]
            elif strict:
                raise StyleError(f"{key} chỉ nhận: {', '.join(allowed)}")
    if "colors" in raw:
        picked = raw["colors"] if isinstance(raw["colors"], list) else None
        if strict and (picked is None or any(c not in COLORS for c in picked)):
            raise StyleError(f"colors chỉ gồm: {', '.join(COLORS)}")
        out["colors"] = [c for c in COLORS if c in (picked or [])]
    return out


def load(home: Optional[Path] = None) -> Dict[str, Any]:
    """Cài đặt hiện tại (đọc lại khi tệp đổi). Thiếu hoặc hỏng tệp → mặc định."""
    file = path(home)
    try:
        mtime = file.stat().st_mtime_ns
    except OSError:
        return dict(DEFAULTS)
    hit = _cache.get(str(file))
    if hit and hit[0] == mtime:
        return dict(hit[1])
    try:
        data = normalize(json.loads(file.read_text(encoding="utf-8-sig")))
    except (OSError, ValueError):
        logger.warning("[zalo] %s hỏng — dùng phong cách mặc định", file)
        data = dict(DEFAULTS)
    _cache[str(file)] = (mtime, data)
    return dict(data)


def save(changes: Dict[str, Any], home: Optional[Path] = None) -> Dict[str, Any]:
    """Gộp ``changes`` vào cài đặt hiện có, kiểm chặt rồi ghi nguyên tử. Trả cài đặt mới."""
    unknown = sorted(set(changes) - set(DEFAULTS))
    if unknown:
        raise StyleError(f"không có cài đặt: {', '.join(unknown)}")
    merged = normalize({**load(home), **changes}, strict=True)
    file = path(home)
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, file)
    return merged


def _now_line(now: Optional[datetime] = None) -> str:
    now = now or datetime.now().astimezone()
    offset = now.utcoffset()
    hours = int(offset.total_seconds() // 3600) if offset is not None else 0
    tz = f"UTC{'+' if hours >= 0 else '-'}{abs(hours)}"
    return f"Bây giờ: {_WEEKDAYS[now.weekday()]}, {now:%d/%m/%Y %H:%M} ({tz})."


def note(settings: Dict[str, Any], now: Optional[datetime] = None) -> str:
    """Dòng tóm tắt đính vào tin của lượt — ngắn, vì Hermes lưu nó vào lịch sử."""
    s = normalize(settings)
    parts = [
        _now_line(now),
        f"Xưng \"{s['self_name']}\", gọi chủ nhân \"{s['owner_name']}\", người khác \"{s['others_name']}\".",
        f"Giọng {_TONE[s['tone']]}. Độ dài: {_LENGTH[s['length']]}. Emoji: {_EMOJI[s['emoji']]}.",
    ]
    if s["color_level"] == "none" or not s["colors"]:
        parts.append("Không tô màu chữ.")
    else:
        tags = " ".join(f"[{c}]" for c in s["colors"])
        parts.append(f"Màu chữ chỉ dùng {tags}, {_LEVEL[s['color_level']]}.")
    if s["extra"]:
        parts.append(f"Chủ bot dặn thêm: {s['extra']}")
    return "[Cài đặt trả lời của chủ bot — làm theo, không nhắc lại:] " + " ".join(parts)


def file_name(stem: str, ext: str, settings: Optional[Dict[str, Any]] = None, now: Optional[float] = None) -> str:
    """Tên tệp theo mẫu đã cài: ``Tên_YYYYMMDD-HHMMSS.ext`` / ``Tên_YYYYMMDD.ext`` / ``Tên.ext``."""
    mode = normalize(settings if settings is not None else load()).get("file_name")
    ext = str(ext or "").lstrip(".")
    stamp = time.localtime(now if now is not None else time.time())
    if mode == "name_time":
        stem = f"{stem}_{time.strftime('%Y%m%d-%H%M%S', stamp)}"
    elif mode == "name_date":
        stem = f"{stem}_{time.strftime('%Y%m%d', stamp)}"
    return f"{stem}.{ext}" if ext else stem


def pre_llm_call(platform: str = "", **_kw) -> Optional[Dict[str, str]]:
    """Hook Hermes: đính cài đặt trả lời + giờ hiện tại vào tin của lượt Zalo."""
    if str(platform or "").lower() != "zalo":
        return None
    try:
        return {"context": note(load())}
    except Exception:
        logger.debug("[zalo] không dựng được dòng cài đặt trả lời", exc_info=True)
        return None
