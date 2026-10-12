/**
 * Kho tri thức tự học (spec §19.6, chỉ máy chủ Linux): những gì trợ lý tự rút ra sau các cuộc trò chuyện,
 * do provider `zalo_memory` ghi vào OpenViking trên cùng máy, tài khoản "zalo", mỗi nhóm/người một "người dùng":
 *   viking://user/zalo-g-<groupId>/memories/…   viking://user/zalo-u-<uid>/memories/…
 * Tách hẳn khỏi Kho tri thức (tài liệu người dùng tải lên) và Second brain (tài khoản "default").
 * Quản trị và Chủ bot cùng xem/sửa/xoá; RIÊNG kho tin nhắn riêng của chủ nhân bot (zalo-u-<UID chủ nhân>) chỉ Quản trị
 * thấy — chặn ở đây (máy chủ), không chỉ ẩn ở giao diện. Đổi chu kỳ rút và "Rút trí nhớ ngay" chỉ Quản trị.
 * Chỉ đụng TỆP .md dưới `memories/` của đúng một phạm vi; không bao giờ mở sessions/ (bản ghi thô), privacy/,
 * tệp tóm tắt tự sinh (.abstract.md, .overview.md) hay phạm vi khác.
 */
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { readJson, writeJsonAtomic } from './json-store.js';
import { loopbackEndpoint, ovRequest } from './second-brain.js';

export const LM_ACCOUNT = 'zalo';
export const LM_PROVIDER = 'zalo_memory';
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:1933';
// Chu kỳ rút trí nhớ (phút) — provider đọc nóng cùng tệp `<HERMES_HOME>/zalo/memory.json`.
export const EXTRACT_DEFAULT = 120;
export const EXTRACT_MIN = 30;
export const EXTRACT_MAX = 1440;
// "Rút trí nhớ ngay": mỗi kho tối đa 3 lần/ngày (giờ VN), mỗi lần commit tối đa 5 phiên gần nhất còn tin chờ.
export const EXTRACT_NOW_PER_DAY = 3;
const EXTRACT_NOW_SESSIONS = 5;
const SCOPE = /^zalo-(g|u)-(\d{1,32})$/;
const GENERATED = new Set(['.abstract.md', '.overview.md']);
/** Tóm tắt thư mục OpenViking chưa sinh xong trả về chỗ giữ chỗ "# viking://… [Directory abstract is not ready]" —
 * vô nghĩa với người dùng và lộ ID nhóm/người, nên coi như chưa có tóm tắt. */
export const cleanAbstract = (s) => { const t = String(s || ''); return /^#\s*viking:\/\//.test(t.trim()) || /abstract is not ready/i.test(t) ? '' : t; };
const MAX_TEXT = 8000;
export const WINDOWS_NOTE = 'Kho tri thức tự học chỉ bật trên máy chủ Linux/VPS.';
export const OFF_NOTE = 'Trí nhớ dài hạn chưa bật — người cài đặt đặt memory.provider: zalo_memory trong config.yaml của Hermes (xem README, mục Trí nhớ dài hạn).';
export const NOT_LOOPBACK_NOTE = 'OPENVIKING_ENDPOINT phải là địa chỉ trên cùng máy (127.0.0.1) — báo người cài đặt sửa lại.';

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const vnDay = (ms) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);

/** `{ kind: 'group'|'dm', id }` của tên phạm vi hợp lệ, ngược lại null. */
export function parseScope(scope) {
  const m = SCOPE.exec(String(scope ?? ''));
  return m ? { kind: m[1] === 'g' ? 'group' : 'dm', id: m[2] } : null;
}

export const scopeRoot = (scope) => `viking://user/${scope}/memories`;

/**
 * URI được phép đọc trong một phạm vi: thư mục hoặc tệp dưới `memories/`, không "..", không "%", "\\", ký tự điều khiển.
 * `file: true` → phải là tệp .md và không phải tệp tóm tắt tự sinh (dùng cho sửa/xoá).
 */
