import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { rmSync } from 'node:fs';
import { readJson, writeJsonAtomic } from './json-store.js';

const sha = (t) => createHash('sha256').update(String(t)).digest('hex');

export function createSetupToken(path, { now = Date.now, ttlMs = 24 * 3600_000 } = {}) {
  const valid = (token) => {
    const saved = readJson(path, null);
    if (!saved || typeof saved.expiresAt !== 'number' || typeof saved.hash !== 'string' || !/^[0-9a-f]{64}$/.test(saved.hash)) return false;
    if (now() > saved.expiresAt) return false;
    const a = Buffer.from(sha(token)); const b = Buffer.from(saved.hash);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  return {
    issue() {
      const token = randomBytes(24).toString('base64url');
      writeJsonAtomic(path, { hash: sha(token), expiresAt: now() + ttlMs });
      return token;
    },
    /** Kiểm tra mà không đốt link (trang thiết lập dùng để điền sẵn dữ liệu). */
    check: (token) => valid(token),
    consume(token) {
      if (!valid(token)) return false;
      rmSync(path, { force: true });
      return true;
    },
  };
}
