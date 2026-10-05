"""Lệnh ``/model`` gõ trong Zalo — chỉ chủ nhân dùng được.

    /model                 xem model đang dùng
    /model list            danh sách chọn nhanh (ZALO_MODEL_CHOICES)
    /model list all        mọi model endpoint trả về
    /model list <chữ>      lọc danh sách đầy đủ theo chữ đó, vd ``/model list claude``
    /model default         về model mặc định (ZALO_MODEL_DEFAULT)
    /model <tên>           đổi sang model đó

Đổi model là đổi cho cả bot: ghi đúng một dòng ``model.default`` trong
``config.yaml`` của Hermes. Gateway đọc lại config theo mtime ở mỗi tin, chữ ký
agent có tên model nên mọi cuộc chat tự dựng lại agent với model mới — không
cần khởi động lại, không đụng lõi Hermes. Chỉ sửa dòng đó (không dump lại YAML)
để giữ nguyên chú thích và thứ tự khoá anh đã viết tay.
"""

from __future__ import annotations

import difflib
import json
import os
import re
import tempfile
import urllib.request
from pathlib import Path
from typing import Callable, List, Optional

import yaml

_COMMAND = re.compile(r"^/model(?:\s+(.*))?$", re.IGNORECASE | re.DOTALL)
_PLAIN_YAML = re.compile(r"^[A-Za-z0-9._/@:+-]+$")


def parse(text: str) -> Optional[str]:
    """Trả về phần sau ``/model`` (chuỗi rỗng nếu không có), None nếu không phải lệnh này."""
    match = _COMMAND.match((text or "").strip())
    if not match:
        return None
    return (match.group(1) or "").strip()


def split_choices(raw: str) -> List[str]:
    return [item.strip() for item in re.split(r"[,\n]", raw or "") if item.strip()]


def _load_model_cfg(config_path: Path) -> dict:
    data = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    model_cfg = data.get("model")
    return model_cfg if isinstance(model_cfg, dict) else {}


def current_model(config_path: Path) -> str:
    return str(_load_model_cfg(config_path).get("default") or "")


def fetch_models(config_path: Path, timeout: float = 10.0) -> List[str]:
    """Danh sách id từ ``<base_url>/models`` của endpoint đang cấu hình (chuẩn OpenAI)."""
    model_cfg = _load_model_cfg(config_path)
    base_url = str(model_cfg.get("base_url") or "").rstrip("/")
    if not base_url:
        raise RuntimeError("config.yaml chưa có model.base_url")
    request = urllib.request.Request(f"{base_url}/models")
    api_key = str(model_cfg.get("api_key") or "")
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return [str(item["id"]) for item in payload.get("data") or [] if item.get("id")]


def set_default_model(config_path: Path, model: str) -> None:
    """Thay giá trị ``default:`` trong khối ``model:`` cấp cao nhất, giữ nguyên mọi dòng khác."""
    raw = config_path.read_bytes().decode("utf-8")
    lines = raw.splitlines(keepends=True)
    value = model if _PLAIN_YAML.match(model) else json.dumps(model, ensure_ascii=False)
    in_model = False
    child_indent = None
    for index, line in enumerate(lines):
        body = line.rstrip("\r\n")
        if not in_model:
            in_model = body.rstrip() == "model:"
            continue
        if not body.strip() or body.lstrip().startswith("#"):
            continue
        indent = len(body) - len(body.lstrip(" "))
        if indent == 0:
            break
        if child_indent is None:
            child_indent = indent
        if indent != child_indent:
            continue
        match = re.match(r"^(\s+default:\s*)(.*?)(\s+#.*)?$", body)
        if match:
            newline = line[len(body):]
            lines[index] = f"{match.group(1)}{value}{match.group(3) or ''}{newline}"
            break
    else:
        raise RuntimeError("không tìm thấy dòng model.default trong config.yaml")

    updated = "".join(lines)
    if (yaml.safe_load(updated) or {}).get("model", {}).get("default") != model:
        raise RuntimeError("ghi model.default không ra đúng giá trị — giữ nguyên config.yaml")
    fd, tmp = tempfile.mkstemp(dir=str(config_path.parent), prefix=".config.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(updated.encode("utf-8"))
        os.replace(tmp, config_path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def _bullets(models: List[str], current: str, default: str) -> List[str]:
    rows = []
    for model in models:
        marks = []
        if model == current:
            marks.append("đang dùng")
        if model == default:
            marks.append("mặc định")
        rows.append(f"- {model}" + (f" ({', '.join(marks)})" if marks else ""))
    return rows


_USAGE = "Đổi: /model <tên> · Về mặc định: /model default · Xem hết: /model list all"


def handle(
    args: str,
    *,
    config_path: Path,
    choices: List[str],
    default: str,
    fetch: Callable[[Path], List[str]] = fetch_models,
) -> str:
    """Chạy lệnh và trả về câu trả lời gửi lại Zalo. Đồng bộ — gọi qua ``asyncio.to_thread``."""
    current = current_model(config_path)
    words = args.split()
    verb = words[0].lower() if words else ""

    if not words:
        lines = [f"Model đang dùng: {current or '(chưa đặt)'}"]
        if default and default != current:
            lines.append(f"Mặc định: {default}")
        lines.append("Xem danh sách: /model list")
        return "\n".join(lines)

    if verb == "list":
        query = " ".join(words[1:]).strip()
        if not query and choices:
            return "\n".join(["Model chọn nhanh:", *_bullets(choices, current, default), "", _USAGE])
        try:
            models = fetch(config_path)
        except Exception as exc:
            return f"Không lấy được danh sách model từ endpoint: {exc}"
        if query and query.lower() != "all":
            models = [model for model in models if query.lower() in model.lower()]
            if not models:
                return f"Không có model nào chứa “{query}”."
        title = f"Model chứa “{query}” ({len(models)}):" if query and query.lower() != "all" else f"Tất cả model ({len(models)}):"
        return "\n".join([title, *_bullets(models, current, default), "", _USAGE])

    if verb == "default" and len(words) == 1:
        if not default:
            return "Chưa đặt model mặc định. Thêm ZALO_MODEL_DEFAULT=<tên model> vào .env của Hermes rồi khởi động lại gateway."
        target = default
    elif len(words) == 1:
        target = words[0]
    else:
        return "Tên model không có dấu cách. " + _USAGE

    if target == current:
        return f"Bot đang dùng {current} rồi."
    try:
        available = fetch(config_path)
    except Exception as exc:
        return f"Không kiểm tra được model với endpoint nên chưa đổi: {exc}"
    if target not in available:
        close = difflib.get_close_matches(target, available, n=3, cutoff=0.6)
        hint = f" Có phải: {', '.join(close)}?" if close else ""
        return f"Không có model {target} trên endpoint.{hint}\nXem danh sách: /model list"
    try:
        set_default_model(config_path, target)
    except Exception as exc:
        return f"Chưa đổi được model: {exc}"
    return f"Đã đổi cả bot sang {target} (trước đó: {current or 'chưa đặt'}).\nTin nhắn tiếp theo ở mọi nhóm sẽ dùng model mới."
