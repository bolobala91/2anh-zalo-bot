// Cấu hình (spec §18.6) — chỉ Quản trị: cài đặt trong danh sách cố định (lib/settings.js) + lời chào thành viên mới
// theo nhóm (data/welcome.json của kết nối Zalo, đọc lại mỗi lần có người vào nhóm nên có hiệu lực ngay).
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';
import { readWelcomeConfig, updateWelcomeGroup } from '../../zalo-welcome.js';
import { GROUP_ID } from '../lib/permissions.js';

const show = (v) => (Array.isArray(v) ? (v.join(', ') || 'trống') : typeof v === 'boolean' ? (v ? 'bật' : 'tắt') : String(v));

export function settingsRoutes({ settings, restartFlags, activity, welcomeFile, sidecar, replyStyle }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status >= 400 && status < 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };
  const log = (req, action, detail) => { try { activity.append({ actor: req.user.username, action, detail }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); } };

  r.get('/admin/settings', ...guard, (req, res) => { try { res.json({ ok: true, settings: settings.view() }); } catch (err) { fail(res, err, 'Chưa đọc được cài đặt.'); } });
  r.put('/admin/settings', ...guard, (req, res) => {
    try {
      const mark = (cs) => { for (const c of cs) for (const target of c.restart) restartFlags.mark(target, `Cấu hình: ${c.label}`); };
      const detail = (cs) => cs.map((c) => `${c.label}: ${show(c.before)} → ${show(c.after)}`).join(' · ');
      const changes = settings.save(req.body?.values, { onApplied: mark });
      if (changes.length) log(req, 'settings_update', detail(changes));
      res.json({ ok: true, changed: changes.length, settings: settings.view() });
    } catch (err) {
      if (err?.partial) {
        log(req, 'settings_update', `(lưu dở dang) ${err.applied.map((c) => `${c.label}: ${show(c.before)} → ${show(c.after)}`).join(' · ')}`);
        return res.status(500).json({ ok: false, error: err.message });
      }
      fail(res, err, 'Chưa lưu được cài đặt — thử lại, nếu vẫn lỗi hãy báo người cài đặt.');
    }
  });

  // Phong cách trả lời: tệp plugin đọc lại mỗi lượt — có hiệu lực ngay từ tin kế tiếp.
  if (replyStyle) {
    r.get('/admin/reply-style', ...guard, (req, res) => { try { res.json({ ok: true, style: replyStyle.view() }); } catch (err) { fail(res, err, 'Chưa đọc được phong cách trả lời.'); } });
    r.put('/admin/reply-style', ...guard, (req, res) => {
      try {
        const { before, after } = replyStyle.save(req.body?.values);
        const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
        if (changed.length) log(req, 'reply_style_update', changed.map((k) => `${k}: ${show(before[k])} → ${show(after[k])}`).join(' · '));
        res.json({ ok: true, style: after });
      } catch (err) { fail(res, err, 'Chưa lưu được phong cách trả lời — thử lại.'); }
    });
  }

  r.get('/admin/welcome', ...guard, async (req, res) => {
    try {
      const conf = readWelcomeConfig(welcomeFile).groups || {};
      let groups = [];
      try { groups = await sidecar.groups(); } catch { /* chỉ hiện nhóm đã có cấu hình */ }
      const ids = [...new Set([...groups.map((g) => String(g.id ?? '')), ...Object.keys(conf)])].filter((id) => GROUP_ID.test(id));
      const name = (id) => groups.find((g) => String(g.id) === id)?.name || conf[id]?.name || `Nhóm ${id.slice(-4)}`;
      res.json({ ok: true, groups: ids.map((id) => ({ id, name: name(id), enabled: Boolean(conf[id]?.enabled), message: conf[id]?.message || '',
        batchSize: conf[id]?.batchSize ?? 5, maxWaitMinutes: conf[id]?.maxWaitMinutes ?? 15 })) });
    } catch (err) { fail(res, err, 'Chưa đọc được lời chào.'); }
  });
  r.put('/admin/welcome/:groupId', ...guard, (req, res) => {
    const { groupId } = req.params;
    if (!GROUP_ID.test(groupId)) return res.status(400).json({ ok: false, error: 'Nhóm không hợp lệ — chọn lại.' });
    const b = req.body || {};
    if (typeof b.enabled !== 'boolean' || typeof b.message !== 'string' || b.message.length > 1500
      || !Number.isInteger(b.batchSize) || b.batchSize < 1 || b.batchSize > 20 || !Number.isInteger(b.maxWaitMinutes) || b.maxWaitMinutes < 1 || b.maxWaitMinutes > 1440) {
      return res.status(400).json({ ok: false, error: 'Lời chào ≤ 1500 ký tự, gom 1–20 người, chờ 1–1440 phút — sửa lại rồi lưu.' });
    }
    try {
      const g = updateWelcomeGroup(groupId, { enabled: b.enabled, message: b.message, name: String(b.name || '').slice(0, 200), batchSize: b.batchSize, maxWaitMinutes: b.maxWaitMinutes }, welcomeFile);
      log(req, 'welcome_update', `${b.name || groupId}: ${g.enabled ? 'bật' : 'tắt'}`);
      res.json({ ok: true, group: g });
    } catch (err) {
      if (/Cần nội dung/.test(err?.message)) return res.status(400).json({ ok: false, error: 'Cần nội dung lời chào trước khi bật.' });
      fail(res, err, 'Chưa lưu được lời chào.');
    }
  });
  return r;
}
