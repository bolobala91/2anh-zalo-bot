import { createHash, randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { readJson, writeJsonAtomic } from './json-store.js';

const sha = (t) => createHash('sha256').update(String(t)).digest('hex');

// Dấu vết tệp: đổi khi tiến trình khác (vd. dashboard:reset-admin) ghi lại tệp.
// Gồm cả ino vì ghi nguyên tử bằng rename tạo tệp mới.
function fingerprint(path) {
  try { const s = statSync(path); return `${s.mtimeMs}:${s.size}:${s.ino}`; } catch { return 'none'; }
}

export function createSessionStore(path, { now = Date.now, ttlMs = 7 * 24 * 3600_000, idleMs = 12 * 3600_000 } = {}) {
  let data = readJson(path, { sessions: {} });
  let seen = fingerprint(path);
  let lastFlush = 0;
  // Đọc lại khi tệp đã bị tiến trình khác sửa — nếu không, bản trong bộ nhớ sẽ ghi đè
  // và làm sống lại các phiên mà CLI vừa gỡ.
  const sync = () => {
    const fp = fingerprint(path);
    if (fp !== seen) { data = readJson(path, { sessions: {} }); seen = fp; }
  };
  const flush = () => { writeJsonAtomic(path, data); seen = fingerprint(path); lastFlush = now(); };
  const alive = (s, t) => s && t - s.createdAt < ttlMs && t - s.lastSeen < idleMs;
  return {
    create(username) {
      sync();
      const token = randomBytes(32).toString('base64url');
      const t = now();
      for (const [k, s] of Object.entries(data.sessions)) if (!alive(s, t)) delete data.sessions[k];
      data.sessions[sha(token)] = { username, createdAt: t, lastSeen: t };
      flush();
      return token;
    },
    get(token) {
      if (!token) return null;
      sync();
      const key = sha(token);
      const s = data.sessions[key];
      const t = now();
      if (!alive(s, t)) { if (s) { delete data.sessions[key]; flush(); } return null; }
      s.lastSeen = t;
      if (t - lastFlush > 60_000) flush();
      return { username: s.username };
    },
    destroy(token) { sync(); delete data.sessions[sha(token)]; flush(); },
    destroyAll(username) {
      sync();
      for (const [k, s] of Object.entries(data.sessions)) if (s.username === username) delete data.sessions[k];
      flush();
    },
  };
}
