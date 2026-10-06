/**
 * Đọc lịch sử chat của bot từ <sidecar>/data/zalo.sqlite — CHỈ ĐỌC (spec §5.1, §11.4).
 * SQLite chạy WAL nên đọc song song được khi bot đang ghi, và vẫn đọc được khi bot tắt.
 * Không bao giờ tạo tệp: bot chưa chạy lần nào thì ném StoreUnavailable.
 */
import { existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fold } from '../public/fold.js';

export const LOGIN_CODE_PREFIX = 'Mã đăng nhập dashboard:';
const SECRET = `${LOGIN_CODE_PREFIX}%`;
const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;
const END = Number.MAX_SAFE_INTEGER;
const SENDER_WINDOW_MS = 30 * DAY_MS;

export class StoreUnavailable extends Error {
  constructor() { super('Chưa có lịch sử trò chuyện'); this.name = 'StoreUnavailable'; }
}

/** Mốc 0 giờ hôm nay theo giờ Việt Nam (UTC+7, không có giờ mùa hè). */
export function startOfDayVN(nowMs) {
  return Math.floor((nowMs + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
}

/** Con trỏ trang "<timestamp_ms>:<rowid>"; sai dạng → null. */
export function parseCursor(value) {
  const match = /^(\d{1,16}):(\d{1,16})$/.exec(String(value ?? ''));
  return match ? { ts: Number(match[1]), id: Number(match[2]) } : null;
}

const pageSize = (n, max, dflt) => {
  const x = Number.parseInt(n, 10);
  return Number.isInteger(x) ? Math.min(Math.max(x, 1), max) : dflt;
};

function toMessage(r) {
  return { id: Number(r.id), senderName: r.sender_name, text: r.text, msgType: r.msg_type, ts: Number(r.timestamp_ms), isSelf: Boolean(r.is_self) };
}

/**
 * Câu hỏi nóng, xuất ra để test kiểm EXPLAIN QUERY PLAN trên chính câu thật.
 * "+account_id" tắt chỉ mục theo tài khoản: khi chưa ANALYZE, SQLite sẽ chọn idx_messages_thread_time
 * (account_id = ?) và quét mọi tin của tài khoản. Bỏ nó đi thì chỉ còn idx_messages_retention:
 * - số liệu hôm nay (gọi mỗi 3 s) chỉ đọc tin từ 0 giờ;
 * - tìm kiếm đi ngược từ tin mới nhất, dừng khi đủ một trang — không gom hết tin trùng rồi sắp xếp.
 */
export const SQL = {
  todayTotals: `
    SELECT COALESCE(SUM(is_self = 0), 0) AS received, COALESCE(SUM(is_self = 1), 0) AS sent
    FROM messages WHERE +account_id = ? AND timestamp_ms >= ? AND text NOT LIKE ?`,
  todayTop: `
    SELECT thread_id, COUNT(*) AS n FROM messages
    WHERE +account_id = ? AND thread_type = 1 AND timestamp_ms >= ? AND text NOT LIKE ?
    GROUP BY thread_id ORDER BY n DESC, thread_id LIMIT 5`,
  search: (match) => `
    SELECT rowid AS id, thread_id, thread_type, sender_name, text, msg_type, timestamp_ms, is_self FROM messages
    WHERE +account_id = ? AND ${match} AND text NOT LIKE ?
      AND timestamp_ms <= ? AND (timestamp_ms < ? OR rowid < ?)
    ORDER BY timestamp_ms DESC, rowid DESC LIMIT ?`,
};
export const SEARCH_MATCH = { fold: 'instr(zd_fold(text), ?) > 0', like: "text LIKE ? ESCAPE '\\'" };

const fileIdentity =(p) => { const s = statSync(p, { bigint: true }); return `${s.dev}:${s.ino}:${s.birthtimeNs}`; };

export function createStoreReader({
  path, caseFold = true, now = Date.now, identityCheckMs = 30_000, conversationsTtlMs = 10_000, statFile = fileIdentity,
}) {
  let db = null;
  let folding = false;
  let identity = null;
  let checkedAt = 0;
  let convCache = null; // { key, at, value } — danh sách hội thoại đệm ngắn, khỏi quét cả bảng mỗi lần giao diện hỏi

  function drop() {
    if (db) { try { db.close(); } catch { /* đã đóng */ } }
    db = null; convCache = null;
  }

  /** Tệp bị thay (khôi phục bản sao, cài lại) thì kết nối cũ vẫn trỏ vào inode cũ — kiểm tối đa 30 s/lần rồi mở lại. */
  function stale() {
    const t = now();
    if (t - checkedAt < identityCheckMs) return false;
    checkedAt = t;
    let id = null;
    try { id = statFile(path); } catch { /* tệp đã mất */ }
    return id !== identity;
  }

  function open() {
    if (db && !stale()) return db;
    drop();
    if (!path || !existsSync(path)) throw new StoreUnavailable();
    try { identity = statFile(path); } catch { throw new StoreUnavailable(); }
    checkedAt = now();
    const d = new DatabaseSync(path, { readOnly: true });
    // readOnly chỉ có từ Node 22.12 — query_only chặn mọi lệnh ghi trên mọi bản Node 22.
    d.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 2000;');
    // database.function có từ Node 22.13; bản cũ hơn tìm bằng LIKE (chỉ không phân biệt hoa thường với chữ không dấu).
    folding = caseFold && typeof d.function === 'function';
    if (folding) d.function('zd_fold', { deterministic: true }, fold);
    db = d;
    return d;
  }

  /** Tài khoản Zalo của bot = tài khoản có tin mới nhất. */
  function account() {
    const row = open().prepare('SELECT account_id FROM messages ORDER BY timestamp_ms DESC LIMIT 1').get();
    return row ? row.account_id : null;
  }

  // Câu này gom cả bảng (~1 s với 200k tin) — đệm conversationsTtlMs theo tài khoản; gửi tay xong thì xoá đệm.
  function listConversations({ limit } = {}) {
    const acc = account();
    if (!acc) return [];
    const size = pageSize(limit, 300, 300);
    const key = `${acc}\n${size}`;
    if (convCache && convCache.key === key && now() - convCache.at < conversationsTtlMs) return convCache.value;
    const value = readConversations(acc, size);
    convCache = { key, at: now(), value };
    return value;
  }

  function readConversations(acc, size) {
    const d = open();
    const threads = d.prepare(`
      SELECT thread_id, thread_type, MAX(timestamp_ms) AS last_at, COUNT(*) AS total
      FROM messages WHERE account_id = ? AND text NOT LIKE ?
      GROUP BY thread_type, thread_id
      ORDER BY last_at DESC LIMIT ?
    `).all(acc, SECRET, size);
    const last = d.prepare(`
      SELECT text, msg_type, is_self FROM messages
      WHERE account_id = ? AND thread_type = ? AND thread_id = ? AND text NOT LIKE ?
      ORDER BY timestamp_ms DESC, rowid DESC LIMIT 1
    `);
    const peer = d.prepare(`
      SELECT sender_name FROM messages
      WHERE account_id = ? AND thread_type = 0 AND thread_id = ? AND is_self = 0 AND sender_name <> ''
      ORDER BY timestamp_ms DESC LIMIT 1
    `);
    return threads.map((t) => {
      const type = Number(t.thread_type);
      const l = last.get(acc, type, t.thread_id, SECRET);
      return {
        threadId: t.thread_id, threadType: type, lastAtMs: Number(t.last_at), total: Number(t.total),
        lastText: l ? String(l.text).slice(0, 200) : '', lastMsgType: l?.msg_type || '', lastIsSelf: Boolean(l?.is_self),
        peerName: type === 0 ? (peer.get(acc, t.thread_id)?.sender_name || '') : '',
      };
    });
  }

  function getMessages(threadId, threadType, { before = null, limit } = {}) {
    const acc = account();
    if (!acc) return { messages: [], nextBefore: null };
    const size = pageSize(limit, 100, 50);
    const c = before ? parseCursor(before) : null;
    const rows = open().prepare(`
      SELECT rowid AS id, sender_name, text, msg_type, timestamp_ms, is_self FROM messages
      WHERE account_id = ? AND thread_id = ? AND thread_type = ? AND text NOT LIKE ?
        AND (timestamp_ms < ? OR (timestamp_ms = ? AND rowid < ?))
      ORDER BY timestamp_ms DESC, rowid DESC LIMIT ?
    `).all(acc, String(threadId), Number(threadType), SECRET, c?.ts ?? END, c?.ts ?? END, c?.id ?? END, size + 1);
    const page = rows.slice(0, size);
    const oldest = page[page.length - 1];
    const nextBefore = rows.length > size ? `${oldest.timestamp_ms}:${oldest.id}` : null;
    return { messages: page.reverse().map(toMessage), nextBefore };
  }

  function searchMessages(query, { before = null, limit } = {}) {
    const acc = account();
    if (!acc) return { results: [], nextBefore: null };
    const d = open();
    const size = pageSize(limit, 50, 30);
    const c = before ? parseCursor(before) : null;
    const match = folding ? SEARCH_MATCH.fold : SEARCH_MATCH.like;
    const needle = folding ? fold(query) : `%${String(query).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const rows = d.prepare(SQL.search(match)).all(acc, needle, SECRET, c?.ts ?? END, c?.ts ?? END, c?.id ?? END, size + 1);
    const page = rows.slice(0, size);
    const last = page[page.length - 1];
    return {
      results: page.map((r) => ({ ...toMessage(r), threadId: r.thread_id, threadType: Number(r.thread_type), text: String(r.text).slice(0, 300) })),
      nextBefore: rows.length > size ? `${last.timestamp_ms}:${last.id}` : null,
    };
  }

  function hasThread(threadId, threadType) {
    const acc = account();
    if (!acc) return false;
    return Boolean(open().prepare('SELECT 1 FROM messages WHERE account_id = ? AND thread_type = ? AND thread_id = ? LIMIT 1')
      .get(acc, Number(threadType), String(threadId)));
  }

  function todayStats(sinceMs) {
    const acc = account();
    if (!acc) return { received: 0, sent: 0, topGroups: [] };
    const d = open();
    const totals = d.prepare(SQL.todayTotals).get(acc, sinceMs, SECRET);
    const top = d.prepare(SQL.todayTop).all(acc, sinceMs, SECRET);
    return { received: Number(totals.received), sent: Number(totals.sent), topGroups: top.map((g) => ({ threadId: g.thread_id, count: Number(g.n) })) };
  }

  function senderNames(uids) {
    const list = [...new Set([...uids].map(String))].filter((u) => /^\d{1,32}$/.test(u)).slice(0, 200);
    const acc = account();
    if (!list.length || !acc) return new Map();
    const d = open();
    const names = new Map();
    // 1) Người từng nhắn riêng: tin mới nhất của họ trong hội thoại riêng — tra thẳng idx_messages_thread_time.
    const dm = d.prepare(`
      SELECT sender_name FROM messages
      WHERE account_id = ? AND thread_type = 0 AND thread_id = ? AND is_self = 0 AND sender_uid = thread_id AND sender_name <> ''
      ORDER BY timestamp_ms DESC LIMIT 1
    `);
    for (const uid of list) {
      const row = dm.get(acc, uid);
      if (row) names.set(uid, row.sender_name);
    }
    // 2) Còn lại (chỉ nhắn trong nhóm): chỉ xét SENDER_WINDOW_MS tính lùi từ tin mới nhất (bot tắt lâu vẫn có tên),
    // đi theo idx_messages_retention. SQLite: cột thường đi cùng MAX() lấy giá trị ở đúng dòng có MAX — tức tên mới nhất.
    const rest = list.filter((u) => !names.has(u));
    if (rest.length) {
      const newest = Number(d.prepare('SELECT MAX(timestamp_ms) AS ts FROM messages').get().ts) || 0;
      const rows = d.prepare(`
        SELECT sender_uid, sender_name, MAX(timestamp_ms) AS last_at FROM messages
        WHERE +account_id = ? AND timestamp_ms >= ? AND is_self = 0 AND sender_name <> ''
          AND sender_uid IN (${rest.map(() => '?').join(', ')})
        GROUP BY sender_uid
      `).all(acc, newest - SENDER_WINDOW_MS, ...rest);
      for (const r of rows) names.set(r.sender_uid, r.sender_name);
    }
    return names;
  }

  function listAudit({ beforeMs = END, limit = 70, failedOnly = false } = {}) {
    // Chỉ tài khoản bot đang dùng (cùng quy ước với Phiên chat), kèm dòng chưa gắn tài khoản (lỗi trước khi đăng nhập).
    const acc = account() ?? '';
    // Không chọn target_summary: cột đó có thể chứa nội dung tin (kể cả mã đăng nhập).
    const rows = open().prepare(`
      SELECT id, created_at_ms, actor_uid, actor_role, action, category, thread_id, thread_type, status, error
      FROM audit_log
      WHERE account_id IN (?, '') AND status IN ('succeeded', 'failed') AND action NOT IN ('typing', 'ack_message')
        AND (? = 0 OR status = 'failed') AND created_at_ms < ?
      ORDER BY created_at_ms DESC, id DESC LIMIT ?
    `).all(acc, failedOnly ? 1 : 0, Number(beforeMs), pageSize(limit, 300, 70));
    return rows.map((r) => ({
      id: Number(r.id), at: Number(r.created_at_ms), actorUid: r.actor_uid, actorRole: r.actor_role,
      action: r.action, category: r.category, threadId: r.thread_id,
      threadType: r.thread_type == null ? null : Number(r.thread_type),
      ok: r.status === 'succeeded', error: r.error || null,
    }));
  }

  return {
    available: () => Boolean(db) || Boolean(path && existsSync(path)),
    isReadOnly: () => Number(open().prepare('PRAGMA query_only').get().query_only) === 1,
    listConversations,
    getMessages,
    searchMessages,
    hasThread,
    todayStats,
    senderNames,
    listAudit,
    /** Gửi tay thành công → danh sách hội thoại phải hiện tin vừa gửi ngay, không chờ hết hạn đệm. */
    invalidateConversations() { convCache = null; },
    close: drop,
  };
}
