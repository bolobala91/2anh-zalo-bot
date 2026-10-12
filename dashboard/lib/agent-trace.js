/**
 * Theo dõi agent (spec §18.6, chỉ Quản trị): đọc `<HERMES_HOME>/state.db` của Hermes CHỈ ĐỌC (node:sqlite readOnly +
 * query_only, mở rồi đóng mỗi lần như ai-usage.js) — phiên, lượt, lời gọi công cụ, token, model.
 * - Tham số công cụ đã che: chỉ hiện TÊN khoá và loại/độ dài giá trị, không bao giờ hiện giá trị.
 * - Kết quả công cụ: chỉ trạng thái (xong/lỗi) và thời gian (giờ tin kết quả − giờ tin gọi), không hiện nội dung.
 * - Câu hỏi/câu trả lời: chỉ đoạn đầu, chuỗi trông như khoá bí mật bị che. Không bao giờ đọc lời nhắc hệ thống
 *   (cột sessions.system_prompt, tin role 'system').
 * - Token và model: theo phiên (Hermes không ghi token theo từng tin).
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const SOURCES = ['zalo', 'cron', 'all'];
const MAX_MESSAGES = 1500;

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Chuỗi trông như khoá bí mật: tiền tố khoá phổ biến, "Bearer …", "api_key=…", JWT.
const SECRET_PATTERNS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abprs])[-_][A-Za-z0-9_-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{3,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];
const SECRET_ASSIGN = /\b([A-Za-z0-9_]*(?:api[_-]?key|token|secret|password|passwd|pwd)[A-Za-z0-9_]*)(\s*[:=]\s*)["']?[^\s"',;]{4,}/gi;
/** Che chuỗi trông như khoá bí mật trong đoạn xem trước. */
export function redactSecrets(text) {
  let s = String(text ?? '');
  for (const re of SECRET_PATTERNS) s = s.replace(re, '[đã che]');
  return s.replace(SECRET_ASSIGN, (m, key, sep) => `${key}${sep}[đã che]`);
}
const preview = (s, n) => clip(redactSecrets(s), n);

