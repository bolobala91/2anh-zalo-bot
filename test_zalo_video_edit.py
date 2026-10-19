"""Test cắt ghép / sửa video (video_edit.py, zalo_video_ghep, zalo_video_edit) bằng FFmpeg thật trên đoạn mẫu tự tạo.

Chạy: npm run test:py. Máy không có ffmpeg/ffprobe thì phần FFmpeg tự bỏ qua."""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import plugins  # noqa: E402

plugins.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.__path__)]
from plugins.zalo_tools import media, tools, video_edit  # noqa: E402

CO_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
MEMBER = {"sender_uid": "u1", "thread_id": "g1", "is_group": True, "is_owner": False}


def tao_mau(thu_muc: Path, ten: str, w: int, h: int, giay: float, tieng: bool) -> str:
    out = thu_muc / ten
    args = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc2=size={w}x{h}:rate=25:duration={giay}"]
    if tieng:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={giay}", "-shortest"]
    subprocess.run(args + ["-c:v", "libx264", "-preset", "ultrafast", str(out)], check=True)
    return str(out)


@unittest.skipUnless(CO_FFMPEG, "cần ffmpeg và ffprobe")
class VideoEditFfmpegTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        cls.ngang = tao_mau(d, "ngang.mp4", 640, 360, 3, True)
        cls.doc = tao_mau(d, "doc.mp4", 360, 640, 2, False)
        logo = d / "logo.png"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=red:size=120x60",
                        "-frames:v", "1", str(logo)], check=True)
        cls.logo = str(logo)
        nhac = d / "nhac.mp3"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=1.5",
                        str(nhac)], check=True)
        cls.nhac = str(nhac)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def lam(self, cac_nguon, **sua):
        wd = tempfile.mkdtemp(dir=self.tmp.name)
        cac_do = [video_edit.do(p) for p, _a, _b in cac_nguon]
        kho = video_edit.kho_chung(cac_do)
        tep, giay = [], []
        for k, ((p, a, b), do_) in enumerate(zip(cac_nguon, cac_do)):
            video_edit.chuan_hoa(p, f"d{k}.mp4", kho, do_["co_tieng"], wd, a, b)
            tep.append(f"d{k}.mp4")
            giay.append(video_edit.do(str(Path(wd, f"d{k}.mp4")))["giay"])
        if sua:
            video_edit.sua(tep, giay, "ra.mp4", wd, kho, **sua)
        else:
            video_edit.noi(tep, "ra.mp4", wd)
        return video_edit.do(str(Path(wd, "ra.mp4"))), kho

    def test_do(self):
        d = video_edit.do(self.doc)
        self.assertEqual((d["rong"], d["cao"], d["co_tieng"]), (360, 640, False))
        self.assertAlmostEqual(d["giay"], 2, delta=0.1)

    def test_ghep_cat_va_dua_ve_cung_kho(self):
        ra, kho = self.lam([(self.ngang, 1.0, 2.5), (self.doc, None, None)])
        self.assertEqual(kho, (1280, 720))              # 1 ngang 1 dọc → ngang
        self.assertEqual((ra["rong"], ra["cao"]), kho)
        self.assertTrue(ra["co_tieng"])                 # đoạn không tiếng được thêm im lặng
        self.assertAlmostEqual(ra["giay"], 1.5 + 2, delta=0.25)

    def test_sua_chuyen_canh_logo_nhac_phu_de(self):
        ra, _ = self.lam([(self.ngang, None, None), (self.doc, None, None)], chuyen="mo", logo=self.logo,
                         nhac=self.nhac, am_luong_nhac=30,
                         cues=video_edit.cues_hop_le([{"tu": "0", "den": "1.5", "chu": "Xin chào các bạn"},
                                                      {"tu": "1.5", "den": "4", "chu": "Phụ đề thử"}]))
        self.assertAlmostEqual(ra["giay"], 3 + 2 - video_edit.CHUYEN_DAI, delta=0.25)
        self.assertTrue(ra["co_tieng"])

    def test_tat_tieng_goc_khong_nhac(self):
        ra, _ = self.lam([(self.ngang, None, None)], tat_tieng_goc=True)
        self.assertTrue(ra["co_tieng"])

    def test_tat_tieng_goc_thay_bang_nhac(self):
        ra, _ = self.lam([(self.ngang, None, None), (self.ngang, 0, 1)], tat_tieng_goc=True, nhac=self.nhac,
                         chuyen="truot", logo=self.logo, vi_tri_logo="duoi-trai")
        self.assertTrue(ra["co_tieng"])
        self.assertAlmostEqual(ra["giay"], 3 + 1 - video_edit.CHUYEN_DAI, delta=0.25)


class VideoEditKiemTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.files = []
        for ten, mime in (("a.mp4", "video/mp4"), ("b.png", "image/png"), ("c.mp4", "video/mp4"), ("d.mp3", "audio/mpeg")):
            p = Path(self.tmp.name, ten)
            p.write_bytes(b"0")
            self.files.append({"name": ten, "path": str(p), "mime": mime})

    def test_chon_tep_theo_loai_va_thu_tu(self):
        self.assertTrue(video_edit.chon_tep(self.files, "video", 2).endswith("c.mp4"))
        self.assertTrue(video_edit.chon_tep(self.files, "image", 1).endswith("b.png"))
        self.assertTrue(video_edit.chon_tep(self.files, "audio", 1).endswith("d.mp3"))
        for loai, so in (("video", 3), ("image", 0)):
            with self.subTest(loai=loai, so=so), self.assertRaises(media.MediaError):
                video_edit.chon_tep(self.files, loai, so)
        with self.assertRaises(media.MediaError):
            video_edit.chon_tep([], "video", 1)

    def test_kho_chung_theo_da_so(self):
        doc, ngang = {"rong": 1, "cao": 2}, {"rong": 2, "cao": 1}
        self.assertEqual(video_edit.kho_chung([doc, doc, ngang]), (720, 1280))
        self.assertEqual(video_edit.kho_chung([doc, ngang]), (1280, 720))

    def test_phu_de(self):
        cues = video_edit.cues_hop_le([{"tu": "0:02", "den": "0:04", "chu": "B"}, {"tu": "0", "den": "2", "chu": "A"}])
        self.assertEqual([c["chu"] for c in cues], ["A", "B"])
        ass = video_edit.phu_de_ass(cues, (720, 1280))
        self.assertIn("Phudu ExtraBold", ass)
        self.assertIn("&H0000D7FF", ass)                 # vàng
        for bad in ([{"tu": "3", "den": "2", "chu": "x"}], [{"tu": "0", "den": "1", "chu": ""}],
                    [{"tu": "0", "den": "1", "chu": "x" * 91}], "abc"):
            with self.subTest(bad=str(bad)[:30]), self.assertRaises(media.MediaError):
                video_edit.cues_hop_le(bad)

    def test_font_phu_de_di_kem_plugin(self):
        self.assertTrue((video_edit.FONT_DIR / "Phudu-ExtraBold.ttf").is_file())
        self.assertTrue((video_edit.FONT_DIR / "OFL-Phudu.txt").is_file())


def run(coro):
    return asyncio.run(coro)


class VideoEditToolTest(unittest.TestCase):
    def setUp(self):
        tools._VIDEO_QUOTA.clear()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = Path(self.tmp.name, "v.mp4")
        p.write_bytes(b"0")
        self.att = [{"name": "v.mp4", "path": str(p), "mime": "video/mp4"}]
        self.started = []

    def goi(self, fn, args, text="ghép 2 video này giúp chị", **turn):
        t = {**MEMBER, "text": text, "attachments": self.att, **turn}

        class FakeThread:
            def __init__(s, target, args, daemon, name):
                self.started.append(args)

            def start(s):
                tools.VIDEO_EDIT_LOCK.release()      # không chạy thật; trả khoá như luồng nền làm xong

        async def wait(turn, text):
            self.waits = text

        with mock.patch.object(tools, "_turn", return_value=t), \
                mock.patch.object(tools, "_scoped_thread", return_value=("g1", "group", None)), \
                mock.patch.object(tools, "_send_wait", wait), \
                mock.patch.object(tools.threading, "Thread", FakeThread):
            return json.loads(run(fn(args)))

    def test_ghep_nhan_viec_va_nhan_cho(self):
        out = self.goi(tools.zalo_video_ghep, {"doan": [{"url": "https://youtu.be/abc", "start": "0", "end": "1:20"},
                                                        {"tep": 1}]})
        self.assertEqual(out.get("result", out).get("status"), "queued", out)
        doan, opts = self.started[0][1], self.started[0][2]
        self.assertEqual(doan[0], {"url": "https://youtu.be/abc", "tu": 0.0, "den": 80.0})
        self.assertTrue(doan[1]["path"].endswith("v.mp4"))
        self.assertEqual(opts, {})
        self.assertIn("đang ghép video (2 đoạn)", self.waits)

    def test_sai_dau_vao_bao_ngay(self):
        for args in ({"doan": []}, {"doan": [{"tep": 3}]}, {"doan": [{"url": "https://evil.example/x.mp4"}]},
                     {"doan": [{"url": "https://youtu.be/a", "tep": 1}]}, {"doan": [{"tep": 1}] * 6},
                     {"doan": [{"tep": 1, "start": "10", "end": "5"}]}):
            with self.subTest(args=str(args)[:60]):
                self.assertIn("error", self.goi(tools.zalo_video_ghep, args))
        self.assertEqual(self.started, [])

    def test_thanh_vien_chua_nho_thi_khong_lam(self):
        self.assertIn("error", self.goi(tools.zalo_video_ghep, {"doan": [{"tep": 1}]}, text="video hay ghê"))

    def test_edit_can_it_nhat_mot_hieu_ung(self):
        self.assertIn("zalo_video_ghep", self.goi(tools.zalo_video_edit, {"doan": [{"tep": 1}]})["error"])
        out = self.goi(tools.zalo_video_edit, {"doan": [{"tep": 1}], "chuyen_canh": "mo",
                                               "phu_de": [{"tu": "0", "den": "2", "chu": "Chào"}]},
                       text="chèn sub cho video này")
        self.assertNotIn("error", out)
        self.assertEqual(self.started[-1][2]["chuyen"], "mo")
        self.assertIn("đang sửa video", self.waits)
        self.assertIn("error", self.goi(tools.zalo_video_edit, {"doan": [{"tep": 1}], "chuyen_canh": "lac"}))
        self.assertIn("error", self.goi(tools.zalo_video_edit, {"doan": [{"tep": 1}], "logo_tep": 1}))  # chưa gửi ảnh

    def test_y_dinh(self):
        for text in ("ghép 3 video này lại", "nối 2 clip giúp chị", "chèn sub cho video", "chèn nhạc nền vào video",
                     "cắt video từ 1:00 đến 2:00", "gộp video"):
            self.assertTrue(tools._wants_video_edit(text), text)
        for text in ("video hay quá", "hôm nay trời đẹp"):
            self.assertFalse(tools._wants_video_edit(text), text)


if __name__ == "__main__":
    unittest.main()
