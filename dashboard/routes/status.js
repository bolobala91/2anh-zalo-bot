import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { startOfDayVN } from '../lib/store-reader.js';
import { fallbackName } from '../lib/thread-names.js';

export function statusRoutes({ sidecar, linker, store, threadNames, health = null, now = Date.now }) {
  // Số đo máy chủ mới nhất (đã có sẵn trong bộ nhớ, không đo thêm) cho menu và Tổng quan.
  const host = () => {
    try { const h = health?.latest?.(); return h ? { cpuPct: h.cpuPct, ramPct: h.ramPct, diskPct: h.diskPct } : null; } catch { return null; }
  };
  const r = express.Router();
  // Đọc thẳng SQLite nên vẫn có số liệu khi kết nối Zalo tắt. Tên nhóm chỉ lấy từ bộ đệm
  // (không chờ bot) để /api/status không chậm thêm khi bot treo.
  const today = () => {
    try {
      if (!store?.available()) return null;
      const s = store.todayStats(startOfDayVN(now()));
      const names = threadNames?.cached() || new Map();
      return { received: s.received, sent: s.sent, hourly: s.hourly, topGroups: s.topGroups.map((g) => ({ ...g, name: names.get(g.threadId) || fallbackName(g.threadId, 1) })) };
    } catch (err) {
      console.error('[dashboard] đọc số liệu hôm nay lỗi:', err);
      return null;
    }
  };
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
        today: today(), host: host(),
      });
    } catch (err) {
      if (err?.name !== 'SidecarDown') console.error('[dashboard] đọc trạng thái lỗi:', err);
      res.json({ ok: true, sidecar: 'down', telegramLinked, zalo: { status: 'unknown', displayName: '', listener: null, needsRelogin: false },
        assistant: 'unknown', traffic: { lastInboundAtMs: null, lastOutboundAtMs: null }, lastError: null, today: today(), host: host() });
    }
  });
  return r;
}
