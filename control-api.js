/**
 * Route /control/* cho dashboard. Luôn đòi ZALO_BRIDGE_TOKEN — nghe 127.0.0.1
 * không phải là xác thực: mọi tiến trình trên máy đều gọi được.
 * Một token cho cả cầu nối Hermes lẫn dashboard: một bí mật, một chỗ thu hồi.
 */
import express from 'express';
import { timingSafeEqual } from 'node:crypto';

const ZALO_UID = /^[1-9]\d{14,21}$/;
const MAX_TEXT = 2000;

function tokenOk(header, expected) {
  const supplied = Buffer.from(String(header || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(String(expected || ''));
  return want.length > 0 && supplied.length === want.length && timingSafeEqual(supplied, want);
}

export function createControlRouter({ token, health, qr, logout, send, loginCode, groups }) {
  const router = express.Router();
  router.use((req, res, next) => (tokenOk(req.get('authorization'), token)
    ? next() : res.status(401).json({ ok: false, error: 'unauthorized' })));

  const wrap = (fn) => async (req, res) => {
    try { res.json({ ok: true, ...(await fn(req)) }); } catch (err) {
      const status = err.statusCode || 502;
      res.status(status).json({ ok: false, error: String(err?.message || err) });
    }
  };
  const bad = (message) => Object.assign(new Error(message), { statusCode: 400 });

  router.get('/health', wrap(async () => ({ health: health() })));
  router.post('/qr/start', wrap(async () => { await qr.start(); return {}; }));
  router.get('/qr', wrap(async () => qr.state()));
  router.post('/logout', wrap(async () => { await logout(); return {}; }));
  router.post('/send', wrap(async (req) => {
    const { threadId, threadType, text, actor } = req.body || {};
    const body = String(text ?? '').trim();
    if (!/^\d+$/.test(String(threadId ?? ''))) throw bad('threadId không hợp lệ');
    if (![0, 1].includes(Number(threadType))) throw bad('threadType phải là 0 hoặc 1');
    if (!body || body.length > MAX_TEXT) throw bad(`Nội dung trống hoặc quá ${MAX_TEXT} ký tự`);
    if (!String(actor || '').trim()) throw bad('Thiếu người gửi');
    return { result: await send({ threadId: String(threadId), threadType: Number(threadType), text: body, actor: String(actor) }) };
  }));
  router.post('/login-code', wrap(async (req) => {
    const { zaloUid, code } = req.body || {};
    if (!ZALO_UID.test(String(zaloUid ?? ''))) throw bad('UID Zalo không hợp lệ');
    if (!/^\d{6}$/.test(String(code ?? ''))) throw bad('Mã phải gồm đúng 6 chữ số');
    await loginCode({ zaloUid: String(zaloUid), code: String(code) });
    return {};
  }));
  router.get('/groups', wrap(async () => ({ groups: await groups() })));
  return router;
}
