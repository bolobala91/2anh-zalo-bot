// Bộ nhớ của trợ lý (spec §18.5) — chỉ Quản trị: đây là phần lời nhắc hệ thống của trợ lý, cùng loại với Agent (§18.6).
// Mỗi mục có thẻ loại "[Loại] …" (lib/memory-tags.js): chọn loại khi thêm/sửa, hoặc "Tự phân loại" để AI của bot gắn.
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';
import { TARGETS } from '../lib/hermes-memory.js';
import { splitTag, withTag } from '../lib/memory-tags.js';

export function agentMemoryRoutes({ agentMemory, memoryTags, activity }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status >= 400 && status < 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };
  const target = (req) => (Object.hasOwn(TARGETS, req.params.target) ? req.params.target : null);
  const note = (req, action, detail) => {
    try { activity.append({ actor: req.user.username, action, detail }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
  };
  const log = (req, action, t, index) => note(req, action, `${TARGETS[t].label}, mục ${index + 1}`);
  const view = () => ({ ...agentMemory.view(), ...(memoryTags ? { tags: memoryTags.tags() } : {}) });
  /** Chữ người dùng gõ + loại đã chọn → mục lưu. `tag` rỗng = tự phân loại (lưu chưa thẻ, xin AI gắn). */
  const compose = (body) => {
    const text = splitTag(String(body?.text ?? '').trim()).text;
    const tag = String(body?.tag ?? '').trim();
    if (tag && memoryTags && !memoryTags.tags().some((t) => t.label === tag)) {
      throw Object.assign(new Error('Loại này không còn — tải lại trang.'), { statusCode: 400 });
    }
    return { entry: tag ? withTag(tag, text) : text, auto: !tag && Boolean(memoryTags) };
  };
  const autoTag = (req, t) => { try { memoryTags.request(t, 'auto', req.user.username); } catch (e) { console.warn('[dashboard] chưa xin được AI gắn thẻ:', e.message); } };

  r.get('/admin/agent-memory', ...guard, (req, res) => {
    try { res.json({ ok: true, ...view() }); } catch (err) { fail(res, err, 'Chưa đọc được bộ nhớ của trợ lý — tải lại trang.'); }
  });
  r.post('/admin/agent-memory/:target', ...guard, (req, res) => {
    const t = target(req);
    if (!t) return res.status(400).json({ ok: false, error: 'Không có mục bộ nhớ này — tải lại trang.' });
    try {
      const { entry, auto } = compose(req.body);
      agentMemory.add(t, entry);
      if (auto) autoTag(req, t);
      const v = view();
      log(req, 'agent_memory_add', t, v[t].entries.length - 1);
      res.json({ ok: true, ...v, autoTagging: auto });
    } catch (err) { fail(res, err, 'Chưa thêm được — thử lại.'); }
  });
  r.put('/admin/agent-memory/:target/:index', ...guard, (req, res) => {
    const t = target(req); const i = Number(req.params.index);
    if (!t) return res.status(400).json({ ok: false, error: 'Không có mục bộ nhớ này — tải lại trang.' });
    try {
      const { entry, auto } = compose(req.body);
      agentMemory.replace(t, i, req.body?.old, entry);
      if (auto) autoTag(req, t);
      log(req, 'agent_memory_edit', t, i);
      res.json({ ok: true, ...view(), autoTagging: auto });
    } catch (err) { fail(res, err, 'Chưa lưu được — thử lại.'); }
  });
  r.delete('/admin/agent-memory/:target/:index', ...guard, (req, res) => {
    const t = target(req); const i = Number(req.params.index);
    if (!t) return res.status(400).json({ ok: false, error: 'Không có mục bộ nhớ này — tải lại trang.' });
    try { agentMemory.remove(t, i, req.body?.old); log(req, 'agent_memory_delete', t, i); res.json({ ok: true, ...view() }); } catch (err) { fail(res, err, 'Chưa xoá được — thử lại.'); }
  });

  if (!memoryTags) return r;
  r.put('/admin/agent-memory-tags', ...guard, (req, res) => {
    try {
      const tags = memoryTags.saveTags(req.body?.tags, req.body?.renames);
      note(req, 'agent_memory_tags', tags.map((x) => x.label).join(', '));
      res.json({ ok: true, ...view() });
    } catch (err) { fail(res, err, 'Chưa lưu được loại thẻ — thử lại.'); }
  });
  r.post('/admin/agent-memory/:target/organize', ...guard, (req, res) => {
    const t = target(req);
    if (!t) return res.status(400).json({ ok: false, error: 'Không có mục bộ nhớ này — tải lại trang.' });
    try { res.json({ ok: true, id: memoryTags.request(t, 'propose', req.user.username) }); } catch (err) { fail(res, err, 'Chưa gửi được — thử lại.'); }
  });
  r.get('/admin/agent-memory-organize/:id', ...guard, (req, res) => {
    try { res.json({ ok: true, ...memoryTags.result(req.params.id) }); } catch (err) { fail(res, err, 'Chưa đọc được kết quả — thử lại.'); }
  });
  r.post('/admin/agent-memory-organize/:id/apply', ...guard, (req, res) => {
    try {
      const t = memoryTags.apply(req.params.id);
      note(req, 'agent_memory_organize', `${TARGETS[t].label}: áp dụng bản AI sắp xếp`);
      res.json({ ok: true, ...view() });
    } catch (err) { fail(res, err, 'Chưa áp dụng được — thử lại.'); }
  });
  r.get('/admin/agent-memory-organize-log', ...guard, (req, res) => {
    try { res.json({ ok: true, log: memoryTags.log() }); } catch (err) { fail(res, err, 'Chưa đọc được lịch sử.'); }
  });
  r.post('/admin/agent-memory-organize-log/:id/undo', ...guard, (req, res) => {
    try {
      const t = memoryTags.undo(String(req.params.id));
      note(req, 'agent_memory_organize_undo', `${TARGETS[t].label}: hoàn tác sắp xếp`);
      res.json({ ok: true, ...view(), log: memoryTags.log() });
    } catch (err) { fail(res, err, 'Chưa hoàn tác được — thử lại.'); }
  });
  return r;
}
