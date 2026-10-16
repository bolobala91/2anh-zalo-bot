// Kết nối MCP (spec §18.6) — chỉ Quản trị: xem, bật/tắt, thêm từ danh mục Hermes hoặc theo địa chỉ https, kiểm tra
// (liệt kê công cụ), chọn công cụ, gỡ, đăng nhập OAuth qua dashboard. Mọi thay đổi cần khởi động lại trợ lý.
// Trang quay về sau đăng nhập (/api/mcp-oauth/callback) không đòi phiên đăng nhập (cookie SameSite=Strict không đi
// theo chuyển hướng từ trang ngoài) — chỉ nhận đúng `state` của một lần đăng nhập đang chờ; Hermes kiểm state lần nữa.
import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { requireAuth, requireRole } from '../lib/http-guards.js';

const FLOW_TTL_MS = 6 * 60_000;
const page = (title, text) => `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px"><h1 style="font-size:1.3rem">${title}</h1><p>${text}</p></body></html>`;

export function mcpRoutes({ mcpServers, hermesAdmin, restartFlags, activity, config }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err, fallback = 'Chưa đọc/ghi được config.yaml — thử lại, nếu vẫn lỗi hãy báo người cài đặt.') => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status !== 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err?.message || err);
    return res.status(500).json({ ok: false, error: fallback });
  };
  const log = (req, action, detail) => { try { activity.append({ actor: req.user.username, action, detail }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); } };
  const changed = (req, action, name) => { restartFlags.mark('assistant', `Kết nối MCP: ${name}`); log(req, action, name); };
  const strip = ({ ok, ...rest }) => rest;
  const list = async () => ({ ok: true, servers: await mcpServers.list(), manage: Boolean(hermesAdmin) });

  r.get('/admin/mcp', ...guard, async (req, res) => { try { res.json(await list()); } catch (err) { fail(res, err); } });
  r.put('/admin/mcp/:name', ...guard, async (req, res) => {
    try {
      const enabled = req.body?.enabled;
      if (mcpServers.setEnabled(req.params.name, enabled)) changed(req, enabled ? 'mcp_enable' : 'mcp_disable', req.params.name);
      res.json(await list());
    } catch (err) { fail(res, err); }
  });
  // "Ai được dùng": ghi ZALO_PUBLIC_MCP — plugin đọc lại ngay, không cần khởi động lại trợ lý.
  r.put('/admin/mcp/:name/members', ...guard, async (req, res) => {
    try {
      const open = req.body?.open;
      if (mcpServers.setMembers(req.params.name, open)) log(req, open ? 'mcp_members_open' : 'mcp_members_close', req.params.name);
      res.json(await list());
    } catch (err) { fail(res, err, 'Chưa lưu được ai được dùng kết nối này.'); }
  });
  if (!hermesAdmin) return r;

  r.get('/admin/mcp-catalog', ...guard, async (req, res) => {
    try { res.json({ ok: true, ...strip(await hermesAdmin.read('mcp.catalog')) }); } catch (err) { fail(res, err, 'Chưa đọc được danh mục kết nối.'); }
  });
  r.post('/admin/mcp-catalog/install', ...guard, async (req, res) => {
    try {
      const out = await hermesAdmin.write('mcp.install', { name: req.body?.name, env: req.body?.env || {} }, { timeoutMs: 120_000 });
      changed(req, 'mcp_install', out.name);
      res.json({ ...(await list()), installed: strip(out) });
    } catch (err) { fail(res, err, 'Chưa cài được kết nối.'); }
  });
  r.post('/admin/mcp-add', ...guard, async (req, res) => {
    try {
      const { name, url, auth, token } = req.body || {};
      const out = await hermesAdmin.write('mcp.add', { name, url, auth, token });
      changed(req, 'mcp_add', out.name);
      res.json({ ...(await list()), added: strip(out) });
    } catch (err) { fail(res, err, 'Chưa thêm được kết nối.'); }
  });
  // Sửa: địa chỉ, khoá (chỉ ghi, không bao giờ đọc ra), thời gian chờ. Chỉ chuyển đúng các trường được phép.
  r.put('/admin/mcp/:name/edit', ...guard, async (req, res) => {
    try {
      const b = req.body || {};
      const args = { name: req.params.name };
      for (const k of ['url', 'keys', 'timeout', 'connect_timeout']) if (k in b) args[k] = b[k];
      const out = await hermesAdmin.write('mcp.edit', args);
      if (out.changed?.length) changed(req, 'mcp_edit', `${out.name}: ${out.changed.join(', ')}`);
      res.json({ ...(await list()), edited: strip(out) });
    } catch (err) { fail(res, err, 'Chưa lưu được thay đổi của kết nối.'); }
  });
  r.post('/admin/mcp/:name/test', ...guard, async (req, res) => {
    try { res.json({ ok: true, ...strip(await hermesAdmin.read('mcp.test', { name: req.params.name }, { timeoutMs: 60_000 })) }); } catch (err) { fail(res, err, 'Chưa kiểm tra được kết nối.'); }
  });
  r.put('/admin/mcp/:name/tools', ...guard, async (req, res) => {
    try {
      const out = await hermesAdmin.write('mcp.tools', { name: req.params.name, disabled: req.body?.disabled });
      changed(req, 'mcp_tools', `${out.name}: tắt ${out.disabled.length} công cụ`);
      res.json({ ok: true, ...strip(out) });
    } catch (err) { fail(res, err, 'Chưa lưu được lựa chọn công cụ.'); }
  });
  r.post('/admin/mcp/:name/remove', ...guard, async (req, res) => {
    try {
      const out = await hermesAdmin.write('mcp.remove', { name: req.params.name });
      changed(req, 'mcp_remove', out.name);
      res.json(await list());
    } catch (err) { fail(res, err, 'Chưa gỡ được kết nối.'); }
  });

  // ── Đăng nhập OAuth ──
  const flows = new Map(); // flowId → { name, state, stream, status, error, tools, at, delivered }
  const starting = new Set(); // tên kết nối đang mở trang đăng nhập (chặn bấm hai lần)
  const pending = () => [...flows.values()].filter((f) => f.status === 'pending');
  const sweep = () => {
    for (const [id, f] of flows) {
      const age = Date.now() - f.at;
      if (f.status === 'pending' && age > FLOW_TTL_MS) { f.stream.cancel(); f.status = 'error'; f.error = 'Hết thời gian chờ đăng nhập.'; }
      if (f.status !== 'pending' && age > FLOW_TTL_MS + 60_000) flows.delete(id);
    }
  };
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/i;
  const redirectUri = (req) => {
    let base = String(config?.publicUrl || '');
    try { if (!base || LOCAL.test(new URL(base).hostname)) base = `${req.protocol}://${req.get('host')}`; } catch { base = `${req.protocol}://${req.get('host')}`; }
    return `${base.replace(/\/+$/, '')}/api/mcp-oauth/callback`;
  };

  r.post('/admin/mcp/:name/oauth', ...guard, async (req, res) => {
    const name = req.params.name;
    try {
      sweep();
      if (starting.has(name)) return res.status(409).json({ ok: false, error: 'Đang mở trang đăng nhập cho kết nối này — chờ một chút.' });
      for (const f of pending()) if (f.name === name) { f.stream.cancel(); f.status = 'error'; f.error = 'Đã mở lần đăng nhập mới.'; }
      if (pending().length >= 3) return res.status(429).json({ ok: false, error: 'Đang có nhiều lần đăng nhập chờ — thử lại sau vài phút.' });
      starting.add(name);
      const stream = hermesAdmin.stream('mcp.oauth', { name, redirect_uri: redirectUri(req) });
      const first = await stream.first;
      if (!/^https?:\/\//i.test(String(first.url || ''))) { stream.cancel(); throw Object.assign(new Error('Dịch vụ trả về trang đăng nhập lạ.'), { statusCode: 502 }); }
      const id = randomBytes(12).toString('hex');
      const flow = { name, state: String(first.state || ''), stream, status: 'pending', error: '', tools: 0, at: Date.now(), delivered: false };
      flows.set(id, flow);
      stream.done.then((d) => {
        flow.status = 'done'; flow.tools = d.tools || 0;
        try { changed(req, 'mcp_oauth', name); } catch (e) { console.error('[dashboard] không ghi được cờ/Nhật ký đăng nhập MCP:', e); }
      }, (e) => { if (flow.status === 'pending') { flow.status = 'error'; flow.error = e.message; } });
      res.json({ ok: true, flowId: id, url: first.url });
    } catch (err) { fail(res, err, 'Chưa mở được trang đăng nhập.'); } finally { starting.delete(name); }
  });
  r.get('/admin/mcp/oauth/:id', ...guard, (req, res) => {
    const f = flows.get(req.params.id);
    if (!f) return res.status(404).json({ ok: false, error: 'Lần đăng nhập này đã hết hạn — bấm Đăng nhập lại.' });
    res.json({ ok: true, status: f.status, error: f.error, tools: f.tools });
  });
  r.delete('/admin/mcp/oauth/:id', ...guard, (req, res) => {
    const f = flows.get(req.params.id);
    if (f?.status === 'pending' && !f.delivered) { f.stream.cancel(); f.status = 'error'; f.error = 'Đã huỷ.'; }
    res.json({ ok: true });
  });
  r.get('/mcp-oauth/callback', (req, res) => {
    sweep();
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const same = (a) => { const x = Buffer.from(a); const y = Buffer.from(state); return x.length === y.length && timingSafeEqual(x, y); };
    const flow = state ? pending().find((f) => !f.delivered && f.state && same(f.state)) : null;
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.set('Cache-Control', 'no-store');
    const pick = (k) => (typeof req.query[k] === 'string' ? req.query[k].slice(0, 4096) : undefined);
    if (!flow || !flow.stream.send({ code: pick('code'), state, error: pick('error') })) {
      return res.status(404).type('html').send(page('Lần đăng nhập đã hết hạn', 'Quay lại dashboard, trang Kết nối MCP, bấm Đăng nhập lại.'));
    }
    flow.delivered = true;
    res.type('html').send(pick('error')
      ? page('Đăng nhập bị từ chối', 'Quay lại dashboard để thử lại.')
      : page('Đã nhận đăng nhập', 'Đóng tab này và quay lại dashboard — trang Kết nối MCP sẽ báo khi xong.'));
  });
  return r;
}
