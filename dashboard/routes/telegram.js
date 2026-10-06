import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';

export function telegramRoutes({ linker, activity }) {
  const r = express.Router();
  // Cùng quy ước với routes/zalo.js: chỉ lộ err.message khi lỗi có statusCode 4xx rõ ràng.
  const fail = (res, err) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status >= 400 && status < 500 && status !== 401 && status !== 403) return res.status(status).json({ ok: false, error: err.message });
    // Chỉ log tên lỗi và message đã được lib làm sạch; không log URL/token của Telegram.
    console.error('[dashboard] telegram:', err?.message);
    return res.status(502).json({ ok: false, error: 'Telegram chưa phản hồi đúng — thử lại sau ít phút, nếu vẫn lỗi hãy báo người cài đặt.' });
  };
  r.post('/telegram/link', requireAuth, (req, res) => {
    try { res.json({ ok: true, url: linker.linkUrl(req.user.username) }); } catch (err) { fail(res, err); }
  });
  r.post('/telegram/test', requireAuth, async (req, res) => {
    if (!linker.isLinked(req.user.username)) return res.status(409).json({ ok: false, error: 'Bạn chưa nối Telegram — bấm "Nối Telegram của tôi" trước.' });
    try { await linker.sendTo(req.user.username, '✅ Tin thử từ dashboard — cảnh báo đang hoạt động.'); res.json({ ok: true }); } catch (err) { fail(res, err); }
  });
  r.get('/admin/telegram', requireAuth, requireRole('admin'), (req, res) => res.json({ ok: true, ...linker.settings() }));
  r.put('/admin/telegram', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const out = req.body?.token ? await linker.setToken(req.body.token) : (linker.clearToken(), {});
      activity.append({ actor: req.user.username, action: 'telegram_settings', detail: out.botUsername ? `@${out.botUsername}` : 'gỡ bot' });
      res.json({ ok: true, ...linker.settings() });
    } catch (err) { fail(res, err); }
  });
  return r;
}
