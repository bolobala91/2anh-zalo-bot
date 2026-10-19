"""Kịch bản video chờ người dùng duyệt (bước "lên kịch bản → xác nhận → dựng").

Mỗi bản nháp gắn với đúng người nhờ và cuộc trò chuyện đã nhờ; chỉ người đó, ở đúng chỗ đó, mới dùng được để dựng.
Lưu ở ``<HERMES_HOME>/zalo/studio-drafts.json`` (gateway khởi động lại vẫn còn), giữ 48 giờ. Người không phải chủ
nhân viết tối đa ``MAX_DRAFTS_PER_DAY`` bản mỗi ngày (viết kịch bản tốn token dù chưa dựng)."""

from __future__ import annotations

import json
import logging
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from .ledger import _lock_for, _retry, usage_path, vn_day

logger = logging.getLogger(__name__)

KEEP_SECONDS = 48 * 3600
MAX_DRAFTS = 300
MAX_DRAFTS_PER_DAY = 5


def drafts_path() -> Path:
    return usage_path().with_name("studio-drafts.json")


def new_draft_id() -> str:
    return "kb-" + secrets.token_hex(4)


class Drafts:
    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path else drafts_path()
        self._lock: threading.Lock = _lock_for(self.path)

    def _read(self) -> Dict[str, Any]:
        try:
            data = json.loads(_retry(self.path.read_text, "utf-8-sig"))
            if isinstance(data, dict) and isinstance(data.get("drafts"), dict):
                data.setdefault("days", {})
                return data
        except FileNotFoundError:
            pass
        except Exception as exc:
            logger.warning("[zalo] kịch bản chờ duyệt %s hỏng — bắt đầu lại: %s", self.path, exc)
        return {"drafts": {}, "days": {}}

    def _write(self, data: Dict[str, Any]) -> None:
        now = time.time()
        live = {k: v for k, v in data["drafts"].items() if now - float(v.get("created", 0)) < KEEP_SECONDS}
        data["drafts"] = dict(sorted(live.items(), key=lambda kv: kv[1].get("created", 0))[-MAX_DRAFTS:])
        today = vn_day()
        data["days"] = {today: data["days"].get(today, {})}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(f"{self.path.name}.{os.getpid()}-{secrets.token_hex(4)}.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        _retry(os.replace, tmp, self.path)

    def take_slot(self, uid: str, *, owner: bool) -> bool:
        """Giữ một lượt viết kịch bản hôm nay; hết lượt → False. Chủ nhân không giới hạn."""
        with self._lock:
            data = self._read()
            day = data["days"].setdefault(vn_day(), {})
            if not owner and int(day.get(uid, 0)) >= MAX_DRAFTS_PER_DAY:
                return False
            day[uid] = int(day.get(uid, 0)) + 1
            self._write(data)
            return True

    def save(self, draft_id: str, record: Dict[str, Any]) -> None:
        with self._lock:
            data = self._read()
            data["drafts"][draft_id] = {**record, "created": time.time()}
            self._write(data)

    def get(self, draft_id: str, *, uid: str, thread_id: str) -> Optional[Dict[str, Any]]:
        """Bản nháp của đúng người, đúng cuộc trò chuyện, còn hạn; không thì None."""
        with self._lock:
            rec = self._read()["drafts"].get(str(draft_id or ""))
        if not rec or time.time() - float(rec.get("created", 0)) >= KEEP_SECONDS:
            return None
        if str(rec.get("uid")) != str(uid) or str(rec.get("thread_id")) != str(thread_id):
            return None
        return rec

    def latest(self, *, uid: str, thread_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            items = self._read()["drafts"].items()
        now = time.time()
        mine = [dict(v, id=k) for k, v in items if str(v.get("uid")) == str(uid) and str(v.get("thread_id")) == str(thread_id)
                and now - float(v.get("created", 0)) < KEEP_SECONDS]
        return max(mine, key=lambda v: v.get("created", 0)) if mine else None

    def drop(self, draft_id: str) -> None:
        with self._lock:
            data = self._read()
            if data["drafts"].pop(str(draft_id), None) is not None:
                self._write(data)
