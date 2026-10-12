"""Sổ hồ sơ người quen trên Zalo.

Hermes có sẵn ``memories/USER.md``, nhưng đó là **một** hồ sơ — của chủ nhân.
Trong một nhóm Zalo thì mỗi người là một người khác nhau, nên cần một cuốn sổ
tra theo UID Zalo: ai vừa nhắn, bot lật đúng trang của người đó.

Lưu bằng JSON chứ không phải SQLite. Quy mô ở đây là vài chục tới vài trăm
người trong mấy nhóm — một tệp đọc được bằng mắt thường và sửa được bằng tay
đáng giá hơn một cơ sở dữ liệu phải mở bằng công cụ riêng.

Cấu trúc::

    {
      "1234567890123456789": {
        "name": "Minh",
        "note": "Giáo viên Hoá, phụ trách Đoàn trường",
        "fields": {"lĩnh vực": "giáo dục", "vai trò": "phó bí thư"},
        "scopes": {"fields": {"lĩnh vực": ["g:<groupId>"]}, "note": ["u:1234567890123456789"]},
        "updated_at": 1788400000,
        "updated_by": "1234567890123456789"
      }

``scopes`` ghi nơi mỗi mục được nói ra; mục chỉ được dùng lại ở đúng nơi đó và trong
tin nhắn riêng của chính người đó (xem ``visible_profile``). ``"*"`` = chủ bot chọn "Mọi nơi" trên dashboard.
    }

Ranh giới quan trọng: hồ sơ ở đây là **lời tự khai**, không phải danh tính đã
xác thực. Ai cũng có thể nói "tôi là quản trị viên". Vì vậy nó chỉ dùng để
xưng hô và hiểu ngữ cảnh — không bao giờ được dùng để cấp quyền. Quyền vẫn
chỉ dựa vào ``ZALO_ALLOWED_USERS``.
"""

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

MAX_NAME = 80
MAX_NOTE = 400
MAX_FIELDS = 12
MAX_FIELD_LEN = 120
MAX_PEOPLE = 5000


def _store_path() -> Path:
    """Nơi cất sổ. Mặc định nằm cạnh dữ liệu của sidecar."""
    explicit = (os.getenv("ZALO_PEOPLE_FILE") or "").strip()
    if explicit:
        return Path(explicit).expanduser()

    home = os.getenv("HERMES_HOME")
    base = Path(home).expanduser() if home else Path.home() / ".hermes"
    return base / "zalo" / "people.json"


def _load() -> Dict[str, Any]:
    path = _store_path()
    try:
        if not path.exists():
            return {}
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("[zalo] không đọc được sổ hồ sơ (%s): %s", path, exc)
        return {}


def _save(data: Dict[str, Any]) -> bool:
    path = _store_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Ghi ra tệp tạm rồi thay thế: mất điện giữa chừng không làm hỏng sổ cũ.
        tmp = path.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        tmp.replace(path)
        return True
    except OSError as exc:
        logger.warning("[zalo] không ghi được sổ hồ sơ (%s): %s", path, exc)
        return False


def _clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def get_person(uid: str) -> Optional[Dict[str, Any]]:
    return _load().get(str(uid))


# Phạm vi (spec: "nhóm này không lộ chuyện nhóm kia"): mỗi mục hồ sơ nhớ cuộc trò chuyện nơi
# nó được ghi — "g:<groupId>" hoặc "u:<uid>" (nhắn riêng). Mục chỉ hiện lại ở đúng nơi đó và trong
# tin nhắn riêng của chính người đó. Mục cũ chưa có phạm vi → chỉ trong tin nhắn riêng của họ.
MAX_SCOPES = 20


def turn_scope(is_group: bool, thread_id: Any) -> str:
    tid = str(thread_id or "").strip()
    if not tid:
        return ""
    return f"g:{tid}" if is_group else f"u:{tid}"


def _scope_list(value: Any) -> list:
    return [str(x) for x in value if isinstance(x, str)] if isinstance(value, list) else []


def visible_profile(uid: str, person: Optional[Dict[str, Any]], scope: str, *, full: bool = False) -> Dict[str, Any]:
    """Phần hồ sơ được dùng ở ``scope``.

    ``full`` → tất cả (chủ nhân nhắn riêng với bot). Nhắn riêng với chính người đó → mọi mục trừ điều ghi
    trong tin nhắn riêng của NGƯỜI KHÁC (vd. chủ nhân ghi chú về họ). Nơi khác → chỉ mục nói ở đúng nơi đó.
    """
    if not isinstance(person, dict):
        return {}
    own_dm = bool(scope) and scope == f"u:{uid}"
    scopes = person.get("scopes") if isinstance(person.get("scopes"), dict) else {}
    field_scopes = scopes.get("fields") if isinstance(scopes.get("fields"), dict) else {}

    def ok(places: list) -> bool:
        # "*": chủ bot chọn "Mọi nơi" trên dashboard — dùng ở mọi nhóm và mọi tin nhắn riêng.
        if full or "*" in places:
            return True
        if own_dm:
            return not places or any(p == scope or p.startswith("g:") for p in places)
        return bool(scope) and scope in places

    out: Dict[str, Any] = {}
    if person.get("name"):
        out["name"] = person["name"]
    fields = person.get("fields") if isinstance(person.get("fields"), dict) else {}
    shown = {k: v for k, v in fields.items() if ok(_scope_list(field_scopes.get(k)))}
    if shown:
        out["fields"] = shown
    if person.get("note") and ok(_scope_list(scopes.get("note"))):
        out["note"] = person["note"]
    return out


