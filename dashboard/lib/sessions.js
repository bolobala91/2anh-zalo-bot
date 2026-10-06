import { createHash, randomBytes } from 'node:crypto';
import { readJson, writeJsonAtomic } from './json-store.js';

const sha = (t) => createHash('sha256').update(String(t)).digest('hex');

export function createSessionStore(path, { now = Date.now, ttlMs = 7 * 24 * 3600_000, idleMs = 12 * 3600_000 } = {}) {
  let data = readJson(path, { sessions: {} });
  let lastFlush = 0;
  const flush = () => { writeJsonAtomic(path, data); lastFlush = now(); };
  const alive = (s, t) => s && t - s.createdAt < ttlMs && t - s.lastSeen < idleMs;
  return {
    create(username) {
      const token = randomBytes(32).toString('base64url');
      const t = now();
      for (const [k, s] of Object.entries(data.sessions)) if (!alive(s, t)) delete data.sessions[k];
      data.sessions[sha(token)] = { username, createdAt: t, lastSeen: t };
      flush();
      return token;
    },
    get(token) {
      if (!token) return null;
      const key = sha(token);
      const s = data.sessions[key];
      const t = now();
      if (!alive(s, t)) { if (s) { delete data.sessions[key]; flush(); } return null; }
      s.lastSeen = t;
      if (t - lastFlush > 60_000) flush();
      return { username: s.username };
    },
    destroy(token) { delete data.sessions[sha(token)]; flush(); },
    destroyAll(username) {
      for (const [k, s] of Object.entries(data.sessions)) if (s.username === username) delete data.sessions[k];
      flush();
    },
  };
}
