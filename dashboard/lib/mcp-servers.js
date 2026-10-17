/**
 * Kết nối MCP (spec §18.6, chỉ Quản trị): các máy chủ MCP trong `mcp_servers` của config.yaml Hermes.
 * - Xem: tên, kiểu (http/stdio), đích rút gọn (máy:cổng, hoặc tên lệnh), bật/tắt, có mở cho thành viên không
 *   (ZALO_PUBLIC_MCP). KHÔNG BAO GIỜ trả `env`, `headers`, `args`, đường dẫn/chuỗi truy vấn của URL (hay chứa khoá).
 * - Trạng thái: chỉ dò TCP tới địa chỉ loopback (127.0.0.1/localhost), có thời hạn; máy ngoài không dò (tránh biến
 *   dashboard thành cầu quét mạng). stdio: không chạy lệnh để dò — "không kiểm được từ dashboard".
 * - Bật/tắt: sửa đúng dòng `mcp_servers.<tên>.enabled` (Hermes bỏ qua máy chủ có enabled: false) → cần khởi động
 *   lại trợ lý. Thêm/gỡ/chọn công cụ/đăng nhập đi qua mã Hermes (lib/hermes-admin.py, routes/mcp.js): chỉ danh mục
 *   Hermes hoặc địa chỉ https — không bao giờ chạy lệnh tuỳ ý do người dùng gõ.
 */
import { connect } from 'node:net';
import { basename } from 'node:path';
import { editConfigYaml, readConfigYaml } from './config-yaml.js';

export const SERVER_NAME = /^(?!\.+$)[A-Za-z0-9_.-]{1,64}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const ENV_REF = /\$\{([A-Z][A-Z0-9_]{1,63})\}/g;
const MAX_PUBLIC = 20; // như ô "Kết nối MCP thành viên được dùng" ở Cấu hình
const seconds = (v) => (Number.isInteger(v) && v > 0 ? v : null);

/** Tên biến .env làm khoá của kết nối (các `${TÊN}` trong headers/env) — chỉ tên, không bao giờ giá trị. */
export function keyRefs(cfg) {
  const out = new Set();
  for (const block of ['headers', 'env']) {
    const v = cfg?.[block];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    for (const x of Object.values(v)) for (const m of String(x).matchAll(ENV_REF)) if (!/^(ZALO|HERMES)_/.test(m[1])) out.add(m[1]);
  }
  return [...out];
}
const truthy = (v) => !(v === false || /^(false|0|no|off)$/i.test(String(v ?? '').trim()));

/** fnmatch đơn giản của Python (`*`, `?`) như `_mcp_open_to_members` của plugin. */
export function globMatch(pattern, text) {
  const re = new RegExp(`^${String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  return re.test(text);
}

/** Một mục mcp_servers → dạng an toàn để hiện. */
export function describeServer(name, cfg, publicPatterns = []) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  let transport = 'stdio'; let target = ''; let host = ''; let port = 0;
  if (c.url) {
    transport = 'http';
    try { const u = new URL(String(c.url)); host = u.hostname; port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80); target = `${u.protocol}//${u.host}`; } catch { target = '(địa chỉ hỏng)'; }
  } else if (c.command) target = basename(String(c.command).trim().split(/\s+/)[0]).slice(0, 60);
  return {
    name, transport, target, enabled: truthy(c.enabled ?? true), loopback: LOOPBACK.has(host),
    publicToMembers: publicPatterns.some((p) => globMatch(p, name) || globMatch(p, `mcp-${name}`)), host, port,
    auth: c.auth === 'oauth' ? 'oauth' : (c.headers ? 'key' : 'none'),
    toolsOff: Array.isArray(c.tools?.exclude) ? c.tools.exclude.length : 0, toolsOnly: Array.isArray(c.tools?.include) ? c.tools.include.length : null,
    keys: keyRefs(c), timeout: seconds(c.timeout), connectTimeout: seconds(c.connect_timeout),
    publicVia: publicPatterns.find((p) => p !== name && p !== `mcp-${name}` && (globMatch(p, name) || globMatch(p, `mcp-${name}`))) || '',
  };
}

const probeTcp = (host, port, timeoutMs = 1500) => new Promise((resolve) => {
  const s = connect({ host: host.replace(/^\[|\]$/g, ''), port });
  const done = (ok) => { s.destroy(); resolve(ok); };
  s.setTimeout(timeoutMs, () => done(false));
  s.once('connect', () => done(true));
  s.once('error', () => done(false));
});

export function createMcpServers({ configFile, publicMcp = () => '', writePublicMcp = null, probe = probeTcp }) {
  const patterns = () => String(publicMcp() || '').split(',').map((s) => s.trim()).filter(Boolean);
  const servers = () => {
    const m = readConfigYaml(configFile)?.mcp_servers;
    return m && typeof m === 'object' && !Array.isArray(m) ? Object.entries(m).filter(([n]) => SERVER_NAME.test(n)) : [];
  };
  return {
    async list() {
      const pats = patterns();
      return Promise.all(servers().map(async ([name, cfg]) => {
        const { host, port, ...d } = describeServer(name, cfg, pats);
        let status = 'Chạy cùng trợ lý — không kiểm được từ dashboard';
        if (!d.enabled) status = 'Đã tắt';
        else if (d.transport === 'http') status = d.loopback ? ((await probe(host, port)) ? 'Đang mở' : 'Không phản hồi') : 'Máy ngoài — không kiểm';
        return { ...d, status };
      }));
    },
    /** "Ai được dùng": thêm/bỏ đúng tên kết nối trong ZALO_PUBLIC_MCP. Đang mở bằng mẫu chung (*, rag_*…) thì không
     *  tự xoá mẫu đó (có thể mở cả kết nối khác) — báo sửa ở trang Cấu hình. Trả true nếu có đổi. */
    setMembers(name, open) {
      if (!SERVER_NAME.test(String(name)) || !servers().some(([n]) => n === name)) throw err(404, 'Không có kết nối MCP này — tải lại trang.');
      if (typeof open !== 'boolean') throw err(400, 'Giá trị không hợp lệ.');
      if (!writePublicMcp) throw err(503, 'Máy này chưa cho sửa ZALO_PUBLIC_MCP từ dashboard.');
      const pats = patterns();
      const exact = (p) => p === name || p === `mcp-${name}`;
      const now = pats.some((p) => globMatch(p, name) || globMatch(p, `mcp-${name}`));
      let next;
      if (open) {
        if (now) return false;
        if (pats.length >= MAX_PUBLIC) throw err(400, `Đã mở tối đa ${MAX_PUBLIC} mục cho thành viên — bỏ bớt ở trang Cấu hình.`);
        next = [...pats, name];
      } else {
        next = pats.filter((p) => !exact(p));
        const via = next.find((p) => globMatch(p, name) || globMatch(p, `mcp-${name}`));
        if (via) throw err(409, `Kết nối này đang mở cho thành viên theo mẫu "${via}" ở trang Cấu hình — sửa mẫu đó ở Cấu hình.`);
        if (next.length === pats.length) return false;
      }
      writePublicMcp(next.join(','));
      return true;
    },
    setEnabled(name, enabled) {
      if (!SERVER_NAME.test(String(name)) || !servers().some(([n]) => n === name)) throw err(404, 'Không có kết nối MCP này — tải lại trang.');
      if (typeof enabled !== 'boolean') throw err(400, 'Giá trị bật/tắt không hợp lệ.');
      return editConfigYaml(configFile, [{ path: ['mcp_servers', name, 'enabled'], value: enabled }]);
    },
  };
}
