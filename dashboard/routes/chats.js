import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { parseCursor } from '../lib/store-reader.js';
import { fallbackName } from '../lib/thread-names.js';
import { failSidecar, failStore } from '../lib/route-errors.js';

const THREAD_ID = /^\d{1,32}$/;
const MAX_TEXT = 2000;
const DUP_MS = 30_000;
const DUP_MAX = 1000;
const READ_FAIL = 'Chưa đọc được lịch sử trò chuyện — tải lại trang, nếu vẫn lỗi hãy báo người cài đặt.';
const BAD_THREAD = 'Hội thoại không hợp lệ — chọn lại từ danh sách.';
const BAD_CURSOR = 'Vị trí trang không hợp lệ — tải lại trang rồi thử lại.';

export const parseType = (v) => (v === 0 || v === '0' ? 0 : v === 1 || v === '1' ? 1 : null);
const cursorOk = (v) => v === undefined || v === '' || (typeof v === 'string' && parseCursor(v) !== null);

export function chatRoutes({ store, sidecar, threadNames, sendLimit = { max: 10, windowMs: 60_000 }, now = Date.now }) {
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
    if (q.length < 2 || q.length > 100) return bad(res, 'Từ khoá cần 2–100 ký tự — sửa lại rồi tìm.');
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
    if (!cursorOk(req.query.before)) return bad(res, BAD_CURSOR);
    try {
      res.json({ ok: true, ...store.getMessages(req.params.threadId, type, { before: req.query.before || null }) });
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

  r.post('/chats/:threadId/send', requireAuth, async (req, res) => {
    const { text, threadType } = req.body || {};
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
      await sidecar.send({ threadId: req.params.threadId, threadType: type, text: body, actor: req.user.username });
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
