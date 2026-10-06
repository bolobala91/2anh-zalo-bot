import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';

export function adminRoutes({ users, sessions, activity, restartAssistant }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  // Cùng quy ước với routes/zalo.js: chỉ lộ err.message khi lỗi có statusCode 4xx rõ ràng.
  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status >= 400 && status < 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };
  const bad = (m) => Object.assign(new Error(m), { statusCode: 400 });

  r.get('/admin/users', ...guard, (req, res) => res.json({ ok: true, users: users.list() }));

  r.post('/admin/users', ...guard, (req, res) => {
    try {
      const u = users.create(req.body || {});
      activity.append({ actor: req.user.username, action: 'user_create', detail: `${u.username} (${u.role})` });
      res.json({ ok: true, user: u });
    } catch (err) { fail(res, err, 'Chưa tạo được tài khoản — thử lại, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });

  r.patch('/admin/users/:username', ...guard, (req, res) => {
    try {
      const target = String(req.params.username || '').trim().toLowerCase();
      const { role, zaloUid, disabled, password } = req.body || {};
      const locks = disabled === true || (role !== undefined && role !== 'admin');
      if (target === req.user.username && locks) throw bad('Không thể tự khoá/hạ quyền tài khoản đang dùng');
      const current = users.get(target);
      if (!current) throw Object.assign(new Error('Không có người dùng này — tải lại danh sách rồi thử lại.'), { statusCode: 404 });
      if (locks && current.role === 'admin' && !current.disabled
        && users.list().filter((u) => u.role === 'admin' && !u.disabled).length <= 1) {
        throw bad('Phải còn ít nhất một Quản trị đang hoạt động — tạo Quản trị khác trước rồi thử lại.');
      }
      const u = users.update(target, { role, zaloUid, disabled });
      if (password) users.setPassword(target, password);
      if (disabled === true || password) sessions.destroyAll(target);
      activity.append({ actor: req.user.username, action: 'user_update', detail: target });
      res.json({ ok: true, user: users.list().find((x) => x.username === target) || u });
    } catch (err) { fail(res, err, 'Chưa cập nhật được tài khoản — thử lại, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });

  r.post('/admin/restart-assistant', ...guard, async (req, res) => {
    try {
      await restartAssistant();
      activity.append({ actor: req.user.username, action: 'restart_assistant' });
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'Chưa khởi động lại được trợ lý — thử lại sau ít phút, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });
  return r;
}
