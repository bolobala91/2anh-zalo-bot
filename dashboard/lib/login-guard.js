import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

const sha = (v) => createHash('sha256').update(String(v)).digest();

export function createLoginGuard({ now = Date.now, maxFails = 5, windowMs = 15 * 60_000, lockMs = 15 * 60_000, codeTtlMs = 5 * 60_000, codeAttempts = 5 } = {}) {
  const fails = new Map();   // key → { times: number[], lockedUntil }
  const codes = new Map();   // username → { hash, expiresAt, attempts }
  const entry = (k) => fails.get(k) || { times: [], lockedUntil: 0 };
  return {
    locked(keys) {
      const t = now();
      return Math.max(0, ...keys.map((k) => entry(k).lockedUntil - t));
    },
    fail(keys) {
      const t = now();
      for (const k of keys) {
        const e = entry(k);
        e.times = [...e.times.filter((x) => t - x < windowMs), t];
        if (e.times.length >= maxFails) { e.lockedUntil = t + lockMs; e.times = []; }
        fails.set(k, e);
      }
    },
    succeed(keys) { for (const k of keys) fails.delete(k); },
    issueCode(username) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      codes.set(username, { hash: sha(code), expiresAt: now() + codeTtlMs, attempts: 0 });
      return code;
    },
    verifyCode(username, code) {
      const c = codes.get(username);
      if (!c) return false;
      if (now() > c.expiresAt || c.attempts >= codeAttempts) { codes.delete(username); return false; }
      c.attempts += 1;
      const ok = /^\d{6}$/.test(String(code)) && timingSafeEqual(sha(code), c.hash);
      if (ok) codes.delete(username);
      return ok;
    },
  };
}
