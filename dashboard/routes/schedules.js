// Lịch hẹn (spec §18.4) — cả hai vai trò. Việc hẹn giờ: lệnh `hermes cron` (ghi Nhật ký dashboard). Lời nhắc Zalo:
// qua kết nối Zalo (ghi audit_log ở đó). Tên nhóm lấy từ danh bạ nhóm như Phiên chat.
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { CRON_ACTIONS, JOB_ID, parseJobInput } from '../lib/schedules.js';
import { fallbackName } from '../lib/thread-names.js';
import { failSidecar } from '../lib/route-errors.js';

const ACTION_LOG = { pause: 'cron_pause', resume: 'cron_resume', remove: 'cron_remove' };
/** Trần số mục mỗi lệnh hàng loạt; mã lời nhắc cùng luật với kết nối Zalo (zalo-directory.js). */
export const MAX_BULK = 100;
const REMINDER_ID = /^[\w-]{1,64}$/;

export function scheduleRoutes({ schedules, sidecar, threadNames, activity }) {
  const r = express.Router();

  r.get('/schedules', requireAuth, async (req, res) => {
    let jobs = []; let cronError = '';
    try { jobs = schedules.list(); } catch (err) {
      console.error('[dashboard] đọc jobs.json lỗi:', err?.message || err);
      cronError = 'Chưa đọc được danh sách việc hẹn giờ của trợ lý — thử lại sau ít phút.';
    }
    let names = new Map();
    try { names = await threadNames.load(); } catch { /* không có tên nhóm: dùng tên dự phòng */ }
    const nameOf = (id, kind) => names.get(id) || fallbackName(id, kind === 'group' ? 1 : 0);
    res.json({ ok: true, cronError, jobs: jobs.map((j) => {
      const targetNames = (Array.isArray(j.targets) && j.targets.length ? j.targets : [j.target]).filter(Boolean).map((t) => nameOf(t, j.kind));
      // Thẻ ngắn: "Nhóm A + 2 nơi" khi gửi nhiều nơi.
      return { ...j, targetNames, targetName: targetNames.length > 1 ? `${targetNames[0]} + ${targetNames.length - 1} nơi` : targetNames[0] || nameOf(j.target, j.kind) };
    }) });
  });

  // Tạo / sửa bằng lời thường (spec) — cả hai vai trò; lịch cron gốc (expr) chỉ Quản trị.
  const saveFail = (res, err) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status === 500) console.error('[dashboard]', err);
    res.status(status).json({ ok: false, error: status === 500 ? 'Lỗi bên trong dashboard — xem nhật ký dịch vụ.' : err.message });
  };
  r.post('/schedules/cron', requireAuth, async (req, res) => {
    try {
      const input = parseJobInput(req.body, { admin: req.user.role === 'admin' });
      const job = await schedules.create(input);
      try { activity.append({ actor: req.user.username, action: 'cron_create', detail: job.name }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
      res.json({ ok: true, id: job.id });
    } catch (err) { saveFail(res, err); }
  });
  r.put('/schedules/cron/:id', requireAuth, async (req, res) => {
    try {
      const input = parseJobInput(req.body, { admin: req.user.role === 'admin', partial: true });
      const job = await schedules.update(String(req.params.id), input);
      try { activity.append({ actor: req.user.username, action: 'cron_edit', detail: job.name }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
      res.json({ ok: true });
    } catch (err) { saveFail(res, err); }
  });

  r.post('/schedules/cron/:id/:action', requireAuth, async (req, res) => {
    const { id, action } = req.params;
    if (!CRON_ACTIONS.includes(action)) return res.status(400).json({ ok: false, error: 'Thao tác không hợp lệ — tải lại trang.' });
    try {
      const job = await schedules.cron(action, id);
      try { activity.append({ actor: req.user.username, action: ACTION_LOG[action], detail: job.name || id }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
      res.json({ ok: true });
    } catch (err) {
      const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      try { activity.append({ actor: req.user.username, action: ACTION_LOG[action], detail: id, ok: false }); } catch { /* bỏ qua */ }
      res.status(status).json({ ok: false, error: status === 500 ? 'Lỗi bên trong dashboard — xem nhật ký dịch vụ.' : err.message });
    }
  });

  /** Nhiều việc một lần: `{ action, ids: [...] }` — kiểm hết mã trước, chạy lần lượt, trả `{ done, failed }`; một dòng Nhật ký. */
  r.post('/schedules/cron/bulk', requireAuth, async (req, res) => {
    const { action, ids } = req.body || {};
    if (!CRON_ACTIONS.includes(action)) return res.status(400).json({ ok: false, error: 'Thao tác không hợp lệ — tải lại trang.' });
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BULK) return res.status(400).json({ ok: false, error: `Chọn từ 1 đến ${MAX_BULK} việc.` });
    const list = [...new Set(ids.map(String))];
    if (!list.every((id) => JOB_ID.test(id))) return res.status(400).json({ ok: false, error: 'Danh sách chọn không hợp lệ — tải lại trang.' });
    const done = []; const failed = [];
    for (const id of list) {
      try { const job = await schedules.cron(action, id); done.push({ id, name: job.name || '' }); } catch (err) {
        const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
        if (status === 500) console.error('[dashboard]', err);
        failed.push({ id, error: status === 500 ? 'Lỗi bên trong dashboard' : err.message });
      }
    }
    try {
      activity.append({ actor: req.user.username, action: ACTION_LOG[action], detail: `${done.length}/${list.length} việc`, ...(done.length ? {} : { ok: false }) });
    } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
    res.json({ ok: true, done, failed });
  });

  r.get('/schedules/reminders', requireAuth, async (req, res) => {
    const threadId = String(req.query.threadId ?? '');
    const threadType = Number(req.query.threadType);
    if (!/^\d{1,32}$/.test(threadId) || (threadType !== 0 && threadType !== 1)) return res.status(400).json({ ok: false, error: 'Chọn lại hội thoại.' });
    try { {
      // Không đưa uid người tạo ra trình duyệt: giao diện chỉ cần `mine` (bot tạo hay không).
      const reminders = (await sidecar.reminders({ threadId, threadType })).map(({ creatorUid, ...rest }) => rest);
      res.json({ ok: true, reminders });
    } } catch (err) { failSidecar(res, err); }
  });

  r.post('/schedules/reminders/remove', requireAuth, async (req, res) => {
    const { reminderId, threadId, threadType } = req.body || {};
    try {
      await sidecar.removeReminder({ reminderId: String(reminderId ?? ''), threadId: String(threadId ?? ''), threadType, actor: req.user.username });
      res.json({ ok: true });
    } catch (err) { failSidecar(res, err); }
  });

  /** Xoá nhiều lời nhắc của MỘT hội thoại: `{ threadId, threadType, reminderIds: [...] }` → `{ done, failed }`. */
  r.post('/schedules/reminders/bulk-remove', requireAuth, async (req, res) => {
    const { threadId, threadType, reminderIds } = req.body || {};
    if (!/^\d{1,32}$/.test(String(threadId ?? '')) || (threadType !== 0 && threadType !== 1)) return res.status(400).json({ ok: false, error: 'Chọn lại hội thoại.' });
    if (!Array.isArray(reminderIds) || !reminderIds.length || reminderIds.length > MAX_BULK) return res.status(400).json({ ok: false, error: `Chọn từ 1 đến ${MAX_BULK} lời nhắc.` });
    const list = [...new Set(reminderIds.map(String))];
    if (!list.every((id) => REMINDER_ID.test(id))) return res.status(400).json({ ok: false, error: 'Danh sách chọn không hợp lệ — tải lại trang.' });
    const done = []; const failed = [];
    for (const reminderId of list) {
      try {
        await sidecar.removeReminder({ reminderId, threadId: String(threadId), threadType, actor: req.user.username });
        done.push({ id: reminderId });
      } catch (err) {
        // Kết nối Zalo tắt ngay từ đầu: báo một lỗi chung như xoá từng cái.
        if (!done.length && !failed.length && err?.name === 'SidecarDown') return failSidecar(res, err);
        const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
        failed.push({ id: reminderId, error: status >= 400 && status < 500 && status !== 401 && status !== 403 ? err.message : 'Zalo chưa phản hồi đúng' });
      }
    }
    try {
      activity.append({ actor: req.user.username, action: 'reminder_remove', detail: `${done.length}/${list.length} lời nhắc`, ...(done.length ? {} : { ok: false }) });
    } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
    res.json({ ok: true, done, failed });
  });
  return r;
}
