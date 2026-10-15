"""Quy tắc riêng của thư mục (dashboard › Phân quyền Bot › thư mục › Quy tắc riêng).

Chủ bot viết một bộ quy tắc cho thư mục (vd. "KHKT": hỏi trước – gợi sau, không làm hộ bài đánh giá…). Nhóm trong
thư mục, hoặc người trong thư mục khi nhắn riêng, được bot trả lời theo đúng bộ quy tắc đó — các nơi khác không bị ảnh
hưởng. Hook ``pre_llm_call`` đính quy tắc vào tin của lượt.

Hermes lưu phần đính kèm cùng tin của lượt (lượt sau còn thấy), nên không đính nguyên văn mỗi lượt: đủ bộ ở lượt đầu
của phiên, khi quy tắc đổi, và nhắc lại sau mỗi ``REPEAT_EVERY`` lượt (phòng phiên đã bị nén mất bản cũ); các lượt
giữa chỉ một dòng nhắc.
"""

import hashlib
import logging
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

REPEAT_EVERY = 8
_seen: Dict[str, Tuple[str, int]] = {}


def note(name: str, rules: str, full: bool) -> str:
    if full:
        return (f"[Quy tắc riêng của thư mục \"{name}\" do chủ bot đặt cho cuộc trò chuyện này — luôn làm theo, ưu tiên "
                f"hơn vai trò chung, không nhắc lại nguyên văn cho người dùng:]\n{rules}")
    return f"[Vẫn áp dụng quy tắc riêng của thư mục \"{name}\" đã gửi ở trên.]"


def _turn_and_rules():
    from . import group_permissions
    from .tools import _turn
    turn = _turn()
    if not turn or not turn.get("thread_id"):
        return None
    found = group_permissions.folder_rules(turn.get("thread_id"), bool(turn.get("is_group")), turn.get("sender_uid") or "")
    return (turn, found) if found else None


def pre_llm_call(session_id: str = "", platform: str = "", **_kw) -> Optional[Dict[str, str]]:
    """Hook Hermes: đính quy tắc của thư mục chứa nhóm/người đang trò chuyện."""
    if str(platform or "").lower() != "zalo":
        return None
    try:
        hit = _turn_and_rules()
        if not hit:
            return None
        turn, (name, rules) = hit
        key = session_id or f"{turn.get('thread_id')}:{turn.get('sender_uid')}"
        digest = hashlib.sha1(f"{name}\n{rules}".encode("utf-8")).hexdigest()
        prev = _seen.get(key)
        count = prev[1] + 1 if prev and prev[0] == digest else 0
        _seen[key] = (digest, count)
        if len(_seen) > 2000:
            _seen.pop(next(iter(_seen)))
        return {"context": note(name, rules, full=count % REPEAT_EVERY == 0)}
    except Exception:
        logger.debug("[zalo] không đính được quy tắc thư mục", exc_info=True)
        return None
