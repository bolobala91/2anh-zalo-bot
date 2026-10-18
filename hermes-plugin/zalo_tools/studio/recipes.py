"""Danh mục việc của xưởng: loại sản phẩm → nút, tài liệu hướng dẫn, bộ dựng cố định.

Mọi thứ mô hình được chọn là ``kind`` (một khoá trong ``RECIPES``) và vài lựa chọn có danh
sách sẵn. Script, tham số, phần mở rộng tệp kết quả đều nằm ở đây — không có chỗ nào ghép
chuỗi từ lời người dùng vào dòng lệnh.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional, Tuple


@dataclass(frozen=True)
class Recipe:
    kind: str
    switch: str                 # một trong group_permissions.STUDIO_FEATURES
    label: str                  # chữ cho người dùng: "giáo án 5512 (Word)"
    source: str                 # tệp mô hình viết: "giao-an.md", "noi-dung.json", "tro-choi.json"…
    builder: str                # studio_cli | node_engine | doan_docx | markdown_docx | game_html | slides | lecture_video
    guides: Tuple[Tuple[str, Tuple[str, ...]], ...] = ()   # ("studio"|"skills", (đường dẫn thử lần lượt…))
    script: str = ""            # studio_cli: tools/vi/…py; node_engine: thư mục skill
    args: Tuple[str, ...] = ()  # tham số sau script; "{project}" = thư mục dự án trong thư mục việc
    outputs: Tuple[str, ...] = ()
    timeout: int = 300
    network: bool = False       # bộ dựng cần Internet (giọng đọc edge-tts của video)
    options: Dict[str, Tuple[str, ...]] = field(default_factory=dict)
    # Hướng dẫn thêm theo giá trị lựa chọn đầu tiên (video: vox đọc nhịp Vox; viết tay đọc cảnh viết tay).
    extra_guides: Dict[str, Tuple[Tuple[str, Tuple[str, ...]], ...]] = field(default_factory=dict)
    # Trần của CẢ việc: tổng token AI (vào + ra; vượt → dừng, tính lượt) và thời hạn tổng (giây, asyncio.wait_for).
    # Mặc định đủ cho 2 lời gọi viết (bản đầu + một lần sửa) với hướng dẫn ~20k token mỗi lời gọi.
    max_tokens: int = 150_000
    deadline: int = 1_500


GAME_TYPES = ("quiz", "matching", "crossword", "spinwheel", "flashcard", "timer")
SLIDE_TYPES = ("bai-giang", "bao-cao-tong-ket", "hoat-dong-doan", "poster-mang-xa-hoi", "tap-huan-workshop")
ND30_TYPES = (
    "nghi_quyet", "quyet_dinh", "chi_thi", "quy_che", "quy_dinh", "thong_bao", "huong_dan", "chuong_trinh",
    "ke_hoach", "phuong_an", "de_an", "du_an", "bao_cao", "to_trinh", "thong_cao", "bien_ban", "giay_moi",
    "giay_gioi_thieu", "giay_nghi_phep", "giay_uy_quyen", "hop_dong", "cong_dien", "ban_ghi_nho", "cong_van",
)
DANG_TYPES = (
    "nghi_quyet", "chi_thi", "ket_luan", "quyet_dinh", "quy_dinh", "quy_che", "bao_cao", "to_trinh",
    "thong_bao", "huong_dan", "chuong_trinh", "thong_tri", "bien_ban", "cong_van",
)
# Bộ sinh của từng skill theo loại văn bản: (công văn, biên bản, còn lại).
NODE_ENGINES = {
    "soan-van-ban-hanh-chinh": ("engine/generate_cong_van_nd30.js", "engine/generate_bien_ban_nd30.js",
                                "engine/generate_vb_co_ten_loai_nd30.js"),
    "soan-van-ban-dang": ("engine/generate_cong_van_dang.js", "engine/generate_bien_ban.js",
                          "engine/generate_vb_co_ten_loai.js"),
}
DOC_TYPES = {"soan-van-ban-hanh-chinh": ND30_TYPES, "soan-van-ban-dang": DANG_TYPES}
# Khoá JSON cấp ngoài mà bộ sinh của từng skill thật sự đọc (kiểm trong engine/*.js). Khoá khác bị bỏ.
_COMMON_KEYS = ("loai_van_ban", "co_quan_ban_hanh", "ky_hieu_co_quan", "ky_hieu_loai", "so_ky_hieu", "dia_danh", "ngay", "thang",
                "nam", "trich_yeu", "ten_loai", "kinh_gui", "can_cu", "noi_dung", "cac_dieu", "dong_quyet_dinh", "theo_de_nghi",
                "quyen_han_ky", "chuc_vu_ky", "nguoi_ky", "noi_nhan")
ENGINE_KEYS = {
    "soan-van-ban-hanh-chinh": frozenset(_COMMON_KEYS + (
        "co_quan_chu_quan", "kt_chuc_vu", "thu_ky", "chu_toa", "chuc_vu_chu_tri", "chuc_vu_thu_ky",
        "nguoi_chu_tri", "nguoi_ghi_bien_ban")),
    "soan-van-ban-dang": frozenset(_COMMON_KEYS + (
        "co_quan_cap_tren", "chu_de_dai_hoi", "phu_de_chu_de", "chi_dan_luu_hanh", "phu_luc", "xac_nhan", "line_spacing",
        "ky_hieu_soan_thao", "co_kinh_gui_co", "chu_tri", "nguoi_ghi", "chuc_vu_trai", "chuc_vu_phai")),
}


def node_engine(recipe: "Recipe", loai: str) -> str:
    """Script Node (tương đối trong thư mục skill) cho loại văn bản này."""
    cong_van, bien_ban, other = NODE_ENGINES[recipe.script]
    return cong_van if loai == "cong_van" else bien_ban if loai == "bien_ban" else other

# Mọi kiểu video (2Anh Studio vi.18): hook, nhịp, đa dạng cảnh, và chọn giọng theo nội dung (không mặc định một giọng).
VIDEO_CRAFT = (("studio", ("docs/vi/tro-ly/video-hap-dan.md",)), ("studio", ("docs/vi/tro-ly/chon-giong.md",)))

RECIPES: Dict[str, Recipe] = {r.kind: r for r in (
    Recipe("slide", "studioSlides", "slide PowerPoint", "svg_output", "slides",
           guides=(("studio", ("docs/vi/tro-ly/{loai}.md",)),
                   ("studio", ("skills/ppt-master/references/canvas-formats.md",)),
                   ("studio", ("skills/ppt-master/references/semantic-svg.md",)),
                   ("studio", ("skills/ppt-master/references/shared-standards-core.md",))),
           outputs=(".pptx",), timeout=900, options={"loai": SLIDE_TYPES},
           # dàn ý + ≤ 12 trang + sửa trang + một vòng sửa theo bộ kiểm, ~25k token mỗi lời gọi
           max_tokens=800_000, deadline=3_600),
    Recipe("giao_an", "studioDocs", "giáo án 5512 (Word)", "giao-an.md", "studio_cli",
           guides=(("studio", ("docs/vi/tro-ly/giao-an.md",)), ("studio", ("docs/vi/tro-ly/nang-luc-so-va-ai.md",))),
           script="tools/vi/giao_an.py", args=("xuat", "{project}"), outputs=(".docx",)),
    Recipe("van_ban", "studioDocs", "văn bản hành chính Nghị định 30 (Word)", "noi-dung.json", "node_engine",
           guides=(("skills", ("soan-van-ban-hanh-chinh/SKILL.md",)),
                   ("skills", ("soan-van-ban-hanh-chinh/references/quy_tac_the_thuc.md",)),
                   ("skills", ("soan-van-ban-hanh-chinh/references/phan_quyen_ky.md",))),
           script="soan-van-ban-hanh-chinh", outputs=(".docx",), timeout=120),
    Recipe("van_ban_doan", "studioDocs", "văn bản Đoàn (Word)", "noi-dung.json", "doan_docx",
           guides=(("skills", ("soan-van-ban-doan/SKILL.md",)),
                   ("skills", ("soan-van-ban-doan/references/the-thuc-van-ban-doan.md",)),
                   ("skills", ("soan-van-ban-doan/references/mau-van-ban.md",))),
           script="soan-van-ban-doan", outputs=(".docx",), timeout=120),
    Recipe("van_ban_dang", "studioDocs", "văn bản Đảng (Word)", "noi-dung.json", "node_engine",
           guides=(("skills", ("soan-van-ban-dang/SKILL.md",)),
                   ("skills", ("soan-van-ban-dang/references/quy_tac_the_thuc_dang.md",))),
           script="soan-van-ban-dang", outputs=(".docx",), timeout=120),
    Recipe("de_kiem_tra", "studioExams", "đề kiểm tra (Word)", "de.md", "markdown_docx",
           guides=(("skills", ("de-kiem-tra/SKILL.md",)),), outputs=(".docx",), timeout=120),
    Recipe("de_tieng_anh", "studioExams", "đề KHTN tiếng Anh (Word)", "de.md", "studio_cli",
           guides=(("studio", ("docs/vi/tro-ly/de-khtn-tieng-anh.md",)),
                   ("studio", ("docs/vi/tro-ly/tieng-anh-khoa-hoc.md",))),
           script="tools/vi/de_thi.py", args=("{project}",), outputs=(".docx",)),
    Recipe("skkn", "studioExams", "sáng kiến kinh nghiệm (Word)", "skkn.md", "markdown_docx",
           guides=(("skills", ("skkn-writer/SKILL.md",)), ("skills", ("skkn-writer/references/cautruc-chuan.md",))),
           outputs=(".docx",), timeout=120),
    Recipe("tro_choi", "studioExams", "trò chơi (HTML)", "tro-choi.json", "game_html",
           guides=(("skills", ("tro-choi-giao-duc/references/{loai}.md", "tro-choi-giao-duc/references/flashcard-timer.md")),),
           outputs=(".html",), timeout=60, options={"loai": GAME_TYPES}),
    Recipe("thi_nghiem", "studioExams", "thí nghiệm ảo (HTML + phiếu Word)", "thi-nghiem.md", "studio_cli",
           guides=(("studio", ("docs/vi/tro-ly/thi-nghiem-ao.md",)),),
           script="tools/vi/thi_nghiem.py", args=("{project}",), outputs=(".html", ".docx")),
    Recipe("video", "studioVideo", "video giải thích (MP4)", "video.md", "studio_cli",
           script="tools/vi/video_ma.py", args=("{project}",), outputs=(".mp4",), timeout=1800, network=True,
           max_tokens=200_000, deadline=3_600,
           options={"kieu": ("viet-tay", "cat-dan", "vox", "ngan")},
           extra_guides={
               # Video ngắn mạng xã hội (2Anh Studio vi.17): công thức giải thích / so sánh A–B / tin từ link.
               "ngan": (("studio", ("docs/vi/tro-ly/video-ngan.md",)),
                        ("studio", ("docs/vi/tham-khao/video-viet-tay.md", "docs/vi/tro-ly/video-viet-tay.md")),
                        ("studio", ("docs/vi/tham-khao/canh-video.md", "docs/vi/tro-ly/canh-video.md")), *VIDEO_CRAFT),
               "vox": (("studio", ("docs/vi/tro-ly/video-giai-thich.md",)), ("studio", ("docs/vi/tro-ly/nhip-vox.md",)),
                       *VIDEO_CRAFT),
               "viet-tay": (("studio", ("docs/vi/tham-khao/video-viet-tay.md", "docs/vi/tro-ly/video-viet-tay.md")),
                            ("studio", ("docs/vi/tham-khao/canh-video.md", "docs/vi/tro-ly/canh-video.md")), *VIDEO_CRAFT),
               "cat-dan": (("studio", ("docs/vi/tham-khao/video-viet-tay.md", "docs/vi/tro-ly/video-viet-tay.md")),
                           ("studio", ("docs/vi/tham-khao/canh-video.md", "docs/vi/tro-ly/canh-video.md")), *VIDEO_CRAFT),
           }),
    Recipe("video_bai_giang", "studioVideo", "video bài giảng từ slide (MP4)", "svg_output", "lecture_video",
           guides=(("studio", ("docs/vi/tro-ly/{loai}.md",)),
                   ("studio", ("docs/vi/tro-ly/video-bai-giang.md",)),
                   ("studio", ("skills/ppt-master/references/canvas-formats.md",)),
                   ("studio", ("skills/ppt-master/references/semantic-svg.md",)),
                   ("studio", ("skills/ppt-master/references/shared-standards-core.md",))),
           outputs=(".mp4",), timeout=2400, network=True, options={"loai": SLIDE_TYPES},
           max_tokens=900_000, deadline=7_200),
)}


def kinds_for(switch: str) -> Tuple[str, ...]:
    return tuple(kind for kind, recipe in RECIPES.items() if recipe.switch == switch)


@dataclass(frozen=True)
class Places:
    studio: Optional[Path]      # repo 2Anh Studio (ZALO_STUDIO_DIR)
    python: Optional[Path]      # Python của venv repo đó
    skills: Optional[Path]      # thư mục skill Hermes (soan-van-ban-*, de-kiem-tra…)
    node: Optional[str]


def _setting(name: str) -> str:
    try:
        from agent.secret_scope import UnscopedSecretError, get_secret
        try:
            return str(get_secret(name, "") or "").strip()
        except UnscopedSecretError:
            return os.getenv(name, "").strip()
    except Exception:
        return os.getenv(name, "").strip()


def places() -> Places:
    """Chỗ cài 2Anh Studio và skill trên máy này. Thiếu thứ gì thì trường đó là None."""
    import shutil

    raw = _setting("ZALO_STUDIO_DIR")
    studio = Path(raw).expanduser() if raw else None
    if studio is not None and not (studio / "tools" / "vi").is_dir():
        studio = None
    python = None
    explicit = _setting("ZALO_STUDIO_PYTHON")
    candidates = [Path(explicit)] if explicit else []
    if studio is not None:
        candidates += [studio / "venv" / "Scripts" / "python.exe", studio / "venv" / "bin" / "python"]
    for candidate in candidates:
        if candidate.is_file():
            python = candidate
            break
    raw = _setting("ZALO_STUDIO_SKILLS_DIR")
    if raw:
        skills = Path(raw).expanduser()
    else:
        try:
            from hermes_constants import get_hermes_home
            skills = Path(get_hermes_home()) / "skills"
        except Exception:
            skills = Path(os.getenv("HERMES_HOME") or Path.home() / ".hermes") / "skills"
    return Places(studio=studio, python=python, skills=skills if skills.is_dir() else None,
                  node=shutil.which("node"))


def missing(recipe: Recipe, where: Places) -> Optional[str]:
    """Câu báo thiếu gì để làm loại này trên máy; None khi đủ."""
    if recipe.builder in ("studio_cli", "slides", "lecture_video") and (where.studio is None or where.python is None):
        return "máy chủ chưa cài 2Anh Studio cho xưởng"
    if recipe.builder == "doan_docx" and (
            where.skills is None or not (where.skills / recipe.script / "scripts" / "validate_van_ban_doan.py").is_file()):
        return "máy chủ chưa có skill soạn văn bản Đoàn"
    if recipe.builder == "node_engine":
        if where.skills is None or where.node is None:
            return "máy chủ chưa có bộ soạn văn bản"
        if not (where.skills / recipe.script / "node_modules" / "docx").is_dir():
            return "máy chủ chưa có bộ soạn văn bản"
    if recipe.builder in ("markdown_docx", "game_html") and recipe.guides and where.skills is None:
        return "máy chủ chưa có skill hướng dẫn cho loại này"
    return None


def guide_paths(recipe: Recipe, where: Places, options: Dict[str, str]) -> Tuple[Path, ...]:
    """Tệp hướng dẫn có thật trên máy, theo thứ tự trong công thức (ứng viên đầu tiên có mặt thắng).

    Giá trị lựa chọn phải nằm trong danh sách của công thức (``ValueError`` nếu không) — chỉ chúng được ghép vào
    đường dẫn, nên không có ``../`` nào từ lời gọi công cụ lọt vào đây. Khoá lạ bị bỏ qua."""
    for key, value in options.items():
        if key in recipe.options and value not in recipe.options[key]:
            raise ValueError(f"lựa chọn {key}={value!r} không có trong danh sách của {recipe.kind}")
    safe = {key: value for key, value in options.items() if key in recipe.options}
    found = []
    first = next(iter(recipe.options), None)
    extra = recipe.extra_guides.get(safe.get(first, ""), ()) if first else ()
    for base_key, candidates in (*recipe.guides, *extra):
        base = where.studio if base_key == "studio" else where.skills
        if base is None:
            continue
        for rel in candidates:
            try:
                path = base / rel.format(**safe)
            except (KeyError, IndexError):
                continue
            if path.is_file():
                found.append(path)
                break
    return tuple(found)


def python_for(where: Places) -> str:
    return str(where.python or sys.executable)