def describe_person(uid: str, *, scope: str = "") -> str:
    """Một dòng ngắn để kẹp vào ngữ cảnh cho model, chỉ gồm phần dùng được ở ``scope``. Rỗng nếu chưa biết ai."""
    p = visible_profile(str(uid), get_person(uid), scope)
    if not p:
        return ""

    bits = []
    if p.get("name"):
        bits.append(p["name"])
    bits += [f"{k}: {v}" for k, v in list((p.get("fields") or {}).items())[:MAX_FIELDS]]
    if p.get("note"):
        bits.append(p["note"])
    return " · ".join(b for b in bits if b)


def _with_scope(old: list, scope: str, same_value: bool) -> list:
    """Giá trị không đổi → thêm nơi biết; giá trị mới → chỉ nơi vừa nói (không đẩy giá trị mới sang nơi cũ)."""
    if not scope:
        return old if same_value else []
    if same_value and "*" in old:
        return old  # chủ bot đã cho dùng "Mọi nơi" — giữ nguyên, đừng cắt mất dấu "*"
    merged = [x for x in old if x != scope] if same_value else []
    return (merged + [scope])[-MAX_SCOPES:]


def remember_person(
    uid: str,
    *,
    name: str = "",
    note: str = "",
    fields: Optional[Dict[str, Any]] = None,
    updated_by: str = "",
    scope: str = "",
) -> Dict[str, Any]:
    """Ghi hoặc bổ sung hồ sơ. Trường để trống thì giữ nguyên giá trị cũ. ``scope``: nơi đang nói (xem ``turn_scope``)."""
    uid = str(uid).strip()
    if not uid:
        raise ValueError("thiếu UID")

    data = _load()
    if uid not in data and len(data) >= MAX_PEOPLE:
        raise ValueError("sổ hồ sơ đã đầy")

    entry = dict(data.get(uid) or {})
    scopes = dict(entry.get("scopes")) if isinstance(entry.get("scopes"), dict) else {}
    field_scopes = dict(scopes.get("fields")) if isinstance(scopes.get("fields"), dict) else {}
    if name:
        entry["name"] = _clip(name, MAX_NAME)
    if note:
        value = _clip(note, MAX_NOTE)
        scopes["note"] = _with_scope(_scope_list(scopes.get("note")), scope, entry.get("note") == value)
        entry["note"] = value

    if fields:
        merged = dict(entry.get("fields") or {})
        for k, v in list(fields.items())[:MAX_FIELDS]:
            key = _clip(k, 40)
            if key:
                value = _clip(v, MAX_FIELD_LEN)
                field_scopes[key] = _with_scope(_scope_list(field_scopes.get(key)), scope, merged.get(key) == value)
                merged[key] = value
        entry["fields"] = dict(list(merged.items())[:MAX_FIELDS])
    kept = entry.get("fields") if isinstance(entry.get("fields"), dict) else {}
    scopes["fields"] = {k: v for k, v in field_scopes.items() if k in kept}
    entry["scopes"] = scopes

    entry["updated_at"] = int(time.time())
    if updated_by:
        entry["updated_by"] = str(updated_by)

    data[uid] = entry
    _save(data)
    return entry


def forget_person(uid: str) -> bool:
    data = _load()
    if str(uid) not in data:
        return False
    data.pop(str(uid), None)
    _save(data)
    return True


def list_people(limit: int = 100, *, scope: str = "", full: bool = False) -> Dict[str, Any]:
    """Sổ, mới nhất trước. Không ``full`` thì chỉ những người có điều được nói ở ``scope`` (không lộ ai có trong sổ)."""
    data = _load()
    items = sorted(data.items(), key=lambda kv: kv[1].get("updated_at", 0), reverse=True)
    if full:
        people = dict(items[:limit])
        return {"count": len(data), "people": people}
    people = {}
    for k, v in items:
        seen = visible_profile(k, v, scope)
        if seen.get("fields") or seen.get("note"):
            people[k] = seen
            if len(people) >= limit:
                break
    return {"count": len(people), "people": people}
