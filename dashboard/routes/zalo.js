import express from 'express';
import { requireAuth } from '../lib/http-guards.js';

export function zaloRoutes({ sidecar, activity }) {
  const r = express.Router();
  // Cùng quy ước với routes/auth.js: chỉ lộ err.message khi lỗi có statusCode 4xx rõ ràng.
  const fail = (res, err) => {
    if (err?.name === 'SidecarDown') {
      return res.status(503).json({ ok: false, error: 'Kết nối Zalo đang tắt — đợi 1–2 phút để hệ thống tự bật lại, hoặc báo người cài đặt.' });
    }
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    // 401/403 từ bot là lỗi khoá kết nối nội bộ — không được để trình duyệt thấy (sẽ bị hiểu là hết phiên đăng nhập).
    if (status >= 400 && status < 500 && status !== 401 && status !== 403) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    if (status === 401 || status === 403) {
      return res.status(502).json({ ok: false, error: 'Dashboard chưa kết nối được với bot (sai khoá kết nối). Hãy chạy lại trình cài đặt hoặc báo người cài đặt.' });
    }
    return res.status(502).json({ ok: false, error: 'Zalo chưa phản hồi đúng — thử lại sau ít phút, nếu vẫn lỗi hãy báo người cài đặt.' });
  };
  r.post('/zalo/qr/start', requireAuth, async (req, res) => {
    try { await sidecar.qrStart(); activity.append({ actor: req.user.username, action: 'zalo_qr_start' }); res.json({ ok: true }); } catch (err) { fail(res, err); }
  });
  r.get('/zalo/qr', requireAuth, async (req, res) => {
    try { res.json({ ok: true, ...(await sidecar.qr()) }); } catch (err) { fail(res, err); }
  });
  r.post('/zalo/logout', requireAuth, async (req, res) => {
    try { await sidecar.logout(); activity.append({ actor: req.user.username, action: 'zalo_logout' }); res.json({ ok: true }); } catch (err) { fail(res, err); }
  });
  return r;
}