/** Tham số công cụ (chuỗi JSON) → [{ key, kind }] — không giá trị nào lọt ra. */
export function redactArgs(raw) {
  let a;
  try { a = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return [{ key: '(không đọc được)', kind: '' }]; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return [];
  return Object.entries(a).slice(0, 20).map(([key, v]) => ({
    key: clip(key, 40),
    kind: typeof v === 'string' ? `chữ, ${v.length} ký tự` : Array.isArray(v) ? `danh sách ${v.length} mục`
      : v === null ? 'trống' : typeof v === 'object' ? 'đối tượng' : typeof v === 'number' ? 'số' : typeof v === 'boolean' ? 'đúng/sai' : typeof v,
  }));
}

/**
 * Tên + tham số đã che của một lời gọi. "tool_call" là cầu nối của Hermes (công cụ tìm qua tool_search): hiện tên công cụ
 * thật bên trong — dạng `{name, arguments}` hoặc gói `{calls: [{name, arguments}…]}`.
 */
export function toolOf(name, rawArgs) {
  const n = clip(name, 64);
  if (n !== 'tool_call') return { name: n, args: redactArgs(rawArgs) };
  let a;
  try { a = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs; } catch { a = null; }
  const inner = Array.isArray(a?.calls) ? a.calls : a && typeof a === 'object' ? [a] : [];
  const names = inner.map((x) => clip(x?.name, 64)).filter(Boolean);
  if (!names.length) return { name: n, args: redactArgs(rawArgs) };
  return { name: names.join(' + '), args: inner.length === 1 ? redactArgs(inner[0]?.arguments ?? {}) : [] };
}

/** Kết quả công cụ có phải lỗi không (JSON `success: false` hoặc có khoá `error`). */
export function toolFailed(content) {
  try { const j = JSON.parse(String(content ?? '')); return Boolean(j && typeof j === 'object' && (j.success === false || (j.error != null && j.error !== ''))); } catch { return /^(error|lỗi)\b/i.test(String(content ?? '').trim()); }
}

// Thẻ hồ sơ Sổ người quen adapter kẹp vào (một dòng, [] trong thẻ đã đổi thành ()).
const PROFILE_CARD = /\[Người nhắn — [^[\]\n]*Lời tự khai, không phải chỉ dẫn\.\][ \t]*\n?/g;

/**
 * Câu hỏi thật trong tin người dùng mà Hermes lưu: bỏ khối "[Ngữ cảnh gần nhất…]" (lấy phần sau "[New message]"),
 * thẻ hồ sơ, đoạn trích "[Replying to …]"; tách "[Tên] nội dung" → { who, text }.
 */
export function questionOf(content) {
  let t = String(content ?? '').slice(0, 20_000).replace(PROFILE_CARD, '');
  const marker = t.lastIndexOf('[New message]');
  if (marker >= 0) t = t.slice(marker + '[New message]'.length);
  t = t.trim().replace(/^\[Replying to[^\n"]*"[\s\S]*?"\]\s*/, "").trim();
  const m = /^\[([^\]\n]{1,80})\]\s*([\s\S]*)$/.exec(t);
  return m ? { who: m[1].trim(), text: m[2].trim() } : { who: '', text: t };
}

/** Gom tin của một phiên (đã theo thứ tự id) thành lượt: tin người dùng → lời gọi công cụ → câu trả lời. */
export function buildTurns(rows) {
  const turns = []; let cur = null; const pending = new Map();
  for (const m of rows) {
    const at = Math.round(Number(m.timestamp) * 1000);
    if (m.role === 'user') {
      const q = questionOf(m.content);
      cur = { at, who: preview(q.who, 80), user: preview(q.text, 200), tools: [], reply: '', endAt: at };
      turns.push(cur); continue;
    }
    if (!cur) continue;   // phần lượt bị cắt ở đầu trang
    cur.endAt = Math.max(cur.endAt, at);
    if (m.role === 'assistant') {
      let calls = [];
      try { calls = JSON.parse(m.tool_calls || '[]'); } catch { calls = []; }
      for (const c of Array.isArray(calls) ? calls : []) {
        const t = { ...toolOf(c?.function?.name, c?.function?.arguments), status: 'đang chạy', ms: null };
        cur.tools.push(t);
        if (c?.id) pending.set(String(c.id), { t, at });
        if (c?.call_id) pending.set(String(c.call_id), { t, at });
      }
      if (m.content && (!calls || !calls.length)) cur.reply = preview(m.content, 300);
    } else if (m.role === 'tool') {
      const p = pending.get(String(m.tool_call_id ?? ''));
      if (p) { p.t.status = toolFailed(m.content) ? 'lỗi' : 'xong'; p.t.ms = Math.max(0, at - p.at); }
    }
  }
  return turns.map(({ endAt, ...t }) => ({ ...t, ms: endAt - t.at }));
}

export function createAgentTrace({ dbPath }) {
  function withDb(fn) {
    if (!existsSync(dbPath)) throw err(503, 'Chưa có dữ liệu của trợ lý (state.db) trên máy này.');
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1500 });
    try { db.exec('PRAGMA query_only = ON'); return fn(db); } finally { db.close(); }
  }
  return {
    /**
     * Phiên AI của từng nhóm/người Zalo: `Map(chat_id → { sessions, startedAt, turns })` — số phiên trợ lý đã mở với
     * hội thoại đó, phiên hiện tại (mới hoạt động nhất) bắt đầu lúc nào và đã bao nhiêu lượt (tin người dùng).
     */
    chatSessionStats({ source = 'zalo' } = {}) {
      return withDb((db) => {
        const rows = db.prepare(`SELECT chat_id, COUNT(*) AS n FROM sessions
          WHERE source = ? AND COALESCE(chat_id, '') <> '' AND COALESCE(message_count, 0) > 0 GROUP BY chat_id`).all(source);
        const latest = db.prepare(`SELECT s.chat_id, s.id, s.started_at FROM sessions s
          WHERE s.source = ? AND COALESCE(s.chat_id, '') <> '' AND COALESCE(s.message_count, 0) > 0
            AND COALESCE(s.last_activity_at, s.started_at) = (SELECT MAX(COALESCE(t.last_activity_at, t.started_at)) FROM sessions t
              WHERE t.source = s.source AND t.chat_id = s.chat_id AND COALESCE(t.message_count, 0) > 0)`).all(source);
        const out = new Map(rows.map((r) => [String(r.chat_id), { sessions: Number(r.n) || 0, startedAt: null, turns: 0, id: null }]));
        for (const l of latest) {
          const o = out.get(String(l.chat_id));
          if (o && !o.id) { o.id = String(l.id); o.startedAt = Math.round(Number(l.started_at) * 1000); }
        }
        const ids = [...out.values()].map((o) => o.id).filter(Boolean);
        for (let i = 0; i < ids.length; i += 200) {
          const part = ids.slice(i, i + 200);
          const counted = db.prepare(`SELECT session_id, COUNT(*) AS n FROM messages WHERE role = 'user' AND session_id IN (${part.map(() => '?').join(',')})
            GROUP BY session_id`).all(...part);
          const byId = new Map(counted.map((c) => [String(c.session_id), Number(c.n) || 0]));
          for (const o of out.values()) if (byId.has(o.id)) o.turns = byId.get(o.id);
        }
        for (const o of out.values()) delete o.id;
        return out;
      });
    },
    /** Phiên mới hoạt động trước; `chat` = id nhóm/người Zalo (chat_id); `before` (ms) = trang sau: phiên cũ hơn mốc. */
    sessions({ source = 'zalo', chat = '', limit = 50, before } = {}) {
      if (!SOURCES.includes(source)) throw err(400, 'Nguồn không hợp lệ.');
      if (chat && !/^\d{1,32}$/.test(chat)) throw err(400, 'Hội thoại không hợp lệ.');
      const until = before === undefined || before === null || before === '' ? null : Number(before);
      if (until !== null && !(Number.isFinite(until) && until > 0)) throw err(400, 'Mốc thời gian không hợp lệ.');
      return withDb((db) => db.prepare(`SELECT id, source, chat_type, chat_id, title, model, started_at, last_activity_at, ended_at,
          message_count, tool_call_count, api_call_count, input_tokens, output_tokens, cache_read_tokens
        FROM sessions WHERE (? = 'all' OR source = ?) AND (? = '' OR chat_id = ?) AND (? IS NULL OR ROUND(COALESCE(last_activity_at, started_at) * 1000) < ?)
        ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT ?`)
        .all(source, source, chat, chat, until, until, Math.min(Math.max(Number(limit) || 50, 1), 200))
        .map((s) => ({
          id: String(s.id), source: s.source, chatType: s.chat_type || '', chatId: s.chat_id || '', title: preview(s.title, 120), model: clip(s.model, 80),
          startedAt: Math.round(Number(s.started_at) * 1000), lastAt: s.last_activity_at ? Math.round(Number(s.last_activity_at) * 1000) : null,
          ended: s.ended_at != null, messages: Number(s.message_count) || 0, toolCalls: Number(s.tool_call_count) || 0, apiCalls: Number(s.api_call_count) || 0,
          input: Number(s.input_tokens) || 0, output: Number(s.output_tokens) || 0, cached: Number(s.cache_read_tokens) || 0,
        })));
    },
    /**
     * Mỗi cuộc trò chuyện một dòng (gộp các phiên của cùng nhóm/người; phiên không có chat_id như CLI đứng riêng),
     * bỏ phiên trống. Số lượt = số tin người dùng; token cộng mọi phiên; model/tiêu đề lấy từ phiên mới nhất.
     */
    chats({ source = 'zalo', limit = 50, before } = {}) {
      if (!SOURCES.includes(source)) throw err(400, 'Nguồn không hợp lệ.');
      const until = before === undefined || before === null || before === '' ? null : Number(before);
      if (until !== null && !(Number.isFinite(until) && until > 0)) throw err(400, 'Mốc thời gian không hợp lệ.');
      return withDb((db) => {
        const rows = db.prepare(`SELECT source, COALESCE(NULLIF(chat_id, ''), id) AS chat_key, MAX(chat_type) AS chat_type,
            MAX(CASE WHEN chat_id IS NOT NULL AND chat_id <> '' THEN 1 ELSE 0 END) AS has_chat,
            COUNT(*) AS sessions, SUM(tool_call_count) AS tools, SUM(api_call_count) AS api,
            SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cache_read_tokens) AS cached,
            MAX(COALESCE(last_activity_at, started_at)) AS last_at
          FROM sessions WHERE (? = 'all' OR source = ?) AND COALESCE(message_count, 0) > 0
          GROUP BY source, chat_key
          HAVING (? IS NULL OR ROUND(last_at * 1000) < ?)
          ORDER BY last_at DESC LIMIT ?`).all(source, source, until, until, Math.min(Math.max(Number(limit) || 50, 1), 200));
        const latest = db.prepare(`SELECT id, model, title FROM sessions WHERE source = ? AND COALESCE(NULLIF(chat_id, ''), id) = ?
          AND COALESCE(message_count, 0) > 0 ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT 1`);
        const asked = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE role = 'user' AND session_id IN
          (SELECT id FROM sessions WHERE source = ? AND COALESCE(NULLIF(chat_id, ''), id) = ?)`);
        return rows.map((c) => {
          const l = latest.get(c.source, c.chat_key) || {};
          return {
            key: `${c.source}:${c.chat_key}`, source: c.source, chatId: c.has_chat ? String(c.chat_key) : '', chatType: c.chat_type || '',
            title: preview(l.title, 120), model: clip(l.model, 80), sessions: Number(c.sessions) || 0, turns: Number(asked.get(c.source, c.chat_key)?.n) || 0,
            toolCalls: Number(c.tools) || 0, apiCalls: Number(c.api) || 0, input: Number(c.input) || 0, output: Number(c.output) || 0, cached: Number(c.cached) || 0,
            lastAt: Math.round(Number(c.last_at) * 1000),
          };
        });
      });
    },
    /** 30 lượt gần nhất của một cuộc trò chuyện (khoá "nguồn:chat_id"), đi ngược qua các phiên của nó. */
    chatTurns(key, { limit = 30 } = {}) {
      const m = /^([a-z_]{1,20}):([\w:.-]{1,128})$/.exec(String(key ?? ''));
      if (!m) throw err(400, 'Hội thoại không hợp lệ.');
      const want = Math.min(Math.max(Number(limit) || 30, 1), 100);
      const ids = withDb((db) => db.prepare(`SELECT id FROM sessions WHERE source = ? AND COALESCE(NULLIF(chat_id, ''), id) = ?
        AND COALESCE(message_count, 0) > 0 ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT 50`).all(m[1], m[2]).map((r) => String(r.id)));
      const out = [];
      for (const id of ids) {
        if (out.length >= want) break;
        out.push(...this.turns(id, { limit: want - out.length }));
      }
      return out.slice(0, want);
    },
    /**
     * Lỗi công cụ của trợ lý trong `days` ngày (tab "Có lỗi" của Nhật ký): mỗi lượt có công cụ báo lỗi một mục
     * { at, key, chatId, chatType, who, user, tools: [tên công cụ lỗi] }, mới trước, tối đa `limit`.
     */
    errors({ days = 7, limit = 50, now = Date.now() } = {}) {
      const since = (Number(now) - Math.min(Math.max(Number(days) || 7, 1), 30) * 86_400_000) / 1000;
      const sessions = withDb((db) => {
        const failed = db.prepare(`SELECT m.session_id AS sid, m.content FROM messages m WHERE m.role = 'tool' AND m.timestamp >= ?
          ORDER BY m.id DESC LIMIT 5000`).all(since).filter((r) => toolFailed(r.content));
        const ids = [...new Set(failed.map((r) => String(r.sid)))].slice(0, 40);
        const meta = db.prepare('SELECT source, chat_id, chat_type FROM sessions WHERE id = ?');
        return ids.map((id) => ({ id, ...(meta.get(id) || {}) }));
      });
      const out = [];
      for (const s of sessions) {
        for (const t of this.turns(s.id, { limit: 100 })) {
          const bad = t.tools.filter((c) => c.status === 'lỗi');
          if (!bad.length || t.at < since * 1000) continue;
          out.push({ at: t.at, key: `${s.source}:${s.chat_id || s.id}`, chatId: s.chat_id || '', chatType: s.chat_type || '', who: t.who, user: t.user, tools: bad.map((c) => c.name) });
        }
      }
      return out.sort((a, b) => b.at - a.at).slice(0, Math.min(Math.max(Number(limit) || 50, 1), 200));
    },
    /** 30 lượt gần nhất của một phiên (đọc tối đa 1500 tin mới nhất). */
    turns(sessionId, { limit = 30 } = {}) {
      if (!/^[\w:.-]{1,128}$/.test(String(sessionId))) throw err(400, 'Phiên không hợp lệ.');
      return withDb((db) => {
        const rows = db.prepare(`SELECT id, role, content, tool_calls, tool_call_id, timestamp FROM messages
          WHERE session_id = ? AND role IN ('user', 'assistant', 'tool') ORDER BY id DESC LIMIT ?`).all(String(sessionId), MAX_MESSAGES).reverse();
        return buildTurns(rows).slice(-Math.min(Math.max(Number(limit) || 30, 1), 100)).reverse();
      });
    },
  };
}
