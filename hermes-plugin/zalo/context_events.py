"""Local, bounded diagnostic metadata. Never persist message text or request data."""
from __future__ import annotations

import json
import math
from pathlib import Path
import re
import threading
import time
import uuid

MAX_BYTES = 512 * 1024
REASONS = frozenset(("tag_bot", "call_word", "reply_bot", "self", "empty", "ignored_sender",
                     "group_disabled", "owner_only", "no_context", "expired", "other_sender",
                     "other_target", "missing_bot_context", "probability", "unavailable", "direct_address_fallback"))
MODELS = frozenset(("openrouter/typesafe/jev-1.13", "typesafe/jev-1.13", "typesafe/jev-1.14", "gemini/gemini-3.8-flash",
                    "gemini-3.8-flash-high",
                    "google/gemma-4-26b-a4b-it:free", "google/gemma-4-31b-it:free"))
STATUSES = frozenset(("ok", "timeout", "http_error", "invalid_response", "error"))
_lock = threading.Lock()


def log_path() -> Path:
    # No fallback to another profile when Hermes cannot resolve its current scope.
    from hermes_constants import get_hermes_home
    return Path(get_hermes_home()) / "zalo" / "context-gate-events.jsonl"


def _id(value):
    value = str(value or "")
    return value if re.fullmatch(r"[\w.-]{1,64}", value, flags=re.ASCII) else ""


def _number(value, maximum):
    return (not isinstance(value, bool) and isinstance(value, (int, float))
            and math.isfinite(value) and 0 <= value <= maximum)


def record(*, account, thread, message, respond, details, cli_message="", path=None):
    """Best effort only: a disk failure must not alter the gate decision."""
    try:
        row = {"id": uuid.uuid4().hex, "at": int(time.time() * 1000), "account": _id(account),
               "thread": _id(thread), "message": _id(message), "cli_message": _id(cli_message),
               "decision": "RESPOND" if respond is True else "IGNORE",
               "reason": details.get("reason") if details.get("reason") in REASONS else "unavailable"}
        if not row["account"] or not row["thread"]:
            return
        for key, maximum in (("probability", 1), ("threshold", 1), ("duration_ms", 60000)):
            if _number(details.get(key), maximum):
                row[key] = details[key]
        row["stages"] = []
        for raw in details.get("stages", [])[:3]:
            stage = {"provider": raw.get("provider") if raw.get("provider") in {"9router", "openrouter", "cli"} else "custom",
                     "model": raw.get("model") if raw.get("model") in MODELS else "custom",
                     "status": raw.get("status") if raw.get("status") in STATUSES else "error"}
            for key, maximum in (("duration_ms", 60000), ("http_status", 599), ("probability", 1)):
                if _number(raw.get(key), maximum):
                    stage[key] = raw[key]
            row["stages"].append(stage)
        data = (json.dumps(row, ensure_ascii=True, allow_nan=False) + "\n").encode("utf-8")
        target = Path(path) if path else log_path()
        with _lock:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists() and target.stat().st_size + len(data) > MAX_BYTES:
                target.replace(target.with_suffix(target.suffix + ".1"))
            with target.open("ab") as output:
                output.write(data)
    except Exception:
        # No exception text: filesystem paths or injected values may be sensitive.
        return