export function memoryUri(uri, scope, { file = false } = {}) {
  const s = String(uri ?? '');
  const root = scopeRoot(scope);
  if (!parseScope(scope) || s.length > 500 || s.includes('..') || /[\u0000-\u001f%\\?#]/.test(s)) return false;
  if (!(s === root || s.startsWith(`${root}/`))) return false;
  if (!file) return true;
  const name = s.split('/').pop();
  return s !== root && s.endsWith('.md') && !GENERATED.has(name);
}

/** Đọc `memory.provider` của Hermes; lỗi đọc → ''. */
export function readProvider(configFile) {
  try { return String(YAML.parse(readFileSync(configFile, 'utf8'))?.memory?.provider ?? '').trim(); } catch { return ''; }
}

/** Chu kỳ rút đang có hiệu lực — cùng luật với provider: thiếu/hỏng/sai kiểu → 120, ngoài khoảng → kẹp. */
export function readMemorySettings(file) {
  let minutes = EXTRACT_DEFAULT;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    if (data?.version === 1 && Number.isInteger(data.extractMinutes)) minutes = Math.min(EXTRACT_MAX, Math.max(EXTRACT_MIN, data.extractMinutes));
  } catch { /* chưa có tệp → mặc định */ }
  return { extractMinutes: minutes, min: EXTRACT_MIN, max: EXTRACT_MAX, default: EXTRACT_DEFAULT };
}

/** Bật khi: không phải Windows, Hermes đang dùng provider zalo_memory, OpenViking là địa chỉ loopback. */
export function learnedMemoryStatus({ provider, endpoint, platform = process.platform }) {
  if (platform === 'win32') return { enabled: false, reason: 'windows', note: WINDOWS_NOTE };
  if (provider !== LM_PROVIDER) return { enabled: false, reason: 'off', note: OFF_NOTE };
  const base = loopbackEndpoint(String(endpoint ?? '').trim() || DEFAULT_ENDPOINT);
  if (!base) return { enabled: false, reason: 'not-loopback', note: NOT_LOOPBACK_NOTE };
  return { enabled: true, reason: 'ok', note: '', base };
}

/**
 * `settings()` đọc lại mỗi lần: `{ provider, endpoint }`. `names(kind, id)` → tên hiển thị (nhóm/người) hoặc ''.
 * `owners()` → UID chủ nhân bot (kho DM của họ chỉ Quản trị thấy); `ownerOverrides()` → UID chủ nhân từ nguồn ghi đè;
 * `everOwnersFile` → tệp lưu mọi UID từng là chủ nhân. `settingsFile` → `<HERMES_HOME>/zalo/memory.json`.
 * Dùng: `lm.as(role).scopes()` … — mọi thao tác theo phạm vi kiểm quyền thấy trước khi gọi mạng.
 */
export function createLearnedMemory({ settings, names = () => '', owners = () => [], ownerOverrides = () => [], everOwnersFile, settingsFile, platform = process.platform, fetchImpl = fetch, now = Date.now }) {
  const status = () => { const s = settings(); return learnedMemoryStatus({ provider: s.provider, endpoint: s.endpoint, platform }); };
  const extractLog = new Map();   // phạm vi → [mốc ms] trong ngày VN hiện tại
  function conn(scope = 'zalo-dashboard') {
    const st = status();
    if (!st.enabled) throw err(404, st.note);
    return { base: st.base, account: LM_ACCOUNT, user: scope, apiKey: '' };
  }
  const call = (scope, path, opts) => ovRequest(conn(scope), path, opts, fetchImpl);
  // Kho chưa có dữ liệu: OpenViking trả NOT_FOUND → coi là rỗng, không phải lỗi.
  const orEmpty = (p) => p.catch((e) => { if (e?.ovCode === 'NOT_FOUND') return []; throw e; });
  const uids = (fn) => { try { return (fn() || []).map((x) => String(x).trim()).filter(Boolean); } catch { return null; } };
  /**
   * UID có kho DM chỉ Quản trị thấy — đóng khi lỗi: danh sách chủ nhân trống/không đọc được → null (ẩn MỌI kho DM
   * với vai trò khác Quản trị). Ngược lại: chủ nhân hiện tại ∪ nguồn ghi đè (.env bot, biến môi trường) ∪ mọi UID từng
   * là chủ nhân (lưu tệp, chỉ thêm không bớt — bỏ ai khỏi danh sách thì kho của họ vẫn chỉ Quản trị thấy).
   */
  function ownerSet() {
    const current = uids(owners);
    if (!current?.length) return null;
    const all = new Set([...current, ...(uids(ownerOverrides) || [])]);
    if (everOwnersFile) {
      const saved = readJson(everOwnersFile, null);
      const ever = Array.isArray(saved?.uids) ? saved.uids.map(String) : [];
      for (const u of ever) all.add(u);
      if (all.size > ever.length) {
        try { writeJsonAtomic(everOwnersFile, { version: 1, uids: [...all] }); } catch { /* lần sau ghi lại; tập vẫn đủ ở lượt này */ }
      }
    }
    return all;
  }
  const ownerDm = (p, set) => p?.kind === 'dm' && (set === null || set.has(p.id));
  const visible = (scope, role, set) => { const p = parseScope(scope); return Boolean(p) && (role === 'admin' || !ownerDm(p, set)); };
  function need(scope, role) { if (!visible(scope, role, ownerSet())) throw err(404, 'Không có nhóm/người này — chọn lại từ danh sách.'); }

  function as(role) {
    return {
      /** Mọi phạm vi đang có trí nhớ mà vai trò này được thấy: nhóm trước, rồi người; kèm tên và nhãn chủ nhân. */
      async scopes() {
        const set = ownerSet();
        const result = await orEmpty(call(undefined, '/api/v1/fs/ls', { query: { uri: 'viking://user' } }));
        return (Array.isArray(result) ? result : [])
          .map((e) => String(e?.uri ?? '').replace(/^viking:\/\/user\//, '').replace(/\/$/, ''))
          .filter((scope) => visible(scope, role, set))
          .map((scope) => { const p = parseScope(scope); return { scope, ...p, name: String(names(p.kind, p.id) || ''), owner: p.kind === 'dm' && Boolean(set?.has(p.id)) }; })
          // Nhóm trước, rồi DM khách, cuối cùng DM chủ nhân; trong mỗi loại theo tên.
          .sort((a, b) => ((a.kind === 'group' ? 0 : a.owner ? 2 : 1) - (b.kind === 'group' ? 0 : b.owner ? 2 : 1)) || a.name.localeCompare(b.name, 'vi'))
          .slice(0, 1000);
      },
      async list(scope, uri = scopeRoot(scope)) {
        need(scope, role);
        if (!memoryUri(uri, scope)) throw err(400, 'Không mở được mục này — chọn lại từ danh sách.');
        const result = await orEmpty(call(scope, '/api/v1/fs/ls', { query: { uri } }));
        return (Array.isArray(result) ? result : [])
          .filter((e) => memoryUri(e?.uri, scope) && !GENERATED.has(String(e.uri).split('/').pop()))
          .slice(0, 500)
          .map((e) => ({ uri: e.uri, dir: Boolean(e.isDir), modTime: e.modTime || null, abstract: cleanAbstract(e.abstract).slice(0, 400) }));
      },
      async read(scope, uri) {
        need(scope, role);
        if (!memoryUri(uri, scope, { file: true })) throw err(400, 'Không mở được mục này — chọn lại từ danh sách.');
        return String(await call(scope, '/api/v1/content/read', { query: { uri } }) ?? '').slice(0, 200_000);
      },
      /** Tìm theo ý nghĩa, CHỈ trong một phạm vi (target_uri), lọc lại kết quả. */
      async search(scope, query) {
        need(scope, role);
        const q = String(query ?? '').trim();
        if (q.length < 2 || q.length > 200) throw err(400, 'Gõ 2–200 ký tự để tìm.');
        const result = await orEmpty(call(scope, '/api/v1/search/find', { method: 'POST', body: { query: q, limit: 20, context_type: 'memory', target_uri: scopeRoot(scope) } }));
        return (Array.isArray(result?.memories) ? result.memories : [])
          .filter((h) => memoryUri(h?.uri, scope, { file: true }))
          .map((h) => ({ uri: h.uri, score: Number(h.score) || 0, abstract: cleanAbstract(h.abstract).slice(0, 600) }))
          .sort((a, b) => b.score - a.score);
      },
      async edit(scope, uri, text) {
        need(scope, role);
        if (!memoryUri(uri, scope, { file: true })) throw err(400, 'Chỉ sửa được từng mục trí nhớ — chọn lại từ danh sách.');
        const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
        if (!body) throw err(400, 'Nội dung trống — muốn bỏ mục này thì bấm Xoá.');
        if (body.length > MAX_TEXT) throw err(400, `Mỗi mục tối đa ${MAX_TEXT} ký tự.`);
        await call(scope, '/api/v1/content/write', { method: 'POST', body: { uri, content: `${body}\n`, mode: 'replace' } });
      },
      async remove(scope, uri) {
        need(scope, role);
        if (!memoryUri(uri, scope, { file: true })) throw err(400, 'Chỉ xoá được từng mục trí nhớ — chọn lại từ danh sách.');
        await call(scope, '/api/v1/fs', { method: 'DELETE', query: { uri, recursive: 'false' } });
      },
      /** "Quên hẳn" một nhóm/người: xoá cả trí nhớ lẫn bản ghi phiên thô của phạm vi đó. */
      async forget(scope) {
        need(scope, role);
        await call(scope, '/api/v1/fs', { method: 'DELETE', query: { uri: `viking://user/${scope}`, recursive: 'true' } });
      },
      /** Chỉ Quản trị: commit ngay các phiên còn tin chờ của một kho (OpenViking chạy LLM rút trí nhớ), 3 lần/kho/ngày. */
      async extractNow(scope) {
        if (role !== 'admin') throw err(403, 'Chỉ Quản trị được rút trí nhớ ngay.');
        need(scope, role);
        const day = vnDay(now());
        const used = (extractLog.get(scope) || []).filter((ms) => vnDay(ms) === day);
        if (used.length >= EXTRACT_NOW_PER_DAY) throw err(429, `Kho này đã rút ngay ${EXTRACT_NOW_PER_DAY} lần hôm nay — trợ lý vẫn tự rút theo chu kỳ.`);
        const listing = await call(scope, '/api/v1/fs/ls', { query: { uri: `viking://user/${scope}/sessions` } }).catch((e) => {
          if (e.statusCode === 502) return [];   // chưa có phiên nào
          throw e;
        });
        const sessions = (Array.isArray(listing) ? listing : []).filter((e) => e?.isDir)
          .sort((a, b) => String(b.modTime || '').localeCompare(String(a.modTime || '')))
          .map((e) => String(e.uri).replace(/\/$/, '').split('/').pop())
          .filter((sid) => /^[A-Za-z0-9_.:-]{1,200}$/.test(sid))
          .slice(0, EXTRACT_NOW_SESSIONS);
        let committed = 0;
        for (const sid of sessions) {
          const info = await call(scope, `/api/v1/sessions/${encodeURIComponent(sid)}`);
          if (Number(info?.pending_tokens) > 0) {
            await call(scope, `/api/v1/sessions/${encodeURIComponent(sid)}/commit`, { method: 'POST', body: { keep_recent_count: 0 } });
            committed += 1;
          }
        }
        if (committed) extractLog.set(scope, [...used, now()]);
        return { committed, left: EXTRACT_NOW_PER_DAY - used.length - (committed ? 1 : 0) };
      },
    };
  }

  return {
    status() { const { enabled, reason, note } = status(); return { enabled, reason, note }; },
    as,
    settings() { return readMemorySettings(settingsFile); },
    /** Chỉ Quản trị (route kiểm): đổi chu kỳ rút; provider đọc lại tệp ngay lượt sau, không cần khởi động lại. */
    setSettings({ extractMinutes } = {}) {
      const m = extractMinutes;
      if (typeof m !== 'number' || !Number.isInteger(m) || m < EXTRACT_MIN || m > EXTRACT_MAX) throw err(400, `Chu kỳ rút trí nhớ là số phút từ ${EXTRACT_MIN} đến ${EXTRACT_MAX}.`);
      writeJsonAtomic(settingsFile, { version: 1, extractMinutes: m });
      return readMemorySettings(settingsFile);
    },
  };
}
