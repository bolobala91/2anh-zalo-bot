"""Cắt, ghép và sửa video bằng FFmpeg cho ``zalo_video_ghep`` / ``zalo_video_edit``.

Nguồn mỗi đoạn: link video (tải đúng đoạn bằng ``media.download_video``) hoặc video người dùng vừa gửi vào Zalo
(``turn["attachments"]``, chọn theo số thứ tự). Mọi đoạn được đưa về cùng một khổ (đa số dọc → 720×1280, ngược lại
1280×720; hình lệch tỉ lệ thì đặt giữa trên nền mờ của chính nó, không méo), 30 khung/giây, AAC 44,1 kHz stereo,
rồi nối. Bản "sửa" thêm: chuyển cảnh (xfade + acrossfade), logo (ảnh người dùng gửi), nhạc nền (tệp nhạc gửi
kèm hoặc link), phụ đề (Phudu vàng viền đen, chuẩn của chủ bot). FFmpeg chạy với thư mục làm việc là thư mục tạm
của việc và tên tệp tương đối, nên không phải thoát đường dẫn trong bộ lọc."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .media import MediaError

FONT_DIR = Path(__file__).resolve().parent / "fonts"
FONT_PHU_DE = "Phudu ExtraBold"
MAX_DOAN_THANH_VIEN = 5
MAX_DOAN_CHU = 10
MAX_PHUT_THANH_VIEN = 10
MAX_MB = 300
CHUYEN_CANH = {"mo": "fade", "truot": "slideleft", "xoa": "wipeleft", "tron": "circleopen", "phong": "zoomin"}
CHUYEN_DAI = 0.5
VI_TRI_LOGO = {"tren-phai": "W-w-28:28", "tren-trai": "28:28", "duoi-phai": "W-w-28:H-h-28", "duoi-trai": "28:H-h-28"}
FFMPEG_TIMEOUT = 900


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise MediaError("máy chủ chưa cài FFmpeg nên chưa cắt ghép video được")
    return exe


def _chay(args: List[str], cwd: str, timeout: int = FFMPEG_TIMEOUT) -> None:
    try:
        proc = subprocess.run([_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", *args], cwd=cwd,
                              capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        raise MediaError("xử lý video quá lâu nên đã dừng — thử đoạn ngắn hơn") from None
    if proc.returncode != 0:
        raise MediaError(f"FFmpeg lỗi khi xử lý video: {(proc.stderr or '').strip()[-240:]}")


def do(path: str) -> Dict[str, Any]:
    """ffprobe: {giay, rong, cao, co_tieng}."""
    exe = shutil.which("ffprobe")
    if not exe:
        raise MediaError("máy chủ chưa cài ffprobe")
    proc = subprocess.run([exe, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
                          capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    try:
        info = json.loads(proc.stdout or "{}")
    except ValueError:
        info = {}
    streams = info.get("streams") or []
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    if v is None:
        raise MediaError(f"tệp `{Path(path).name}` không phải video đọc được")
    rot = abs(int(((v.get("tags") or {}).get("rotate") or 0))) % 180
    for side in v.get("side_data_list") or []:
        if "rotation" in side:
            rot = abs(int(side["rotation"])) % 180
    rong, cao = int(v.get("width") or 0), int(v.get("height") or 0)
    if rot == 90:
        rong, cao = cao, rong
    giay = float((info.get("format") or {}).get("duration") or v.get("duration") or 0)
    if giay <= 0:
        raise MediaError(f"không đọc được thời lượng của `{Path(path).name}`")
    return {"giay": giay, "rong": rong, "cao": cao, "co_tieng": any(s.get("codec_type") == "audio" for s in streams)}


def chon_tep(attachments: List[Dict[str, Any]], loai: str, so: int) -> str:
    """Tệp người dùng gửi thứ ``so`` (đếm từ 1) trong số tệp cùng loại (video/image/audio)."""
    ds = [a for a in attachments or [] if str(a.get("mime") or "").startswith(loai + "/") and a.get("path")
          and Path(str(a["path"])).is_file()]
    ten = {"video": "video", "image": "ảnh", "audio": "tệp nhạc"}[loai]
    if not ds:
        raise MediaError(f"chưa thấy {ten} nào người dùng gửi kèm — nhờ họ gửi {ten} vào cuộc trò chuyện rồi gọi lại")
    if not 1 <= so <= len(ds):
        raise MediaError(f"người dùng chỉ gửi {len(ds)} {ten}; `tep` phải từ 1 đến {len(ds)}")
    return str(ds[so - 1]["path"])


def kho_chung(cac_do: List[Dict[str, Any]]) -> Tuple[int, int]:
    doc = sum(1 for d in cac_do if d["cao"] > d["rong"])
    return (720, 1280) if doc * 2 > len(cac_do) else (1280, 720)


def chuan_hoa(vao: str, ra: str, kho: Tuple[int, int], co_tieng: bool, cwd: str,
              tu: Optional[float] = None, den: Optional[float] = None) -> None:
    """Một đoạn → khổ chung, nền mờ khi lệch tỉ lệ, 30 fps, H.264 + AAC stereo (thêm im lặng nếu không có tiếng)."""
    w, h = kho
    cat = (["-ss", f"{tu:.3f}"] if tu else []) + (["-to", f"{den:.3f}"] if den is not None else [])
    loc = (f"[0:v]split=2[a][b];[a]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=24:2[nen];"
           f"[b]scale={w}:{h}:force_original_aspect_ratio=decrease,setsar=1[hinh];"
           f"[nen][hinh]overlay=(W-w)/2:(H-h)/2,fps=30,format=yuv420p[v]")
    vao_tieng = [] if co_tieng else ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
    _chay([*cat, "-i", vao, *vao_tieng, "-filter_complex", loc, "-map", "[v]", "-map", "0:a:0" if co_tieng else "1:a",
           "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k",
           "-ar", "44100", "-ac", "2", "-movflags", "+faststart", ra], cwd)


def noi(cac_tep: List[str], ra: str, cwd: str) -> None:
    """Nối các đoạn đã chuẩn hoá (cùng thông số) bằng concat demuxer, không mã hoá lại."""
    ds = Path(cwd, "noi.txt")
    ds.write_text("".join(f"file '{t}'\n" for t in cac_tep), encoding="utf-8")
    _chay(["-f", "concat", "-safe", "0", "-i", "noi.txt", "-c", "copy", "-movflags", "+faststart", ra], cwd)


def _ass_thoi_gian(giay: float) -> str:
    giay = max(0.0, giay)
    return f"{int(giay // 3600)}:{int(giay % 3600 // 60):02d}:{giay % 60:05.2f}"


def phu_de_ass(cues: List[Dict[str, Any]], kho: Tuple[int, int]) -> str:
    """Phụ đề ASS: Phudu ExtraBold vàng viền đen, căn giữa dưới, mỗi lúc một câu."""
    w, h = kho
    co = 58 if h > w else 52
    dong = [f"Dialogue: 0,{_ass_thoi_gian(c['tu'])},{_ass_thoi_gian(c['den'])},PD,,0,0,0,,"
            + str(c["chu"]).replace("\\", "⧵").replace("{", "(").replace("}", ")").replace("\n", "\\N") for c in cues]
    return ("[Script Info]\nScriptType: v4.00+\nWrapStyle: 0\n"
            f"PlayResX: {w}\nPlayResY: {h}\n\n[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
            "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
            "MarginR, MarginV, Encoding\n"
            f"Style: PD,{FONT_PHU_DE},{co},&H0000D7FF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,"
            f"40,40,{int(h * 0.12)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, "
            "Effect, Text\n" + "\n".join(dong) + "\n")


def sua(cac_tep: List[str], cac_giay: List[float], ra: str, cwd: str, kho: Tuple[int, int], *,
        chuyen: Optional[str] = None, logo: Optional[str] = None, vi_tri_logo: str = "tren-phai",
        nhac: Optional[str] = None, am_luong_nhac: int = 25, tat_tieng_goc: bool = False,
        cues: Optional[List[Dict[str, Any]]] = None) -> float:
    """Ghép kèm chuyển cảnh, logo, nhạc nền, phụ đề trong MỘT lần mã hoá. Trả tổng thời lượng (giây)."""
    n = len(cac_tep)
    vao: List[str] = []
    for t in cac_tep:
        vao += ["-i", t]
    loc: List[str] = []
    d = CHUYEN_DAI if chuyen and n > 1 else 0.0
    if d:
        xf = CHUYEN_CANH[chuyen]
        vtr, atr, mo = "[0:v]", "[0:a]", cac_giay[0]
        for k in range(1, n):
            mo_k = mo - d
            loc.append(f"{vtr}[{k}:v]xfade=transition={xf}:duration={d}:offset={mo_k:.3f}[v{k}]")
            loc.append(f"{atr}[{k}:a]acrossfade=d={d}[a{k}]")
            vtr, atr = f"[v{k}]", f"[a{k}]"
            mo = mo_k + cac_giay[k]
        tong = mo
    else:
        loc.append("".join(f"[{k}:v][{k}:a]" for k in range(n)) + f"concat=n={n}:v=1:a=1[vn][an]")
        vtr, atr, tong = "[vn]", "[an]", sum(cac_giay)
    so_vao = n
    if logo:
        vao += ["-i", logo]
        lw = int(kho[0] * 0.16)
        loc.append(f"[{so_vao}:v]scale={lw}:-1[lg]")
        loc.append(f"{vtr}[lg]overlay={VI_TRI_LOGO.get(vi_tri_logo, VI_TRI_LOGO['tren-phai'])}[vl]")
        vtr, so_vao = "[vl]", so_vao + 1
    if cues:
        Path(cwd, "phu-de.ass").write_text(phu_de_ass(cues, kho), encoding="utf-8")
        loc.append(f"{vtr}subtitles=phu-de.ass:fontsdir=fonts[vs]")
        vtr = "[vs]"
        fonts = Path(cwd, "fonts")
        fonts.mkdir(exist_ok=True)
        for f in FONT_DIR.glob("*.ttf"):
            shutil.copy2(f, fonts / f.name)
    if nhac:
        vao += ["-stream_loop", "-1", "-i", nhac]
        vol = max(0, min(100, int(am_luong_nhac))) / 100
        loc.append(f"[{so_vao}:a]atrim=0:{tong:.3f},asetpts=PTS-STARTPTS,volume={vol:.2f},"
                   f"afade=t=out:st={max(0.0, tong - 2):.3f}:d=2,aformat=sample_rates=44100:channel_layouts=stereo[nh]")
        if tat_tieng_goc:
            loc.append(f"{atr}anullsink")          # tiếng gốc bỏ đi (nhánh lọc không được để lửng)
            atr = "[nh]"
        else:
            loc.append(f"{atr}[nh]amix=inputs=2:duration=first:normalize=0[am]")
            atr = "[am]"
    elif tat_tieng_goc:
        loc.append(f"{atr}volume=0[im]")          # không nhạc: giữ rãnh tiếng nhưng im lặng
        atr = "[im]"
    _chay([*vao, "-filter_complex", ";".join(loc), "-map", vtr, "-map", atr, "-t", f"{tong:.3f}",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
           "-movflags", "+faststart", ra], cwd)
    return tong


def kiem_ra(path: str) -> None:
    if not Path(path).is_file() or Path(path).stat().st_size == 0:
        raise MediaError("không tạo được video kết quả")
    if Path(path).stat().st_size > MAX_MB * 1024 * 1024:
        raise MediaError(f"video kết quả nặng quá {MAX_MB} MB, không gửi qua Zalo được — chọn đoạn ngắn hơn")


def cues_hop_le(raw: Any, tong: Optional[float] = None) -> List[Dict[str, Any]]:
    """Phụ đề [{tu, den, chu}] (mốc theo video KẾT QUẢ, giây hoặc m:ss) → đã kiểm, sắp theo thời gian."""
    from .media import doc_moc

    if not raw:
        return []
    if not isinstance(raw, list) or len(raw) > 300:
        raise MediaError("`phu_de` là danh sách tối đa 300 câu {tu, den, chu}")
    ra = []
    for k, c in enumerate(raw, 1):
        if not isinstance(c, dict):
            raise MediaError(f"câu phụ đề {k} phải có dạng {{tu, den, chu}}")
        tu, den, chu = doc_moc(c.get("tu")), doc_moc(c.get("den")), str(c.get("chu") or "").strip()
        if tu is None or den is None or den <= tu or not chu:
            raise MediaError(f"câu phụ đề {k} cần `tu` < `den` và có chữ")
        if len(chu) > 90:
            raise MediaError(f"câu phụ đề {k} dài {len(chu)} ký tự, tối đa 90 — tách thành hai câu")
        ra.append({"tu": tu, "den": den if tong is None else min(den, tong), "chu": chu})
    return sorted(ra, key=lambda c: c["tu"])


def thu_muc_tam() -> str:
    from .media import new_download_dir
    return new_download_dir()


def don(workdir: Optional[str]) -> None:
    if workdir and os.path.isdir(workdir):
        shutil.rmtree(workdir, ignore_errors=True)
