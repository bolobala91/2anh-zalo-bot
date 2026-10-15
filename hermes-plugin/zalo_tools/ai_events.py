"""Sổ sự kiện AI ngoài lượt gọi model chính: đọc ảnh (vision), vẽ ảnh, tạo video — mỗi lần một dòng JSON vào
``<HERMES_HOME>/zalo/ai-events.jsonl``:

``{"t": ms, "kind": "vision"|"image"|"video", "engine", "model", "ok": bool, "n": số ảnh, "seconds", "fallbacks",
"uid", "name", "thread", "group": bool, "owner": bool}``

Dashboard (Tổng quan › Sử dụng AI) đếm theo loại, theo nguồn/model, lỗi, người dùng nhiều nhất. Giữ 90 ngày, dọn mỗi
ngày một lần. Cố hết sức — ghi lỗi thì bỏ qua, không bao giờ làm hỏng lượt trả lời hay việc vẽ ảnh/tạo video.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

KEEP_DAYS = 90
KINDS = ("vision", "image", "video")
_lock = threading.Lock()
_state: Dict[str, Any] = {"pruned_day": None, "model": None}


def _home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        return Path(os.getenv("HERMES_HOME") or Path.home() / ".hermes")


def log_path() -> Path:
    return _home() / "zalo" / "ai-events.jsonl"


def main_model() -> str:
    """Model đọc ảnh: ``auxiliary.vision.model`` nếu có, không thì model chính (``model.default``). Đệm theo mtime."""
    path = _home() / "config.yaml"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return ""
    cached = _state["model"]
    if cached and cached[0] == mtime:
        return cached[1]
    model = ""
    try:
        import yaml
        cfg = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        vision = ((cfg.get("auxiliary") or {}).get("vision") or {}) if isinstance(cfg, dict) else {}
        base = cfg.get("model") if isinstance(cfg, dict) else None
        model = str((vision.get("model") if isinstance(vision, dict) else "") or
                    (base.get("default") if isinstance(base, dict) else base) or "")
    except Exception:
        logger.debug("[zalo] không đọc được model trong config.yaml", exc_info=True)
    _state["model"] = (mtime, model)
    return model


def _prune(path: Path, now_ms: int) -> None:
    cutoff = now_ms - KEEP_DAYS * 86_400_000
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    kept = []
    for line in lines:
        try:
            if int(json.loads(line).get("t") or 0) >= cutoff:
                kept.append(line)
        except (ValueError, AttributeError):
            continue
    if len(kept) == len(lines):
        return
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text("".join(f"{line}\n" for line in kept), encoding="utf-8")
    os.replace(tmp, path)


def record(kind: str, *, engine: str = "", model: str = "", ok: bool = True, n: int = 1, seconds: Optional[int] = None,
           fallbacks: int = 0, turn: Optional[Dict[str, Any]] = None, now: Optional[float] = None,
           path: Optional[Path] = None) -> None:
    """Ghi một sự kiện. ``turn``: lượt Zalo đã nhờ (sender_uid, sender_name, thread_id, is_group, is_owner)."""
    if kind not in KINDS:
        return
    now_ms = int((now if now is not None else time.time()) * 1000)
    t = turn or {}
    row: Dict[str, Any] = {
        "t": now_ms, "kind": kind, "engine": str(engine or "")[:40], "model": str(model or "")[:120], "ok": bool(ok),
        "n": max(1, int(n or 1)), "uid": str(t.get("sender_uid") or ""),
        "name": " ".join(str(t.get("sender_name") or "").split())[:80], "thread": str(t.get("thread_id") or ""),
        "group": bool(t.get("is_group")), "owner": bool(t.get("is_owner")),
    }
    if seconds:
        row["seconds"] = int(seconds)
    if fallbacks:
        row["fallbacks"] = int(fallbacks)
    target = path or log_path()
    try:
        with _lock:
            target.parent.mkdir(parents=True, exist_ok=True)
            day = now_ms // 86_400_000
            if _state["pruned_day"] != day and target.exists():
                _state["pruned_day"] = day
                _prune(target, now_ms)
            with target.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError:
        logger.debug("[zalo] không ghi được sổ sự kiện AI", exc_info=True)
