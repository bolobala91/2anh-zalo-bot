"""Kịch bản video (``video.md`` đã kiểm) → tin nhắn dễ đọc để người dùng duyệt trên Zalo: phong cách, khổ, giọng,
thời lượng ước tính, rồi từng cảnh: trên hình có gì, lời đọc. Chỉ đọc chữ, không chạy gì."""

from __future__ import annotations

import re
from typing import Dict, List, Tuple

from . import validate

STYLE_LABELS = {
    "viet-tay": "viết tay trên bảng", "cat-dan": "cắt dán giấy", "vox": "Vox (ảnh minh hoạ AI)",
    "ngan": "video ngắn mạng xã hội (nền neon)",
}
SCENE_LABELS = {
    "tieu-de": "Tiêu đề", "khai-niem": "Khái niệm", "cong-thuc": "Công thức", "y-tung-y": "Danh sách ý",
    "quy-trinh": "Quy trình", "so-sanh": "So sánh", "do-thi": "Đồ thị", "thi-nghiem": "Thí nghiệm",
    "minh-hoa": "Minh hoạ", "anh": "Ảnh", "bieu-do": "Biểu đồ", "so-do": "Sơ đồ", "dong-thoi-gian": "Dòng thời gian",
    "cau-hoi": "Câu hỏi nhanh", "ke-chuyen": "Kể chuyện",
}
VOICE_LABELS = {"nu": "nữ", "nam": "nam", "thu-giang": "Thu Giang (VieNeu)"}
MAX_MESSAGE = 3500
_MARKUP = re.compile(r"\*\*|==|\(\(|\)\)|__|\{\{|\}\}|[~^]")
_SCENE = re.compile(r"^##\s+Cảnh\s+(\d+)\s*$")
_KEY = re.compile(r"^([a-z][a-z0-9-]*)\s*:\s*(.*)$")


def _plain(text: str) -> str:
    return _MARKUP.sub("", text).strip()


def scenes(body: List[str]) -> List[Tuple[int, Dict[str, List[str]]]]:
    out: List[Tuple[int, Dict[str, List[str]]]] = []
    for line in body:
        line = line.strip()
        head = _SCENE.match(line)
        if head:
            out.append((int(head.group(1)), {}))
            continue
        key = _KEY.match(line)
        if key and out:
            out[-1][1].setdefault(key.group(1), []).append(key.group(2).strip())
    return out


def _on_screen(kind: str, f: Dict[str, List[str]]) -> str:
    one = lambda k: _plain(f.get(k, [""])[0])  # noqa: E731
    many = lambda k: [_plain(v) for v in f.get(k, [])]  # noqa: E731
    if kind in ("tieu-de", "ke-chuyen"):
        return " — ".join(x for x in (one("chu") or one("tieu-de"), one("phu")) if x)
    if kind == "khai-niem":
        return f"{one('thuat-ngu')}: {one('dinh-nghia')}"
    if kind == "cong-thuc":
        return one("bieu-thuc")
    if kind == "so-sanh":
        return (f"{one('tieu-de')} | {one('trai')}: {'; '.join(many('y-trai'))} | "
                f"{one('phai')}: {'; '.join(many('y-phai'))}")
    if kind == "y-tung-y":
        return f"{one('tieu-de')}: " + "; ".join(many("y"))
    if kind == "quy-trinh":
        return f"{one('tieu-de')}: " + " → ".join(many("buoc"))
    if kind == "cau-hoi":
        return f"{one('cau-hoi')} ({' / '.join(many('lua-chon'))})"
    if kind == "dong-thoi-gian":
        return f"{one('tieu-de')}: " + "; ".join(many("moc"))
    if kind == "so-do":
        return f"{one('trung-tam')}: " + "; ".join(many("nhanh"))
    if kind == "vox":
        return one("bo-cuc") or "; ".join(many("nhip")[:3])
    return one("tieu-de") or one("chu-thich") or SCENE_LABELS.get(kind, kind)


def render(text: str, draft_id: str, minutes: str) -> str:
    meta, _head, body = validate.front_matter(text)
    style = meta.get("phong-cach", "viet-tay")
    frame = meta.get("kho") or ("doc" if style == "ngan" else "ngang")
    narration = 0
    lines = [f"🎬 KỊCH BẢN VIDEO: {_plain(meta.get('tieu-de', ''))}",
             f"Phong cách: {STYLE_LABELS.get(style, style)} · Khổ: {'dọc 9:16' if frame == 'doc' else 'ngang 16:9'}"
             f" · Giọng: {VOICE_LABELS.get(meta.get('giong', 'nu'), meta.get('giong', 'nữ'))}"]
    if meta.get("loat"):
        lines.append(f"Nhãn kênh: {meta['loat']}")
    lines.append("")
    for number, fields in scenes(body):
        kind = "vox" if "bo-cuc" in fields or "nhip" in fields else (fields.get("loai") or ["?"])[0]
        speech = " ".join(_plain(v) for v in fields.get("loi", []) + fields.get("loi-giai", []))
        narration += len(speech)
        lines.append(f"Cảnh {number} · {SCENE_LABELS.get(kind, 'Cảnh') if kind != 'vox' else 'Cảnh'}")
        shown = _on_screen(kind, fields)
        if shown:
            lines.append(f"🖼 {shown[:220]}")
        if speech:
            lines.append(f"🎙 {speech[:400]}")
        lines.append("")
    seconds = max(10, round(narration / validate.VIDEO_CHARS_PER_SECOND * 1.15))
    lines.insert(2 if not meta.get("loat") else 3, f"Thời lượng ước tính: khoảng {seconds} giây")
    tail = (f"👉 Trả lời \"OK\" để bot dựng video (khoảng {minutes} phút), hoặc nói cần sửa gì (đổi lời, thêm/bớt cảnh, "
            f"đổi phong cách). Mã kịch bản: {draft_id}")
    message = "\n".join(lines).strip()
    if len(message) + len(tail) + 2 > MAX_MESSAGE:
        message = message[:MAX_MESSAGE - len(tail) - 6].rstrip() + "\n…"
    return f"{message}\n\n{tail}"
