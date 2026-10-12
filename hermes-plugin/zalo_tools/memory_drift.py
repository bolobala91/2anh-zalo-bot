"""Bộ nhớ trợ lý (MEMORY.md / USER.md) đổi giữa chừng một cuộc trò chuyện → báo phần chênh cho model ở lượt này.

Hermes chụp bộ nhớ vào lời nhắc hệ thống khi phiên bắt đầu, và với phiên đang tiếp diễn thì DÙNG LẠI NGUYÊN VĂN
lời nhắc đã lưu trong ``state.db`` (giữ bộ đệm prompt của nhà cung cấp — xem ``_restore_or_build_system_prompt``).
Nên mục chủ bot sửa trên dashboard (hoặc bot ghi ở cuộc trò chuyện khác) không tới được các phiên đang chạy, có
khi hàng tuần. Không đụng lời nhắc (đổi nó là vỡ bộ đệm và mất các khối plugin chỉ có ở phiên mới): hook
``pre_llm_call`` đính vào tin của lượt này đúng phần chênh — mục mới thêm, mục đã xoá — giữa bộ nhớ hiện tại và
bộ nhớ đóng băng trong lời nhắc của phiên.

An toàn: chỉ đọc ``state.db``; mục mới bị bộ quét chèn lệnh của Hermes chặn thì không đính; phiên chưa lưu lời
nhắc (lượt đầu) thì bỏ qua — phiên mới tự đọc bộ nhớ mới.
"""

import logging
import os
import re
import sqlite3
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

DELIM = "\n§\n"
TARGETS = (("memory", "MEMORY.md", "MEMORY (your personal notes)", "Ghi chú của trợ lý"),
           ("user", "USER.md", "USER PROFILE (who the user is)", "Hồ sơ chủ nhân"))
# Khối bộ nhớ trong lời nhắc: dòng tiêu đề, dòng ═══, nội dung — hết ở dòng trống trước khối/tiêu đề kế tiếp,
# hoặc trước dòng ngày giờ Hermes đặt ngay sau khối cuối ("Conversation started: …").
_BLOCK_END = re.compile(r"\n\n(?=═{10}|#|<|Conversation started:|\Z)")
MAX_ENTRY_CHARS = 600
# Mục đã gỡ chỉ cần đủ để nhận ra — Hermes lưu câu báo vào lịch sử mỗi lượt, chép nguyên văn thì phiên dài phình to.
REMOVED_HEAD_CHARS = 100
_cache: Dict[str, Tuple[tuple, str]] = {}


def _home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def _entries(text: str) -> List[str]:
    return list(dict.fromkeys(e.strip() for e in (text or "").split(DELIM) if e.strip()))


def frozen_entries(prompt: str, header: str) -> List[str]:
    """Các mục của một khối bộ nhớ trong lời nhắc đã lưu; không có khối → []."""
    i = prompt.find(header)
    if i < 0:
        return []
    body = prompt[i:].split("\n", 2)
    if len(body) < 3:
        return []
    content = body[2]
    end = _BLOCK_END.search(content)
    return _entries(content[: end.start()] if end else content)


def current_entries(home: Path, filename: str) -> List[str]:
    try:
        return _entries((home / "memories" / filename).read_text(encoding="utf-8-sig"))
    except OSError:
        return []


def _blocked(entry: str) -> bool:
    """Bộ quét chèn lệnh của Hermes (như lúc nạp bộ nhớ vào lời nhắc). Không nạp được bộ quét → coi là chặn."""
    try:
        from tools.threat_patterns import scan_for_threats
    except Exception:
        return True
    try:
        return bool(scan_for_threats(entry, scope="strict"))
    except Exception:
        return True


def _head(entry: str) -> str:
    one_line = " ".join(entry.split())
    return one_line if len(one_line) <= REMOVED_HEAD_CHARS else one_line[:REMOVED_HEAD_CHARS].rstrip() + "…"


def drift_note(prompt: str, home: Path) -> str:
    """Câu báo phần chênh giữa bộ nhớ hiện tại và bộ nhớ đóng băng trong ``prompt``; rỗng nếu không chênh."""
    parts: List[str] = []
    for _target, filename, header, label in TARGETS:
        frozen = frozen_entries(prompt, header)
        now = current_entries(home, filename)
        added = [e for e in now if e not in frozen and not _blocked(e)]
        removed = [e for e in frozen if e not in now and not e.startswith("[BLOCKED:")]
        if added:
            parts.append(f"{label} — mục mới:\n" + "\n".join(f"- {e[:MAX_ENTRY_CHARS]}" for e in added))
        if removed:
            parts.append(f"{label} — mục đã gỡ khỏi trí nhớ (thông tin trong đó không còn đúng/không cần nữa; nếu là "
                         f"quy tắc thì hướng dẫn chung của hệ thống vẫn áp dụng như cũ):\n"
                         + "\n".join(f"- {_head(e)}" for e in removed))
    if not parts:
        return ""
    return ("[Bộ nhớ của trợ lý vừa được cập nhật sau khi cuộc trò chuyện này bắt đầu. Phần dưới đây mới hơn "
            "và thay cho phần tương ứng trong MEMORY/USER PROFILE ở lời nhắc hệ thống:]\n" + "\n\n".join(parts))


def _stored_prompt(home: Path, session_id: str) -> Tuple[str, str]:
    """(hash, lời nhắc) đã lưu của phiên; ("", "") khi chưa có hoặc không đọc được."""
    db = home / "state.db"
    if not session_id or not db.exists():
        return "", ""
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        try:
            row = con.execute("select s.system_prompt_hash, coalesce(p.prompt, s.system_prompt) from sessions s "
                              "left join system_prompts p on p.hash = s.system_prompt_hash where s.id = ?",
                              (str(session_id),)).fetchone()
        finally:
            con.close()
    except sqlite3.Error:
        return "", ""
    return (str(row[0] or ""), str(row[1] or "")) if row else ("", "")


def _mtimes(home: Path) -> tuple:
    out = []
    for _t, filename, _h, _l in TARGETS:
        try:
            out.append((home / "memories" / filename).stat().st_mtime_ns)
        except OSError:
            out.append(0)
    return tuple(out)


def pre_llm_call(session_id: str = "", platform: str = "", **_kw) -> Optional[Dict[str, str]]:
    """Hook Hermes: đính phần chênh bộ nhớ vào tin của lượt Zalo này (không đổi lời nhắc hệ thống)."""
    if str(platform or "").lower() != "zalo":
        return None
    try:
        home = _home()
        prompt_hash, prompt = _stored_prompt(home, session_id)
        if not prompt:
            return None
        key = (prompt_hash or str(len(prompt)), _mtimes(home))
        hit = _cache.get(session_id)
        if hit and hit[0] == key:
            note = hit[1]
        else:
            note = drift_note(prompt, home)
            _cache[session_id] = (key, note)
            if len(_cache) > 500:
                _cache.pop(next(iter(_cache)))
        return {"context": note} if note else None
    except Exception:
        logger.debug("[zalo] không so được bộ nhớ với lời nhắc của phiên", exc_info=True)
        return None
