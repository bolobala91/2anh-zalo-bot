import express from 'express';
import { requireAuth } from '../lib/http-guards.js';

export function statusRoutes({ sidecar, linker }) {
  const r = express.Router();
  r.get('/status', requireAuth, async (req, res) => {
    const telegramLinked = Boolean(linker?.isLinked(req.user.username));
    try {
      const h = await sidecar.health();
      res.json({
        ok: true, sidecar: 'up', telegramLinked,
        zalo: { status: h?.zalo?.status || 'idle', displayName: h?.zalo?.displayName || '', listener: h?.zalo?.listener || null, needsRelogin: Boolean(h?.zalo?.needsRelogin) },
        assistant: (h?.bridge?.attachedClients || 0) > 0 ? 'connected' : 'disconnected',
        traffic: { lastInboundAtMs: h?.traffic?.lastInboundAtMs || null, lastOutboundAtMs: h?.traffic?.lastOutboundAtMs || null },
        lastError: h?.lastError ? { code: h.lastError.code ?? null, message: h.lastError.message ?? '', atMs: h.lastError.atMs ?? null } : null,
      });
    } catch (err) {
      if (err?.name !== 'SidecarDown') console.error('[dashboard] đọc trạng thái lỗi:', err);
      res.json({ ok: true, sidecar: 'down', telegramLinked, zalo: { status: 'unknown', displayName: '', listener: null, needsRelogin: false },
        assistant: 'unknown', traffic: { lastInboundAtMs: null, lastOutboundAtMs: null }, lastError: null });
    }
  });
  return r;
}
