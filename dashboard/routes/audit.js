import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { createAuditFeed } from '../lib/audit-feed.js';
import { failStore } from '../lib/route-errors.js';

export function auditRoutes({ store, activity, threadNames, users }) {
  const r = express.Router();
  const feed = createAuditFeed({ store, activity, threadNames, isUser: (name) => Boolean(users.get(String(name))) });
  r.get('/audit', requireAuth, async (req, res) => {
    const status = req.query.status ?? '';
    const before = req.query.before ?? '';
    if (status !== '' && status !== 'failed') return res.status(400).json({ ok: false, error: 'Bộ lọc không hợp lệ — tải lại trang rồi thử lại.' });
    if (before !== '' && !(typeof before === 'string' && /^\d{1,16}$/.test(before))) {
      return res.status(400).json({ ok: false, error: 'Vị trí trang không hợp lệ — tải lại trang rồi thử lại.' });
    }
    try {
      res.json({ ok: true, ...(await feed.list({
        role: req.user.role,
        beforeMs: before ? Number(before) : Number.MAX_SAFE_INTEGER,
        failedOnly: status === 'failed',
      })) });
    } catch (err) { failStore(res, err, 'Chưa đọc được nhật ký — tải lại trang, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });
  return r;
}
