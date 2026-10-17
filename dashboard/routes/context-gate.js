import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';

export function contextGateRoutes({ contextGate }) {
  const r = express.Router();
  r.get('/context-gate/summary', requireAuth, requireRole('admin'), (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json({ ok: true, ...contextGate.summary() }); }
    catch { res.status(503).json({ ok: false, error: 'Chưa đọc được thống kê — thử lại sau.' }); }
  });
  r.post('/chats/:threadId/context-gate/:eventId/feedback', requireAuth, requireRole('admin'), (req, res) => {
    const { threadId, eventId } = req.params;
    if (!/^\d{1,32}$/.test(threadId) || !/^[a-f0-9]{32}$/.test(eventId)
        || !req.body || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'verdict')) {
      return res.status(400).json({ ok: false, error: 'Đánh giá không hợp lệ — tải lại bảng rồi thử lại.' });
    }
    try { res.json({ ok: true, verdict: contextGate.feedback(threadId, eventId, req.body.verdict) }); }
    catch (err) {
      const status = [400, 404].includes(err.statusCode) ? err.statusCode : 503;
      res.status(status).json({ ok: false, error: status === 503 ? 'Chưa lưu được đánh giá — thử lại sau.' : err.message });
    }
  });
  r.get('/chats/:threadId/context-gate', requireAuth, requireRole('admin'), (req, res) => {
    const filter = req.query.filter || 'all';
    if (!/^\d{1,32}$/.test(req.params.threadId) || !['all', 'ignore', 'errors'].includes(filter)) {
      return res.status(400).json({ ok: false, error: 'Bộ lọc không hợp lệ — chọn lại hội thoại và bộ lọc.' });
    }
    res.set('Cache-Control', 'no-store');
    try { return res.json({ ok: true, ...contextGate.list(req.params.threadId, filter) }); }
    catch { return res.status(503).json({ ok: false, error: 'Chưa đọc được quyết định ngữ cảnh — thử lại sau.' }); }
  });
  return r;
}
