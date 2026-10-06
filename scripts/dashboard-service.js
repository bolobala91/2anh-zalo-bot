import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { freeListenerPort } from '../dashboard/lib/restart.js';

const SERVICE = 'zalo-dashboard';
const UNIT_FILE = `${SERVICE}.service`;
const VBS_FILE = `${SERVICE}.vbs`;
const DEFAULT_UNIT_DIR = '/etc/systemd/system';

const posix = (p) => String(p).replaceAll('\\', '/').replace(/\/+$/, '');
const windows = (p) => String(p).replaceAll('/', '\\').replace(/\\+$/, '');

const defaultRunner = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
const defaultWriteFile = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
};
const defaultProbe = async (port) => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch { return false; }
};
const defaultRemoveFile = (path) => rmSync(path, { force: true });
const defaultIsRoot = () => typeof process.getuid === 'function' && process.getuid() === 0;
const defaultHasSystemd = () => existsSync('/run/systemd/system');

function defaultStartupDir() {
  const appData = process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

export function renderSystemdUnit({ sidecarRoot, nodePath }) {
  const root = posix(sidecarRoot);
  return `[Unit]
Description=Zalo dashboard quản trị
After=network-online.target zalo-bridge.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${root}
ExecStart="${posix(nodePath)}" "${root}/dashboard/server.js"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

/** Tệp .vbs chạy ngầm (cửa sổ ẩn). Tuyệt đối không có MsgBox/Popup. */
export function renderWindowsStartup({ sidecarRoot, nodePath }) {
  const root = windows(sidecarRoot);
  const command = `"${windows(nodePath)}" "${root}\\dashboard\\server.js"`;
  return `Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "${root}"
sh.Run "${command.replaceAll('"', '""')}", 0, False
`;
}

function manualHelp() {
  return 'Chưa cài được dịch vụ tự chạy. Chạy tay bằng: npm run dashboard (hoặc nhờ người cài đặt chạy lại bước này bằng quyền root trên máy có systemd).';
}

export async function installDashboardService({
  sidecarRoot,
  platform = process.platform,
  nodePath = process.execPath,
  runner = defaultRunner,
  writeFile = defaultWriteFile,
  startupDir = defaultStartupDir(),
  unitDir = DEFAULT_UNIT_DIR,
  isRoot = defaultIsRoot(),
  hasSystemd = platform === 'win32' ? false : defaultHasSystemd(),
  port = 3880,
  probe = defaultProbe,
  freePort = (p) => freeListenerPort({ port: p }),
} = {}) {
  try {
    if (platform === 'win32') {
      const path = join(startupDir, VBS_FILE);
      writeFile(path, renderWindowsStartup({ sidecarRoot, nodePath }));
      // Nâng cấp: bản cũ còn đang chạy thì dừng đúng tiến trình giữ cổng để bản mới thế chỗ.
      if (await probe(port)) await freePort(port);
      // wscript (không phải cscript) + windowsHide: không bật cửa sổ nào lúc cài.
      const run = runner('wscript', [path]);
      if (run?.error || (run?.status ?? 0) !== 0) {
        return { installed: false, detail: `Đã ghi ${path} nhưng chưa chạy được ngay; dashboard sẽ tự chạy ở lần đăng nhập Windows tới, hoặc chạy tay: npm run dashboard` };
      }
      return { installed: true, detail: `chạy ngầm, tự khởi động cùng Windows (${path})` };
    }

    if (!isRoot || !hasSystemd) {
      return { installed: false, detail: `${manualHelp()} Lý do: ${!isRoot ? 'không chạy bằng root' : 'máy không có systemd'}.` };
    }
    const unitPath = `${posix(unitDir)}/${UNIT_FILE}`;
    writeFile(unitPath, renderSystemdUnit({ sidecarRoot, nodePath }));
    for (const args of [['daemon-reload'], ['enable', SERVICE], ['restart', SERVICE]]) {
      const run = runner('systemctl', args);
      if (run?.error || (run?.status ?? 0) !== 0) {
        return { installed: false, detail: `systemctl ${args.join(' ')} thất bại: ${String(run?.stderr || run?.error?.message || `exit ${run?.status}`).trim()}` };
      }
    }
    return { installed: true, detail: `dịch vụ systemd ${SERVICE} đang chạy (${unitPath})` };
  } catch (error) {
    return { installed: false, detail: `${manualHelp()} Lỗi: ${error?.message || error}` };
  }
}

export function uninstallDashboardService({
  platform = process.platform,
  runner = defaultRunner,
  removeFile = defaultRemoveFile,
  exists = existsSync,
  startupDir = defaultStartupDir(),
  unitDir = DEFAULT_UNIT_DIR,
  isRoot = defaultIsRoot(),
  hasSystemd = platform === 'win32' ? false : defaultHasSystemd(),
} = {}) {
  const removed = [];
  try {
    if (platform === 'win32') {
      const path = join(startupDir, VBS_FILE);
      if (exists(path)) { removeFile(path); removed.push(path); }
      return { removed, detail: 'Dashboard đang chạy (nếu có) sẽ dừng khi khởi động lại máy.' };
    }
    const unitPath = `${posix(unitDir)}/${UNIT_FILE}`;
    if (!exists(unitPath)) return { removed, detail: '' };
    if (!isRoot || !hasSystemd) {
      return { removed, detail: `Cần root để gỡ ${unitPath}: chạy systemctl disable --now ${SERVICE} rồi xoá tệp đó.` };
    }
    runner('systemctl', ['disable', '--now', SERVICE]);
    removeFile(unitPath);
    removed.push(unitPath);
    runner('systemctl', ['daemon-reload']);
    return { removed, detail: '' };
  } catch (error) {
    return { removed, detail: `Không gỡ hết được dịch vụ dashboard: ${error?.message || error}` };
  }
}

/** Khối Caddy cho tên miền https; địa chỉ http (chạy cục bộ) thì không cần. */
export function caddySnippet(publicUrl, port = 3880) {
  let url;
  try { url = new URL(String(publicUrl || '')); } catch { return ''; }
  if (url.protocol !== 'https:') return '';
  return `${url.hostname} {\n    reverse_proxy 127.0.0.1:${port}\n}\n`;
}
