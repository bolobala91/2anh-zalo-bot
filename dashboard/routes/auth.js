import express from 'express';
import { validatePassword, validateUsername, validateZaloUid } from '../lib/users.js';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../lib/http-guards.js';

export function authRoutes({ users, sessions, guard, setupToken, activity, sidecar }) {
  const r = express.Router();
  const userKey = (username) => `u:${String(username || '').toLowerCase()}`;
  const keys = (req, username) => [userKey(username), `ip:${req.ip}`];
  const tooMany = (res, ms) => res.status(429).json({ ok: false, error: `Thử sai quá nhiều lần — đợi ${Math.ceil(ms / 60_000)} phút rồi thử lại.` });

  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status >= 400 && status < 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };

  const CODE_COOLDOWN_MS = 60_000;
  const lastCode = new Map(); // username → thời điểm gửi mã gần nhất
  const NEUTRAL = 'Nếu tài khoản đã liên kết Zalo, mã đăng nhập vừa được gửi qua Zalo. Bạn cũng có thể dùng mật khẩu.';

  async function zaloReady() {
    try {
      const h = await sidecar.health();
      return h?.zalo?.status === 'logged-in' && !h?.zalo?.needsRelogin;
    } catch { return false; }
  }

  r.post('/auth/setup', (req, res) => {
    const { token, username, password, zaloUid = '' } = req.body || {};
    if (users.hasAdmin()) {
      return res.status(403).json({ ok: false, error: 'Link thiết lập không còn hiệu lực — chạy "npm run dashboard:setup-link" để lấy link mới.' });
    }
    // Kiểm tra dữ liệu trước khi đốt link dùng một lần.
    try {
      validateUsername(username);
      if (!password) throw Object.assign(new Error('Mật khẩu cần ít nhất 8 ký tự'), { statusCode: 400 });
      validatePassword(password);
      validateZaloUid(zaloUid);
    } catch (err) { return fail(res, err, ''); }
    if (!setupToken.consume(String(token || ''))) {
      return res.status(403).json({ ok: false, error: 'Link thiết lập không còn hiệu lực — chạy "npm run dashboard:setup-link" để lấy link mới.' });
    }
    try {
      const user = users.create({ username, role: 'admin', zaloUid, password });
      setSessionCookie(res, req, sessions.create(user.username));
      activity.append({ actor: user.username, action: 'setup_admin' });
      res.json({ ok: true, user });
    } catch (err) { fail(res, err, 'Không tạo được tài khoản — thử lại, nếu vẫn lỗi hãy xem nhật ký dịch vụ.'); }
  });

  r.post('/auth/start', async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const wait = guard.locked(keys(req, username));
    if (wait) return tooMany(res, wait);
    const user = users.get(username);
    const t = Date.now();
    for (const [u, at] of lastCode) if (t - at >= CODE_COOLDOWN_MS) lastCode.delete(u);
    // Luôn trả cùng một phản hồi cho mọi tên đăng nhập; chỉ gửi mã âm thầm khi thực sự gửi được.
    if (user && !user.disabled && user.zaloUid && !lastCode.has(username) && await zaloReady()) {
      lastCode.set(username, t);
      const code = guard.issueCode(username);
      try { await sidecar.loginCode({ zaloUid: user.zaloUid, code }); } catch (err) { console.error('[dashboard] gửi mã Zalo lỗi:', err?.message || err); }
    }
    res.json({ ok: true, methods: ['zalo', 'password'], message: NEUTRAL });
  });

  r.post('/auth/verify', (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const k = keys(req, username);
    const wait = guard.locked(k);
    if (wait) return tooMany(res, wait);
    const { code, password } = req.body || {};
    const ok = code ? guard.verifyCode(username, String(code)) : users.verifyPassword(username, String(password || ''));
    const user = users.get(username);
    if (!ok || !user || user.disabled) {
      guard.fail(k);
      activity.append({ actor: username || '?', action: 'login', ok: false, detail: code ? 'mã Zalo' : 'mật khẩu' });
      return res.status(401).json({ ok: false, error: 'Tên đăng nhập, mã hoặc mật khẩu không đúng.' });
    }
    // Chỉ xoá khoá theo tài khoản — không xoá khoá IP, để một tài khoản hợp lệ không dùng được để reset IP khi đoán mật khẩu tài khoản khác.
    guard.succeed([userKey(username)]);
    setSessionCookie(res, req, sessions.create(username));
    activity.append({ actor: username, action: 'login', detail: code ? 'mã Zalo' : 'mật khẩu' });
    res.json({ ok: true });
  });

  r.post('/auth/logout', requireAuth, (req, res) => {
    sessions.destroy(req.sessionToken); clearSessionCookie(res); res.json({ ok: true });
  });
  r.post('/auth/logout-all', requireAuth, (req, res) => {
    sessions.destroyAll(req.user.username); clearSessionCookie(res);
    activity.append({ actor: req.user.username, action: 'logout_all' });
    res.json({ ok: true });
  });
  r.get('/me', requireAuth, (req, res) => res.json({ ok: true, user: req.user }));
  return r;
}
