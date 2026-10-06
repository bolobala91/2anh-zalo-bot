import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { failSidecar as fail } from '../lib/route-errors.js';

export function zaloRoutes({ sidecar, activity }) {
  const r = express.Router();
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
