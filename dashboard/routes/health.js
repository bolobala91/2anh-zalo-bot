// Sức khoẻ máy chủ (spec §16.B): Quản trị và Chủ bot đều xem; tên dịch vụ hệ thống, cổng, PID chỉ Quản trị thấy.
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { HOST_OFF_PCT, HOST_ON_PCT } from '../lib/watchdog.js';

const HOST_KINDS = ['disk', 'ram', 'cpu'];

export function healthRoutes({ health, watchdog }) {
  const r = express.Router();
  r.get('/server-health', requireAuth, async (req, res) => {
    const admin = req.user.role === 'admin';
    let services = [];
    let servicesError = false;
    try { services = await health.services(); } catch (err) {
      console.error('[dashboard] đọc trạng thái dịch vụ lỗi:', err);
      servicesError = true;
    }
    const incidents = watchdog?.incidents() || {};
    res.json({
      ok: true,
      host: health.latest(),
      history: { stepMs: 60_000, points: health.points() },
      services: services.map((s) => (admin ? s : { id: s.id, label: s.label, state: s.state })),
      servicesError,
      usage: health.usage(),
      alerts: HOST_KINDS.filter((k) => incidents[k]).map((k) => ({ kind: k, since: incidents[k].since, alerted: Boolean(incidents[k].alertedAt) })),
      threshold: { on: HOST_ON_PCT, off: HOST_OFF_PCT },
    });
  });
  return r;
}
