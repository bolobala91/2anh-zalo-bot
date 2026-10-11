"""Từ khoá CHỦ NHÂN dùng để gọi bot trong nhóm mà không cần tag (vd. "Tiêu ơi", "chào Nhi").

Người khác vẫn phải tag (@TênBot, @bot, "bot …") — phần đó không đổi ở đây.

Danh sách sửa được trên dashboard (Phân quyền Bot › Cách gọi bot), lưu ở ``<HERMES_HOME>/zalo/call-words.json``
(hoặc ``ZALO_CALL_WORDS_FILE``)::

    {"version": 1, "owner": [{"text": "tiêu ơi", "at": "any"}, {"text": "tiêu", "at": "start"}]}

``at``: ``start`` = tin bắt đầu bằng từ khoá (hoặc chỉ gồm từ khoá); ``any`` = từ khoá nằm ở bất kỳ đâu trong tin.
Chưa có tệp → dùng mặc định dựng từ tên bot (giống hệt cách gọi trước đây). Tệp có danh sách rỗng → chủ nhân cũng phải tag.
Đọc lại khi tệp đổi (theo mtime) — sửa trên dashboard có hiệu lực ngay, không cần khởi động lại.
"""

import json
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

MAX_WORDS = 50
MAX_LEN = 40
_cache: Dict[str, object] = {"path": None, "mtime": None, "words": None}


def default_words(display_name: str) -> List[Dict[str, str]]:
    """Mặc định từ tên bot: tên đầy đủ và tên ngắn (chữ cuối) — đầu tin, "… ơi", "chào …", "… đâu", "nhờ …" (cả không dấu)."""
    name = (display_name or "").strip().lower()
    if not name:
        return []
    names = [name]
    if " " in name:
        short = name.split()[-1]
        if len(short) >= 2:
            names.append(short)
    out: List[Dict[str, str]] = []
    for n in names:
        out.append({"text": n, "at": "start"})
        for pattern in ("{} ơi", "{} oi", "chào {}", "chao {}", "{} đâu", "{} dau", "nhờ {}", "nho {}"):
            out.append({"text": pattern.format(n), "at": "any"})
    seen = set()
    unique = []
    for w in out:
        key = (w["text"], w["at"])
        if key not in seen:
            seen.add(key)
            unique.append(w)
    return unique


def _clean(raw) -> Optional[List[Dict[str, str]]]:
    if not isinstance(raw, dict) or not isinstance(raw.get("owner"), list):
        return None
    words = []
    for item in raw["owner"][:MAX_WORDS]:
        if not isinstance(item, dict):
            continue
        text = " ".join(str(item.get("text") or "").lower().split())
        at = item.get("at") if item.get("at") in ("start", "any") else "any"
        if 1 <= len(text) <= MAX_LEN:
            words.append({"text": text, "at": at})
    return words


def words_file() -> Path:
    env = os.environ.get("ZALO_CALL_WORDS_FILE", "").strip()
    if env:
        return Path(env)
    from hermes_constants import get_hermes_home
    return get_hermes_home() / "zalo" / "call-words.json"


def owner_words(display_name: str, path: Optional[Path] = None) -> List[Dict[str, str]]:
    """Danh sách đang áp dụng: tệp của dashboard nếu có (đọc lại khi đổi), không thì mặc định theo tên bot."""
    try:
        p = path or words_file()
        mtime = p.stat().st_mtime
    except (OSError, ImportError):
        return default_words(display_name)
    if _cache["path"] != str(p) or _cache["mtime"] != mtime:
        try:
            words = _clean(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            words = None
        if words is None:
            logger.warning("[zalo] call-words.json hỏng — dùng cách gọi mặc định")
        _cache.update(path=str(p), mtime=mtime, words=words)
    words = _cache["words"]
    return default_words(display_name) if words is None else list(words)


def matches(low_text: str, words: List[Dict[str, str]]) -> bool:
    """Tin (đã chữ thường) có gọi bot theo một từ khoá không."""
    low = " ".join((low_text or "").split())
    for w in words:
        t = w["text"]
        if w["at"] == "start":
            if low == t or low.startswith(t + " "):
                return True
        elif t in low:
            return True
    return False
