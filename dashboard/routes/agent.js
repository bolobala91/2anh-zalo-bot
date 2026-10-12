// Agent (spec §18.6) — chỉ Quản trị: model (hiệu lực ngay), mức suy nghĩ + tính cách (cần khởi động lại trợ lý).
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';
import { REASONING } from '../lib/agent-config.js';
import { readJson, writeJsonAtomic } from '../lib/json-store.js';
import { MAX_CUSTOM, MAX_PRESETS, SOUL_GROUPS, SOUL_PRESETS, composeSoul } from '../public/soul-presets.js';

export function agentRoutes({ agentConfig, soul, restartFlags, activity, soulPresetsFile = null }) {
  // Mẫu tính cách đã chọn + phần riêng (tiếng Việt) — để lần sau mở lại đúng lựa chọn. SOUL.md là bản đã ghép.
  const presetState = () => {
    const s = soulPresetsFile ? readJson(soulPresetsFile, {}) : {};
    const ids = new Set(SOUL_PRESETS.map((p) => p.id));
    return { selected: (Array.isArray(s?.selected) ? s.selected : []).filter((id) => ids.has(id)), custom: typeof s?.custom === 'string' ? s.custom : '' };
  };
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status !== 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };
  const log = (req, action, detail) => { try { activity.append({ actor: req.user.username, action, detail }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); } };
  const view = () => ({ ok: true, ...agentConfig.view(), reasoningChoices: REASONING, soul: soul.view(),
    soulPresets: { groups: SOUL_GROUPS, presets: SOUL_PRESETS.map(({ id, group, label, hint }) => ({ id, group, label, hint })), max: MAX_PRESETS, maxCustom: MAX_CUSTOM, ...presetState() } });

  r.get('/admin/agent', ...guard, (req, res) => { try { res.json(view()); } catch (err) { fail(res, err, 'Chưa đọc được cài đặt trợ lý.'); } });
  r.get('/admin/agent/models', ...guard, async (req, res) => { try { res.json({ ok: true, models: await agentConfig.models() }); } catch (err) { fail(res, err, 'Chưa lấy được danh sách model.'); } });

  r.put('/admin/agent/model', ...guard, async (req, res) => {
    try {
      const before = agentConfig.view().model;
      if (await agentConfig.setModel(req.body?.model)) log(req, 'agent_model', `${before} → ${req.body.model}`);
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa đổi được model — thử lại.'); }
  });
  r.put('/admin/agent/reasoning', ...guard, (req, res) => {
    try {
      if (agentConfig.setReasoning(req.body?.value)) { restartFlags.mark('assistant', 'Mức suy nghĩ'); log(req, 'agent_reasoning', req.body.value); }
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa lưu được — thử lại.'); }
  });
  r.put('/admin/agent/soul', ...guard, (req, res) => {
    try {
      if (soul.save(req.body?.text, req.user.username)) { restartFlags.mark('assistant', 'Tính cách (SOUL.md)'); log(req, 'agent_soul', `${String(req.body.text).length} ký tự`); }
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa lưu được tính cách — thử lại.'); }
  });
  // Chọn mẫu tính cách (nhiều mẫu) + phần riêng → ghép thành SOUL.md (vẫn qua lịch sử như sửa tay).
  r.put('/admin/agent/soul-presets', ...guard, (req, res) => {
    try {
      const ids = new Set(SOUL_PRESETS.map((p) => p.id));
      const raw = Array.isArray(req.body?.selected) ? req.body.selected : null;
      const custom = typeof req.body?.custom === 'string' ? req.body.custom.replace(/\r\n/g, '\n').trim() : null;
      if (!raw || raw.some((id) => !ids.has(id)) || custom === null) return res.status(400).json({ ok: false, error: 'Lựa chọn không hợp lệ — tải lại trang rồi thử lại.' });
      const selected = [...new Set(raw)];
      if (selected.length > MAX_PRESETS) return res.status(400).json({ ok: false, error: `Chọn tối đa ${MAX_PRESETS} vai trò.` });
      if (custom.length > MAX_CUSTOM) return res.status(400).json({ ok: false, error: `Phần riêng tối đa ${MAX_CUSTOM} ký tự.` });
      if (!selected.length && !custom) return res.status(400).json({ ok: false, error: 'Chọn ít nhất một vai trò hoặc viết phần riêng của bot.' });
      const text = composeSoul(custom, selected);
      if (soul.save(text, req.user.username)) {
        restartFlags.mark('assistant', 'Tính cách (SOUL.md)');
        log(req, 'agent_soul', `mẫu: ${selected.map((id) => SOUL_PRESETS.find((p) => p.id === id).label).join(', ') || 'không'}${custom ? ' + phần riêng' : ''}`);
      }
      if (soulPresetsFile) writeJsonAtomic(soulPresetsFile, { version: 1, selected, custom });
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa lưu được tính cách — thử lại.'); }
  });
  r.get('/admin/agent/soul/history/:id', ...guard, (req, res) => { try { res.json({ ok: true, text: soul.snapshot(req.params.id) }); } catch (err) { fail(res, err, 'Chưa đọc được bản cũ.'); } });
  r.post('/admin/agent/soul/restore/:id', ...guard, (req, res) => {
    try {
      if (soul.restore(req.params.id, req.user.username)) { restartFlags.mark('assistant', 'Tính cách (SOUL.md)'); log(req, 'agent_soul_restore', req.params.id === 'original' ? 'bản gốc' : req.params.id); }
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa khôi phục được — thử lại.'); }
  });
  return r;
}
