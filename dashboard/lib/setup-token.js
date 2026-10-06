import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { rmSync } from 'node:fs';
import { readJson, writeJsonAtomic } from './json-store.js';

const sha = (t) => createHash('sha256').update(String(t)).digest('hex');

export function createSetupToken(path, { now = Date.now, ttlMs = 24 * 3600_000 } = {}) {
  return {
    issue() {
      const token = randomBytes(24).toString('base64url');
      writeJsonAtomic(path, { hash: sha(token), expiresAt: now() + ttlMs });
      return token;
    },
    consume(token) {
      const saved = readJson(path, null);
      if (!saved || now() > saved.expiresAt) return false;
      const a = Buffer.from(sha(token)); const b = Buffer.from(saved.hash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
      rmSync(path, { force: true });
      return true;
    },
  };
}
