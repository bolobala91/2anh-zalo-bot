/**
 * Trạng thái các dịch vụ của bot cho trang Sức khoẻ máy chủ (spec §16.B). Chỉ ĐỌC, không bật/tắt gì.
 * Linux: một lệnh `systemctl list-units` (windowsHide, timeout 5 s) cho zalo-*, hermes-*, caddy, 9router.
 * Windows (hoặc máy không có systemd): không chạy lệnh nào — dò cổng TCP 127.0.0.1, đọc gateway.pid của
 * Hermes và hỏi hệ điều hành tiến trình còn sống không (`process.kill(pid, 0)`), cùng các dịch vụ cục bộ
 * mà config.yaml của Hermes trỏ tới (vd. 9router ở :20128).
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

export const UNIT_LABELS = {
  'zalo-bridge': 'Kết nối Zalo',
  'zalo-dashboard': 'Dashboard quản trị',
  'hermes-gateway': 'Trợ lý (Hermes)',
  caddy: 'Máy chủ web (HTTPS)',
  '9router': 'Cổng AI (9router)',
  'hermes-dashboard': 'Trang quản trị Hermes',
  'hermes-openviking': 'Bộ nhớ dài hạn',
  'hermes-rag': 'Tra cứu tài liệu',
  'hermes-mgmt': 'Dịch vụ quản lý máy chủ',
};
// Chủ bot (không phải Quản trị) chỉ thấy tên thân thiện của các dịch vụ chính; còn lại là "Dịch vụ khác".
const OWNER_LABELS = {
  'zalo-bridge': 'Kết nối Zalo', 'zalo-dashboard': 'Dashboard quản trị', 'hermes-gateway': 'Trợ lý (Hermes)',
  '9router': 'Cổng AI', 'port-20128': 'Cổng AI', caddy: 'Máy chủ web',
};
/** Bản cho Chủ bot: id `svc-<số thứ tự>`, nhãn thân thiện hoặc "Dịch vụ khác" — không lộ tên unit systemd, cổng, mô tả. */
export const ownerView = (list) => list.map((s, i) => ({ id: `svc-${i}`, label: OWNER_LABELS[s.id] || 'Dịch vụ khác', state: s.state }));
const CORE = ['zalo-bridge', 'zalo-dashboard', 'hermes-gateway'];
const PORT_LABELS = { 20128: 'Cổng AI (9router)', 1933: 'Bộ nhớ dài hạn' };
const ORDER = (id) => { const i = Object.keys(UNIT_LABELS).indexOf(id); return i < 0 ? 99 : i; };

const defaultExec = (file, args, opts) => new Promise((resolve, reject) => {
  execFile(file, args, opts, (err, stdout) => (err ? reject(err) : resolve({ stdout: String(stdout) })));
});

/** Phân tích đầu ra `systemctl list-units --plain --no-legend`: unit load active sub mô tả… */
export function parseSystemctl(stdout) {
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const cols = line.trim().replace(/^[●*]\s*/, '').split(/\s+/);
    if (cols.length < 4 || !cols[0].endsWith('.service')) continue;
    const [unit, load, active, sub] = cols;
    const id = unit.slice(0, -'.service'.length);
    let state = 'down';
    if (active === 'active') state = 'up';
    else if (active === 'activating' || active === 'reloading') state = 'starting';
    if (load !== 'loaded') state = 'missing';
    out.push({ id, label: UNIT_LABELS[id] || cols.slice(4).join(' ') || id, state, detail: `${unit} · ${active}/${sub}` });
  }
  return out;
}

/** Cổng http(s)://127.0.0.1|localhost:<cổng> mà config.yaml của Hermes trỏ tới. */
export function configPorts(text) {
  const ports = new Set();
  for (const m of String(text || '').matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})\b/g)) ports.add(Number(m[1]));
  return [...ports];
}

export function tcpOpen(port, { host = '127.0.0.1', timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/** Tiến trình còn sống không: EPERM nghĩa là có nhưng thuộc người dùng khác. */
export function pidAlive(pid, kill = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { kill(pid, 0); return true; } catch (err) { return err?.code === 'EPERM'; }
}

export function createServiceChecker({
  platform = process.platform, hermesHome, sidecarPort = 3872, dashboardPort = 3880,
  execImpl = defaultExec, tcpImpl = tcpOpen, readImpl = (p) => readFileSync(p, 'utf8'), killImpl = process.kill,
  now = Date.now, ttlMs = 10_000,
}) {
  async function viaSystemctl() {
    const { stdout } = await execImpl('systemctl', [
      'list-units', '--type=service', '--all', '--no-legend', '--plain', '--no-pager',
      'zalo-*', 'hermes-*', 'caddy.service', '9router.service',
    ], { windowsHide: true, timeout: 5000 });
    const found = parseSystemctl(stdout);
    for (const id of CORE) {
      if (!found.some((s) => s.id === id)) found.push({ id, label: UNIT_LABELS[id], state: 'missing', detail: `${id}.service · không có trên máy này` });
    }
    return found.sort((a, b) => ORDER(a.id) - ORDER(b.id));
  }

  async function viaProbes() {
    const list = [];
    list.push({ id: 'zalo-bridge', label: UNIT_LABELS['zalo-bridge'], state: (await tcpImpl(sidecarPort)) ? 'up' : 'down', detail: `cổng ${sidecarPort}` });
    list.push({ id: 'zalo-dashboard', label: UNIT_LABELS['zalo-dashboard'], state: 'up', detail: `cổng ${dashboardPort}` });
    let pid = null;
    try { pid = Number(JSON.parse(readImpl(join(hermesHome, 'gateway.pid'))).pid); } catch { /* chưa chạy lần nào hoặc tệp lạ */ }
    list.push({
      id: 'hermes-gateway', label: UNIT_LABELS['hermes-gateway'], state: pidAlive(pid, killImpl) ? 'up' : 'down',
      detail: pid ? `gateway.pid ${pid}` : 'không có gateway.pid',
    });
    let config = '';
    try { config = readImpl(join(hermesHome, 'config.yaml')); } catch { /* không có config */ }
    for (const port of configPorts(config)) {
      if (port === sidecarPort || port === dashboardPort) continue;
      list.push({ id: `port-${port}`, label: PORT_LABELS[port] || `Dịch vụ cục bộ cổng ${port}`, state: (await tcpImpl(port)) ? 'up' : 'down', detail: `127.0.0.1:${port} (config.yaml của Hermes)` });
    }
    return list;
  }

  let cache = null;
  let inflight = null;
  return {
    /** `[{ id, label, state: 'up'|'down'|'starting'|'missing', detail }]` — `detail` chỉ dành cho Quản trị. */
    async check() {
      if (cache && now() - cache.at < ttlMs) return cache.list;
      if (inflight) return inflight;
      inflight = (async () => {
        let list;
        if (platform === 'win32') list = await viaProbes();
        else {
          try { list = await viaSystemctl(); } catch (err) {
            if (err?.code !== 'ENOENT') console.warn('[health] systemctl lỗi, chuyển sang dò cổng:', err?.message || err);
            list = await viaProbes();
          }
        }
        cache = { at: now(), list };
        return list;
      })().finally(() => { inflight = null; });
      return inflight;
    },
  };
}
