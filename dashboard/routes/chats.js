import express from 'express';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireAuth } from '../lib/http-guards.js';
import { parseCursor } from '../lib/store-reader.js';
import { fallbackName } from '../lib/thread-names.js';
import { failSidecar, failStore } from '../lib/route-errors.js';

const THREAD_ID = /^\d{1,32}$/;
const MAX_TEXT = 2000;
// Ảnh/tệp gửi tay từ Phiên chat: tối đa 25 MB, chỉ các loại thường dùng (không gửi tệp chạy được).
export const MAX_SEND_FILE = 25 * 1024 * 1024;
export const SEND_FILE_TYPES = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'zip', 'rar', '7z', 'mp3', 'm4a', 'wav', 'mp4', 'mov'];
/** Tên tệp an toàn để đặt trên đĩa: bỏ đường dẫn, ký tự lạ; đuôi phải nằm trong danh sách. Sai → ''. */
export function safeSendName(raw) {
  const base = String(raw ?? '').split(/[\\/]/).pop().normalize('NFC').replace(/[\u0000-\u001f<>:"|?*]/g, '').trim().slice(-120);
  const m = /^(.*)\.([A-Za-z0-9]{1,5})$/.exec(base);
  if (!m || !SEND_FILE_TYPES.includes(m[2].toLowerCase())) return '';
  return `${m[1].replace(/^[.\s]+/, '').trim() || 'tep'}.${m[2].toLowerCase()}`;
}
const DUP_MS = 30_000;
const DUP_MAX = 1000;
const READ_FAIL = 'Chưa đọc được lịch sử trò chuyện — tải lại trang, nếu vẫn lỗi hãy báo người cài đặt.';
const BAD_THREAD = 'Hội thoại không hợp lệ — chọn lại từ danh sách.';
const BAD_CURSOR = 'Vị trí trang không hợp lệ — tải lại trang rồi thử lại.';
const BAD_QUERY = 'Từ khoá cần 2–100 ký tự — sửa lại rồi tìm.';
const MEDIA_KINDS = ['photo', 'file', 'link'];

export const parseType = (v) => (v === 0 || v === '0' ? 0 : v === 1 || v === '1' ? 1 : null);
const cursorOk = (v) => v === undefined || v === '' || (typeof v === 'string' && parseCursor(v) !== null);

export function chatRoutes({ store, sidecar, threadNames, outboxDir = null, sendLimit = { max: 10, windowMs: 60_000 }, now = Date.now }) {
  const r = express.Router();
  const bad = (res, error) => res.status(400).json({ ok: false, error });
  const nameOf = (groups, id, type, peerName = '') => (type === 1 ? groups.get(id) : peerName) || fallbackName(id, type);

  r.get('/chats', requireAuth, async (req, res) => {
    try {
      if (!store.available()) return res.json({ ok: true, conversations: [], unavailable: true });
      const list = store.listConversations();
      const groups = await threadNames.load();
      res.json({ ok: true, conversations: list.map(({ peerName, ...c }) => ({ ...c, name: nameOf(groups, c.threadId, c.threadType, peerName) })) });
    } catch (err) { failStore(res, err, READ_FAIL); }
  });

  r.get('/chats/search', requireAuth, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2 || q.length > 100) return bad(res, BAD_QUERY);
    if (!cursorOk(req.query.before)) return bad(res, BAD_CURSOR);
    try {
      const { results, nextBefore } = store.searchMessages(q, { before: req.query.before || null });
      const groups = await threadNames.load();
      const peers = store.senderNames(results.filter((x) => x.threadType === 0).map((x) => x.threadId));
      res.json({
        ok: true, nextBefore,
        results: results.map((x) => ({ ...x, threadName: nameOf(groups, x.threadId, x.threadType, peers.get(x.threadId)) })),
      });
    } catch (err) { failStore(res, err, READ_FAIL); }
  });

  r.get('/chats/:threadId/messages', requireAuth, (req, res) => {
    const type = parseType(req.query.type);
    if (!THREAD_ID.test(req.params.threadId) || type === null) return bad(res, BAD_THREAD);
    const { before, around, after } = req.query;
    if (![before, around, after].every(cursorOk)) return bad(res, BAD_CURSOR);
    if ([before, around, after].filter(Boolean).length > 1) return bad(res, BAD_CURSOR);
    const id = req.params.threadId;
    try {
      if (around) return res.json({ ok: true, ...store.getMessagesAround(id, type, around) });
      if (after) return res.json({ ok: true, ...store.getMessagesAfter(id, type, after) });
      res.json({ ok: true, ...store.getMessages(id, type, { before: before || null }) });
    } catch (err) { failStore(res, err, READ_FAIL); }
  });

  r.get('/chats/:threadId/search', requireAuth, (req, res) => {
    const type = parseType(req.query.type);
    if (!THREAD_ID.test(req.params.threadId) || type === null) return bad(res, BAD_THREAD);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2 || q.length > 100) return bad(res, BAD_QUERY);
    if (!cursorOk(req.query.before)) return bad(res, BAD_CURSOR);
    try {
      res.json({ ok: true, ...store.searchThread(req.params.threadId, type, q, { before: req.query.before || null }) });
    } catch (err) { failStore(res, err, READ_FAIL); }
  });

  r.get('/chats/:threadId/media', requireAuth, (req, res) => {
    const type = parseType(req.query.type);
    if (!THREAD_ID.test(req.params.threadId) || type === null) return bad(res, BAD_THREAD);
    if (!MEDIA_KINDS.includes(req.query.kind)) return bad(res, 'Loại mục không hợp lệ — chọn lại thẻ Ảnh/Video, Tệp hoặc Link.');
    if (!cursorOk(req.query.before)) return bad(res, BAD_CURSOR);
    try {
      res.json({ ok: true, ...store.listMedia(req.params.threadId, type, req.query.kind, { before: req.query.before || null }) });
    } catch (err) { failStore(res, err, READ_FAIL); }
  });

  // Gửi tay đi qua sendSystemNotice của bot — đường này không qua bộ giãn nhịp của trợ lý,
  // nên dashboard tự chặn: mỗi người tối đa sendLimit.max tin trong sendLimit.windowMs.
  const recent = new Map(); // username → mốc thời gian các lần gửi còn trong cửa sổ
  function allowSend(username) {
    const t = now();
    const kept = (recent.get(username) || []).filter((x) => t - x < sendLimit.windowMs);
    const ok = kept.length < sendLimit.max;
    if (ok) kept.push(t);
    recent.set(username, kept);
    return ok;
  }

  // Chống gửi trùng: cùng người, cùng hội thoại, cùng nội dung trong DUP_MS sau một lần đã gửi được
  // hoặc chưa rõ kết quả (quá hạn chờ) → 409. Lần đang gửi dở cũng tính, để bấm đúp không thành hai tin.
  const lastSends = new Map(); // khoá → mốc thời gian; Map giữ thứ tự chèn nên phần tử đầu là cũ nhất
  const sendKey = (username, threadId, type, body) => JSON.stringify([username, type, threadId, body]);
  function pruneSends(t) {
    for (const [k, at] of lastSends) {
      if (t - at < DUP_MS && lastSends.size <= DUP_MAX) break;
      lastSends.delete(k);
    }
  }

  // Thành viên nhóm cho ô gợi ý @ (chỉ nhóm có trong lịch sử). UID ra trình duyệt chỉ ở đây — cần để gắn tag Zalo.
  r.get('/chats/:threadId/members', requireAuth, async (req, res) => {
    if (!THREAD_ID.test(req.params.threadId)) return bad(res, BAD_THREAD);
    try {
      if (!store.hasThread(req.params.threadId, 1)) return res.status(404).json({ ok: false, error: 'Không thấy nhóm này trong lịch sử.' });
    } catch (err) { return failStore(res, err, READ_FAIL); }
    try {
      const { total, members } = await sidecar.groupMembers(req.params.threadId);
      res.json({ ok: true, total, members: members.map((m) => ({ uid: String(m.id), name: String(m.displayName) })) });
    } catch (err) { failSidecar(res, err); }
  });

  // Gửi ảnh/tệp dưới tên bot (dán ảnh, kéo thả, nút đính kèm ở Phiên chat): thân nhị phân + X-File-Name, ?type=0|1.
  // Đặt tạm vào outbox (bot chỉ nhận tệp trong đó), gửi xong thì xoá. Chung hạn mức gửi tay với tin chữ.
  r.post('/chats/:threadId/send-file', requireAuth, express.raw({ type: 'application/octet-stream', limit: MAX_SEND_FILE }), async (req, res) => {
    const type = parseType(req.query.type);
    if (!THREAD_ID.test(req.params.threadId) || type === null) return bad(res, BAD_THREAD);
    if (!outboxDir) return res.status(503).json({ ok: false, error: 'Máy này chưa bật gửi tệp từ dashboard.' });
    let raw = '';
    try { raw = decodeURIComponent(String(req.get('x-file-name') || '')); } catch { /* tên hỏng */ }
    const name = safeSendName(raw);
    if (!name) return bad(res, `Chỉ gửi được ảnh, tài liệu, tệp nén, âm thanh, video (${SEND_FILE_TYPES.join(', ')}).`);
    if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 'Chưa nhận được tệp — chọn lại tệp.');
    try {
      if (!store.hasThread(req.params.threadId, type)) return res.status(404).json({ ok: false, error: 'Không thấy hội thoại này trong lịch sử — chọn lại từ danh sách.' });
    } catch (err) { return failStore(res, err, READ_FAIL); }
    if (!allowSend(req.user.username)) return res.status(429).json({ ok: false, error: 'Bạn đang gửi quá nhanh — đợi một phút rồi gửi tiếp.' });
    const dir = join(outboxDir, randomBytes(8).toString('hex'));
    try {
      mkdirSync(dir, { recursive: true });
      const path = join(dir, name);
      writeFileSync(path, req.body, { mode: 0o600 });
      await sidecar.sendFile({ threadId: req.params.threadId, threadType: type, path, actor: req.user.username });
      store.invalidateConversations?.();
      res.json({ ok: true, name });
    } catch (err) { failSidecar(res, err); } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // Thu hồi một tin của bot (theo rowid trong đúng hội thoại). Tin người khác → 400; ghi Nhật ký Zalo kèm tên người bấm.
  r.post('/chats/:threadId/recall', requireAuth, async (req, res) => {
    const type = parseType(req.body?.threadType);
    if (!THREAD_ID.test(req.params.threadId) || type === null) return bad(res, BAD_THREAD);
    let ref;
    try { ref = store.messageRef(req.params.threadId, type, req.body?.msg); } catch (err) { return failStore(res, err, READ_FAIL); }
    if (!ref || !ref.isSelf) return bad(res, 'Chỉ thu hồi được tin do bot gửi.');
    if (!ref.cliMsgId) return bad(res, 'Tin này thiếu mã Zalo (tin cũ nhập từ lịch sử) — không thu hồi được.');
    try {
      await sidecar.recall({ threadId: req.params.threadId, threadType: type, msgId: ref.msgId, cliMsgId: ref.cliMsgId, actor: req.user.username });
      store.invalidateConversations?.();
      res.json({ ok: true });
    } catch (err) {
      // Zalo từ chối thu hồi (thường do tin đã quá hạn thu hồi) → câu dễ hiểu thay vì "Zalo chưa phản hồi đúng".
      if (err?.statusCode === 502 && !/^Zalo chưa đăng nhập$/.test(String(err.message))) {
        console.error('[dashboard] thu hồi tin lỗi:', err.message);
        return res.status(422).json({ ok: false, error: 'Zalo không cho thu hồi tin này — có thể tin đã quá thời hạn thu hồi.' });
      }
      failSidecar(res, err);
    }
  });

  r.post('/chats/:threadId/send', requireAuth, async (req, res) => {
    const { text, threadType, replyTo, mentions } = req.body || {};
    const type = parseType(threadType);
    if (!THREAD_ID.test(req.params.threadId) || type === null) return bad(res, BAD_THREAD);
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body) return bad(res, 'Nội dung đang trống — gõ tin nhắn rồi gửi.');
    if (body.length > MAX_TEXT) return bad(res, `Tin nhắn dài quá ${MAX_TEXT} ký tự — rút gọn hoặc chia làm nhiều tin.`);
    try {
      if (!store.hasThread(req.params.threadId, type)) {
        return res.status(404).json({ ok: false, error: 'Không thấy hội thoại này trong lịch sử — chọn lại từ danh sách.' });
      }
    } catch (err) { return failStore(res, err, READ_FAIL); }
    // Trả lời: tra tin gốc trong kho theo rowid (đúng hội thoại) → trích dẫn; UID người gửi chỉ đi máy chủ → sidecar.
    let quote = null;
    if (replyTo != null) {
      let ref;
      try { ref = store.messageRef(req.params.threadId, type, replyTo); } catch (err) { return failStore(res, err, READ_FAIL); }
      if (!ref) return bad(res, 'Tin được trả lời không còn hoặc quá cũ để trích dẫn — bỏ trả lời rồi gửi lại.');
      quote = { msgId: ref.msgId, cliMsgId: ref.cliMsgId, uidFrom: ref.senderUid, content: ref.text.slice(0, 2000), ts: ref.ts, isSelf: ref.isSelf };
    }
    // Tag: { uid, pos, len } trên đúng nội dung gửi (đã cắt khoảng trắng). Tag theo tin ({ msg: rowid }) → UID tra ở máy chủ.
    let tags = null;
    if (Array.isArray(mentions) && mentions.length) {
      if (type !== 1 || mentions.length > 30) return bad(res, 'Chỉ gắn tag được trong nhóm (tối đa 30 người).');
      tags = [];
      for (const m of mentions) {
        let uid = typeof m?.uid === 'string' ? m.uid : '';
        if (!uid && m?.msg != null) {
          let ref;
          try { ref = store.messageRef(req.params.threadId, type, m.msg); } catch (err) { return failStore(res, err, READ_FAIL); }
          uid = ref && !ref.isSelf ? ref.senderUid : '';
        }
        const pos = Number(m?.pos); const len = Number(m?.len);
        if (!/^\d{1,40}$/.test(uid) || !Number.isInteger(pos) || !Number.isInteger(len) || pos < 0 || len < 2 || pos + len > body.length || body[pos] !== '@') {
          return bad(res, 'Có tên được nhắc (@) không hợp lệ — xoá rồi chọn lại từ danh sách.');
        }
        tags.push({ uid, pos, len });
      }
    }
    const key = sendKey(req.user.username, req.params.threadId, type, body);
    pruneSends(now());
    if (lastSends.has(key)) {
      return res.status(409).json({ ok: false, error: 'Tin này vừa được gửi — kiểm tra khung tin trước khi gửi lại.' });
    }
    if (!allowSend(req.user.username)) {
      return res.status(429).json({ ok: false, error: 'Bạn đang gửi quá nhanh — đợi một phút rồi gửi tiếp.' });
    }
    lastSends.set(key, now());
    try {
      await sidecar.send({ threadId: req.params.threadId, threadType: type, text: body, actor: req.user.username, ...(quote ? { quote } : {}), ...(tags ? { mentions: tags } : {}) });
      lastSends.delete(key); lastSends.set(key, now()); // tính 30 s từ lúc gửi xong
      store.invalidateConversations?.();
      res.json({ ok: true });
    } catch (err) {
      if (err?.name === 'SidecarTimeout') { lastSends.delete(key); lastSends.set(key, now()); } else lastSends.delete(key);
      failSidecar(res, err);
    }
  });

  return r;
}
