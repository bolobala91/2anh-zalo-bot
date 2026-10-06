import express from 'express';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../lib/http-guards.js';

export function authRoutes({ users, sessions, guard, setupToken, activity, sidecar }) {
  const r = express.Router();
  const userKey = (username) => `u:${String(username || '').toLowerCase()}`;
  const keys = (req, username) => [userKey(username), `ip:${req.ip}`];
  const tooMany = (res, ms) => res.status(429).json({ ok: false, error: `Thử sai quá nhiều lần — đợi ${Math.ceil(ms / 60_000)} phút rồi thử lại.` });

  async function zaloReady() {
    try {
      const h = await sidecar.health();
      return h?.zalo?.status === 'logged-in' && !h?.zalo?.needsRelogin;
    } catch { return false; }
  }

  r.post('/auth/setup', (req, res) => {
    const { token, username, password, zaloUid = '' } = req.body || {};
    if (users.hasAdmin() || !setupToken.consume(String(token || ''))) {
      return res.status(403).json({ ok: false, error: 'Link thiết lập không còn hiệu lực — chạy "npm run dashboard:setup-link" để lấy link mới.' });
    }
    try {
      const user = users.create({ username, role: 'admin', zaloUid, password });
      setSessionCookie(res, req, sessions.create(user.username));
      activity.append({ actor: user.username, action: 'setup_admin' });
      res.json({ ok: true, user });
    } catch (err) { res.status(err.statusCode || 500).json({ ok: false, error: err.message }); }
  });

  r.post('/auth/start', async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const wait = guard.locked(keys(req, username));
    if (wait) return tooMany(res, wait);
    const user = users.get(username);
    if (user && !user.disabled && user.zaloUid && await zaloReady()) {
      const code = guard.issueCode(username);
      try {
        await sidecar.loginCode({ zaloUid: user.zaloUid, code });
        return res.json({ ok: true, methods: ['zalo'] });
      } catch { /* gửi không được — rơi xuống mật khẩu */ }
    }
    res.json({ ok: true, methods: ['password'] });
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
