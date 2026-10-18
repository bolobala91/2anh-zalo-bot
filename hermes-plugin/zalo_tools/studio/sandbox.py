"""Chạy một bộ dựng cố định trong tiến trình con, càng ít quyền càng tốt.

Linux (máy chủ VPS, gateway chạy bằng root): bọc lệnh bằng ``systemd-run`` — đơn vị tạm
``zalo-studio-<mã việc>`` chạy bằng ``nobody``, ``/`` chỉ đọc, ``/root`` và ``/home`` thay bằng
thư mục rỗng; chỗ cài thường gặp (``/opt``, ``/srv``, ``/mnt``, ``/media``), ``HERMES_HOME`` (``.env``,
``state.db``, dữ liệu dashboard), thư mục sidecar (``ZALO_SIDECAR_DIR``) và thư mục chứa các việc khác
cũng phủ tmpfs rỗng; chỉ ghi được thư mục việc của chính nó; không thấy tiến trình khác
(``ProtectProc=invisible``); chỉ socket IPv4/IPv6/Unix; không tạo namespace; không mạng (trừ bước cần
mạng: có mạng nhưng chặn 127.0.0.1, mạng nội bộ, fc00::/7, fe80::/10 và địa chỉ của chính máy chủ để
không gọi được 9router, dashboard, kết nối Zalo); giới hạn RAM/CPU/số tiến trình/thời gian. Thứ bộ dựng
cần đọc mà nằm dưới các thư mục bị che (2Anh Studio, Python của uv, Chromium của Playwright, skill
soạn văn bản) được gắn lại chỉ đọc từng thư mục một, và ``.env`` trong đó bị che riêng.

Bước cần mạng là bước đọc giọng (edge-tts). Bước chụp slide của video bài giảng bật máy chủ xem trước
trên 127.0.0.1 rồi Chromium đọc nó: bước đó chạy KHÔNG mạng (``PrivateNetwork=yes``) nên cả máy chủ xem
trước lẫn Chromium nằm trong cùng đơn vị, dùng loopback riêng của đơn vị — không đụng loopback của máy.

Hết giờ hoặc bị huỷ: ``systemctl stop`` đơn vị (giết client ``systemd-run`` thôi thì đơn vị vẫn chạy),
rồi giết client.

Tiến trình cha (root) chỉ đọc/ghi thư mục việc qua ``contained``/``write_file``/``read_file``: không đi
theo liên kết tượng trưng, không ra ngoài thư mục việc. Trước mỗi bước, ``prepare_job_dir`` quét thư mục
việc: có liên kết tượng trưng, tệp đặc biệt hay tệp nhiều liên kết cứng → gỡ và dừng việc (``UnsafeJobDir``).

Windows và Linux không dùng được systemd (không root, không có systemd-run, ``ZALO_STUDIO_SANDBOX=none``):
không có hộp cát của hệ điều hành → video tắt (xem ``group_permissions.video_policy``). Lớp bảo vệ còn lại:
dòng lệnh cố định, môi trường đã lọc khoá, thư mục việc riêng, hạn giờ + giết cả cây tiến trình (nhóm
tiến trình riêng trên POSIX), và (quan trọng nhất) nội dung đã qua ``validate.py``. Xem spec §17.6.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Callable, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

# Biến môi trường được chuyển cho bộ dựng; mọi biến khác (khoá API, token, mật khẩu) bị bỏ.
BASE_ENV_KEYS = ("PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ",
                 "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE")
# Video cần tìm Chromium (Playwright) và giọng VieNeu.
NETWORK_ENV_KEYS = ("LOCALAPPDATA", "PLAYWRIGHT_BROWSERS_PATH", "VIENEU_PYTHON")
MEMORY_MAX = "1536M"
CPU_QUOTA = "200%"
TASKS_MAX = "256"
OUTPUT_TAIL = 20_000
MAX_READ_BYTES = 64 * 1024 * 1024
SYSTEMCTL = "systemctl"
# /root và /home: ProtectHome=tmpfs. Các thư mục dưới đây: TemporaryFileSystem (rỗng, chỉ đọc) nếu có trên máy.
HOME_ROOTS = ("/root", "/home")
HIDDEN_ROOTS = ("/opt", "/srv", "/mnt", "/media")
# Bước có mạng: chặn máy mình, mạng nội bộ (IPv4 + IPv6), đa hướng. Địa chỉ của chính máy chủ thêm lúc chạy.
# Chỉ dùng dải số: ``systemd-run -p IPAddressDeny=`` (systemd 255) không hiểu từ khoá localhost/link-local/multicast.
DENIED_NETWORKS = ("127.0.0.0/8", "::1/128", "169.254.0.0/16", "224.0.0.0/4", "ff00::/8",
                   "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10",
                   "172.16.0.0/12", "192.168.0.0/16", "198.18.0.0/15", "fc00::/7", "fe80::/10", "fec0::/10")


# Bộ phân giải DNS cục bộ của Ubuntu (systemd-resolved). ``localhost`` nằm trong DENIED_NETWORKS nên phải cho phép riêng.
STUB_RESOLVER = "127.0.0.53/32"
# Địa chỉ mà /etc/resolv.conf có thể ghi nhưng KHÔNG BAO GIỜ được mở: IMDS của đám mây (lộ khoá).
NEVER_ALLOW = ("169.254.169.254", "fd00:ec2::254")
_DENIED_NETS = tuple(ipaddress.ip_network(n) for n in (
    "127.0.0.0/8", "::1/128", "169.254.0.0/16", "fe80::/10", "224.0.0.0/4", "ff00::/8", "0.0.0.0/8", "10.0.0.0/8",
    "100.64.0.0/10", "172.16.0.0/12", "192.168.0.0/16", "198.18.0.0/15", "fc00::/7", "fec0::/10"))


class UnsafeJobDir(RuntimeError):
    """Thư mục việc có liên kết tượng trưng/tệp lạ, hoặc đường dẫn trỏ ra ngoài thư mục việc."""


class SandboxConfigError(ValueError):
    """Đường dẫn cấu hình không đưa được vào thuộc tính systemd (khoảng trắng, dấu nháy, ``:``, ``%``…)."""


@dataclass(frozen=True)
class Result:
    code: Optional[int]
    out: str
    err: str
    timed_out: bool


def mode() -> str:
    """``systemd`` khi dùng được hộp cát systemd, ngược lại ``plain``. ``ZALO_STUDIO_SANDBOX=none`` để tắt hẳn."""
    wanted = os.getenv("ZALO_STUDIO_SANDBOX", "auto").strip().lower()
    if wanted in ("none", "off", "plain"):
        return "plain"
    usable = (sys.platform.startswith("linux") and hasattr(os, "geteuid") and os.geteuid() == 0
              and shutil.which("systemd-run") is not None)
    if wanted == "systemd" and not usable:
        logger.warning("[zalo] ZALO_STUDIO_SANDBOX=systemd nhưng máy không dùng được systemd-run — chạy không hộp cát")
    return "systemd" if usable else "plain"


def work_root() -> Path:
    """Thư mục chứa các thư mục việc. Linux: /var/lib/zalo-studio (PrivateTmp che mất /tmp và /var/tmp)."""
    explicit = os.getenv("ZALO_STUDIO_WORK", "").strip()
    if explicit:
        return Path(explicit)
    if sys.platform.startswith("linux"):
        return Path("/var/lib/zalo-studio")
    import tempfile
    return Path(tempfile.gettempdir()) / "zalo-studio"


def clean_env(job_dir: Path, *, network: bool, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    keys = BASE_ENV_KEYS + (NETWORK_ENV_KEYS if network else ())
    env = {k: os.environ[k] for k in keys if os.environ.get(k)}
    tmp = str(job_dir / "tmp")
    env.update({"TEMP": tmp, "TMP": tmp, "TMPDIR": tmp, "HOME": str(job_dir), "USERPROFILE": str(job_dir),
                "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1",
                "NO_COLOR": "1"})
    if network:
        # HOME bị đổi sang thư mục việc → VieNeu (huggingface_hub) tưởng chưa có model và tải lại ~600 MB mỗi việc.
        # Trỏ về kho model thật của tài khoản chạy bot.
        env["HF_HOME"] = os.environ.get("HF_HOME") or os.path.join(os.path.expanduser("~"), ".cache", "huggingface")
    env.update(extra or {})
    return env


def browsers_dir() -> Optional[Path]:
    """Chromium của Playwright (video): PLAYWRIGHT_BROWSERS_PATH, hoặc chỗ mặc định của từng hệ điều hành."""
    explicit = os.getenv("PLAYWRIGHT_BROWSERS_PATH", "").strip()
    if explicit:
        path = Path(explicit)
    elif os.name == "nt":
        path = Path(os.getenv("LOCALAPPDATA", "")) / "ms-playwright"
    else:
        path = Path.home() / ".cache" / "ms-playwright"
    return path if path.is_dir() else None


def read_only_paths(python: Optional[str], *others: Optional[Path]) -> List[Path]:
    """Thư mục bộ dựng cần đọc: kho Python mà venv trỏ tới (uv đặt dưới /root), cộng ``others``
    và ``ZALO_STUDIO_BIND`` (danh sách cách nhau bằng dấu phẩy, cho cách cài lạ)."""
    out: List[Path] = []
    if python:
        real = Path(os.path.realpath(python))
        out.append(real.parents[2] if len(real.parents) > 2 else real.parent)
    out += [p for p in others if p]
    out += [Path(p.strip()) for p in os.getenv("ZALO_STUDIO_BIND", "").split(",") if p.strip()]
    return out


def _hermes_home() -> Optional[str]:
    try:
        from hermes_constants import get_hermes_home
        return str(get_hermes_home())
    except Exception:
        return os.getenv("HERMES_HOME", "").strip() or None


def hidden_paths(job_dir: Path) -> List[str]:
    """Thư mục phủ tmpfs rỗng (``TemporaryFileSystem=…:ro``), lấy từ cấu hình và đường dẫn thật trên máy: chỗ cài
    thường gặp, ``HERMES_HOME`` (khoá, state.db, ``zalo/dashboard``), ``ZALO_SIDECAR_DIR`` (.env và data/ của bot),
    thư mục chứa các việc (việc khác), ``ZALO_STUDIO_HIDE``. Chỉ giữ thư mục có thật, chưa nằm dưới /root, /home."""
    candidates = [*HIDDEN_ROOTS, _hermes_home(), os.getenv("ZALO_SIDECAR_DIR", "").strip(), str(job_dir.parent),
                  *(p.strip() for p in os.getenv("ZALO_STUDIO_HIDE", "").split(","))]
    out = []
    for raw in candidates:
        if not raw:
            continue
        real = os.path.realpath(raw)
        if real not in ("/", os.path.realpath(job_dir)) and os.path.isdir(real) and not _under(real, HOME_ROOTS):
            out.append(real)
    return sorted(set(out))


def _under(path: str, roots: Sequence[str]) -> bool:
    p = PurePosixPath(path)
    return any(p == PurePosixPath(r) or PurePosixPath(r) in p.parents for r in roots)


def host_addresses() -> List[str]:
    """Địa chỉ của chính máy chủ (``hostname -I`` + tên máy), dạng ``ip/32``/``ip/128``. Cố hết sức, lỗi thì bỏ qua."""
    found = set()
    try:
        out = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=5).stdout
        found.update(out.split())
    except Exception:
        pass
    try:
        found.update(info[4][0] for info in socket.getaddrinfo(socket.gethostname(), None))
    except Exception:
        pass
    result = set()
    for address in found:
        try:
            ip = ipaddress.ip_address(str(address).split("%", 1)[0])
        except ValueError:
            continue
        if not (ip.is_loopback or ip.is_link_local or ip.is_unspecified):
            result.add(f"{ip}/{ip.max_prefixlen}")
    return sorted(result)


def resolver_addresses(resolv_conf: str = "/etc/resolv.conf",
                       own_addresses: Sequence[str] = ()) -> List[str]:
    """Máy chủ DNS thật của máy (``nameserver`` trong resolv.conf) mà nằm trong dải bị chặn (mạng nội bộ của nhà cung
    cấp…) → ``ip/32``/``ip/128`` để ``IPAddressAllow`` (Allow thắng Deny). Cố hết sức, lỗi thì bỏ qua. Không bao giờ
    mở: loopback khác 127.0.0.53 (9router, dashboard…), địa chỉ của chính máy chủ, IMDS đám mây, địa chỉ lạ."""
    try:
        lines = Path(resolv_conf).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    own = {a.split("/", 1)[0] for a in own_addresses}
    found = set()
    for line in lines:
        parts = line.split()
        if len(parts) < 2 or parts[0] != "nameserver":
            continue
        try:
            ip = ipaddress.ip_address(parts[1].split("%", 1)[0])
        except ValueError:
            continue
        text = str(ip)
        if (text in NEVER_ALLOW or text in own or ip.is_unspecified or ip.is_multicast
                or (ip.is_loopback and f"{ip}/32" != STUB_RESOLVER)):
            continue
        if any(ip in net for net in _DENIED_NETS):
            found.add(f"{ip}/{ip.max_prefixlen}")
    return sorted(found)[:3]


_UNSAFE_UNIT_CHARS = re.compile(r"[\s\"'\\:%;]|[\x00-\x1f\x7f]")


def unit_path(path: str) -> str:
    """Đường dẫn tuyệt đối dùng được trong thuộc tính systemd; khoảng trắng, nháy, ``\\``, ``:``, ``%``, ``;`` → lỗi rõ."""
    text = str(path)
    if not text.startswith("/") or _UNSAFE_UNIT_CHARS.search(text):
        raise SandboxConfigError(
            f"đường dẫn {text!r} không dùng được trong hộp cát systemd (cần đường dẫn tuyệt đối, không khoảng trắng, "
            "nháy, \\ : % ;) — đổi chỗ cài hoặc ZALO_STUDIO_WORK/ZALO_STUDIO_BIND/ZALO_STUDIO_HIDE")
    return text


def unit_name(job_dir: Path) -> str:
    return "zalo-studio-" + (re.sub(r"[^A-Za-z0-9_-]", "-", job_dir.name)[:64] or "job")


def _real(path: Path) -> str:
    """Đường dẫn thật (Linux). Trên máy khác chỉ để test dòng lệnh: giữ nguyên dạng POSIX."""
    return os.path.realpath(path) if os.name != "nt" else Path(path).as_posix()


def systemd_command(argv: Sequence[str], job_dir: Path, env: Dict[str, str], *, network: bool,
                    timeout: int, read_only: Sequence[Path] = (), hidden: Optional[Sequence[str]] = None,
                    own_addresses: Optional[Sequence[str]] = None, resolvers: Optional[Sequence[str]] = None,
                    unit: Optional[str] = None,
                    exists: Callable[[str], bool] = os.path.exists) -> List[str]:
    """Dòng lệnh ``systemd-run`` bọc ``argv``. ``read_only``: thư mục cần đọc (gắn lại nếu nằm dưới chỗ bị che).
    ``hidden``/``own_addresses``/``resolvers``: mặc định lấy từ máy (``hidden_paths``, ``host_addresses``,
    ``resolver_addresses``)."""
    work = unit_path(job_dir.as_posix())
    hidden = list(hidden_paths(job_dir) if hidden is None else hidden)
    props = [
        "User=nobody", "Group=nogroup", "NoNewPrivileges=yes", "PrivateTmp=yes", "PrivateDevices=yes",
        "ProtectSystem=strict", "ProtectHome=tmpfs", "ProtectProc=invisible",
        "ProtectKernelTunables=yes", "ProtectKernelModules=yes", "ProtectKernelLogs=yes", "ProtectControlGroups=yes",
        "RestrictNamespaces=yes", "RestrictSUIDSGID=yes", "LockPersonality=yes",
        "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX", "CapabilityBoundingSet=",
        f"MemoryMax={MEMORY_MAX}", f"CPUQuota={CPU_QUOTA}", f"TasksMax={TASKS_MAX}",
        f"RuntimeMaxSec={max(1, int(timeout))}", f"WorkingDirectory={work}",
    ]
    for path in sorted(set(hidden)):
        props.append(f"TemporaryFileSystem={unit_path(path)}:ro")
    props += [f"BindPaths={work}", f"ReadWritePaths={work}"]
    covered = (*HOME_ROOTS, *hidden)
    binds = sorted({_real(Path(p)) for p in read_only if p and exists(str(p))})
    for bind in binds:
        if _under(bind, covered):
            props.append(f"BindReadOnlyPaths={unit_path(bind)}")
    for bind in binds:
        secret = f"{bind.rstrip('/')}/.env"
        if exists(secret):
            props.append(f"InaccessiblePaths={unit_path(secret)}")
    if network:
        own = list(host_addresses() if own_addresses is None else own_addresses)
        props.append("IPAddressDeny=" + " ".join([*DENIED_NETWORKS, *own]))
        # Bước đọc giọng cần DNS: Allow thắng Deny trong systemd → mở đúng stub 127.0.0.53 và máy chủ DNS thật nằm
        # trong dải bị chặn; mọi thứ khác vẫn chặn.
        dns = list(resolver_addresses(own_addresses=own) if resolvers is None else resolvers)
        props.append("IPAddressAllow=" + " ".join(dict.fromkeys([STUB_RESOLVER, *dns])))
    else:
        props.append("PrivateNetwork=yes")
    cmd = ["systemd-run", "--quiet", "--wait", "--pipe", "--collect", "--service-type=exec"]
    if unit:
        cmd.append(f"--unit={unit}")
    for prop in props:
        cmd += ["-p", prop]
    for key, value in sorted(env.items()):
        cmd += ["-E", f"{key}={str(value).replace('%', '%%')}"]
    return [*cmd, "--", *argv]


# ---------------------------------------------------------------- thư mục việc
def scan_job_dir(job_dir: Path) -> None:
    """Liên kết tượng trưng, tệp đặc biệt (FIFO, socket, thiết bị) hay tệp có nhiều liên kết cứng trong thư mục
    việc → gỡ hết rồi ném ``UnsafeJobDir`` (bộ dựng không bao giờ cần tạo những thứ này)."""
    if os.path.islink(job_dir):
        raise UnsafeJobDir("thư mục việc là liên kết tượng trưng")
    bad = []
    for root, dirs, files in os.walk(job_dir):      # followlinks=False: không đi vào thư mục là liên kết
        for name in (*dirs, *files):
            path = os.path.join(root, name)
            try:
                st = os.lstat(path)
            except OSError:
                continue
            if (stat.S_ISLNK(st.st_mode) or not (stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode))
                    or (stat.S_ISREG(st.st_mode) and st.st_nlink > 1)):
                bad.append(path)
    for path in bad:
        try:
            os.unlink(path)
        except OSError as exc:
            logger.warning("[zalo] xưởng: không gỡ được %s: %s", path, exc)
    if bad:
        raise UnsafeJobDir(f"thư mục việc có {len(bad)} liên kết/tệp lạ — đã gỡ, dừng việc")


def prepare_job_dir(job_dir: Path) -> None:
    """Tạo thư mục việc (và tmp/), quét liên kết/tệp lạ (``UnsafeJobDir``); trên Linux có hộp cát thì trao cho
    ``nobody`` — ``chown`` không đi theo liên kết. Gọi trước MỖI bước."""
    if os.path.islink(job_dir):
        raise UnsafeJobDir("thư mục việc là liên kết tượng trưng")
    job_dir.mkdir(parents=True, exist_ok=True)
    scan_job_dir(job_dir)
    (job_dir / "tmp").mkdir(exist_ok=True)
    if mode() != "systemd":
        return
    import pwd
    import grp
    uid = pwd.getpwnam("nobody").pw_uid
    gid = grp.getgrnam("nogroup").gr_gid
    os.chmod(job_dir.parent, 0o711)
    for root, dirs, files in os.walk(job_dir):
        os.chown(root, uid, gid, follow_symlinks=False)
        for name in files:
            os.chown(os.path.join(root, name), uid, gid, follow_symlinks=False)


def contained(job_dir: Path, path: Path) -> Path:
    """``path`` nằm trong ``job_dir`` (theo chữ và theo đường thật) và không thành phần nào là liên kết tượng trưng."""
    base = Path(os.path.abspath(job_dir))
    target = Path(os.path.abspath(path))
    try:
        rel = target.relative_to(base)
    except ValueError:
        raise UnsafeJobDir("đường dẫn nằm ngoài thư mục việc") from None
    current = base
    for part in (None, *rel.parts):
        if part is not None:
            current = current / part
        if os.path.islink(current):
            raise UnsafeJobDir("đường dẫn đi qua liên kết tượng trưng")
    real_base, real = os.path.realpath(base), os.path.realpath(target)
    if os.path.commonpath([real_base, real]) != real_base:
        raise UnsafeJobDir("đường dẫn nằm ngoài thư mục việc")
    return target


_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)


def write_file(job_dir: Path, path: Path, data: bytes) -> Path:
    """Tiến trình cha ghi một tệp mới vào thư mục việc: kiểm ``contained``, gỡ tệp cũ, mở ``O_EXCL|O_NOFOLLOW``."""
    target = contained(job_dir, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    contained(job_dir, target)
    if os.path.lexists(target):
        if os.path.isdir(target) and not os.path.islink(target):
            raise UnsafeJobDir("chỗ ghi tệp đang là thư mục")
        os.unlink(target)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW, 0o644)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    return target


def read_file(job_dir: Path, path: Path, limit: int = MAX_READ_BYTES) -> bytes:
    """Tiến trình cha đọc một tệp thường trong thư mục việc (không theo liên kết, không FIFO, có trần cỡ)."""
    target = contained(job_dir, path)
    fd = os.open(target, os.O_RDONLY | _NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as fh:
        st = os.fstat(fh.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_nlink > 1:
            raise UnsafeJobDir("không phải tệp thường")
        data = fh.read(limit + 1)
    if len(data) > limit:
        raise UnsafeJobDir("tệp quá lớn")
    return data


# ---------------------------------------------------------------- chạy
def _spawn_kwargs(name: str = os.name) -> Dict[str, object]:
    if name == "nt":
        return {"creationflags": 0x08000000}  # CREATE_NO_WINDOW: không bật cửa sổ đen trên máy chủ nhân
    return {"start_new_session": True}        # nhóm tiến trình riêng → killpg giết cả cây


async def kill_tree(proc, name: str = os.name) -> None:
    """Giết tiến trình cùng cây con (``kill()`` trên Windows chỉ giết cha; POSIX giết cả nhóm tiến trình)."""
    if proc.returncode is not None:
        return
    try:
        if name == "nt":
            killer = await asyncio.create_subprocess_exec(
                "taskkill", "/T", "/F", "/PID", str(proc.pid),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await killer.wait()
        else:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError, AttributeError):
                proc.kill()
        await asyncio.wait_for(proc.wait(), timeout=10)
    except Exception as exc:  # pragma: no cover — dọn dẹp, không được ném đè lỗi gốc
        logger.warning("[zalo] không dừng hẳn được bộ dựng %s: %s", proc.pid, exc)


def stop_all_units(timeout: int = 30) -> None:
    """Gateway khởi động lại: đơn vị ``zalo-studio-*`` của lần chạy trước sống sót (systemd quản). Dừng hết, cố hết sức.
    Dòng lệnh cố định; ``zalo-studio-*`` là MỘT đối số (systemctl tự khớp mẫu, không qua shell)."""
    if mode() != "systemd":
        return
    try:
        subprocess.run([SYSTEMCTL, "stop", "zalo-studio-*"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=timeout, check=False)
    except Exception as exc:
        logger.warning("[zalo] xưởng: không dừng được các đơn vị cũ: %s", exc)


async def stop_unit(unit: str) -> None:
    """``systemctl stop <unit>``: dừng đơn vị tạm (giết client systemd-run thôi thì đơn vị vẫn chạy)."""
    try:
        stopper = await asyncio.create_subprocess_exec(
            SYSTEMCTL, "stop", unit, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        await asyncio.wait_for(stopper.wait(), timeout=60)
    except Exception as exc:  # pragma: no cover — dọn dẹp
        logger.warning("[zalo] không dừng được đơn vị %s: %s", unit, exc)


async def _stop(proc, unit: Optional[str]) -> None:
    if unit:
        await stop_unit(unit)
    await kill_tree(proc)


async def run(argv: Sequence[str], job_dir: Path, *, timeout: int, network: bool = False,
              read_only: Sequence[Path] = (), extra_env: Optional[Dict[str, str]] = None) -> Result:
    """Chạy ``argv`` (danh sách cố định, không qua shell) trong ``job_dir``; không bao giờ ném vì lỗi của bộ dựng.
    (Có thể ném ``SandboxConfigError`` khi cấu hình đường dẫn không dùng được — lỗi của máy, không phải nội dung.)"""
    env = clean_env(job_dir, network=network, extra=extra_env)
    unit = None
    if mode() == "systemd":
        unit = unit_name(job_dir)
        cmd = systemd_command(argv, job_dir, env, network=network, timeout=timeout, read_only=read_only, unit=unit)
        spawn_env = {k: os.environ[k] for k in ("PATH", "LANG") if os.environ.get(k)}
    else:
        cmd, spawn_env = list(argv), env
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=str(job_dir), env=spawn_env, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, **_spawn_kwargs())
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout + 30)
    except asyncio.TimeoutError:
        await _stop(proc, unit)
        return Result(None, "", "", True)
    except BaseException:
        await _stop(proc, unit)
        raise
    return Result(proc.returncode, out.decode("utf-8", "replace")[-OUTPUT_TAIL:],
                  err.decode("utf-8", "replace")[-OUTPUT_TAIL:], False)
