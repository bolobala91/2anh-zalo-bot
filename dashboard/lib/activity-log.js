import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export function createActivityLog(path, { maxBytes = 5 * 1024 * 1024, now = Date.now } = {}) {
  function rotate() {
    try { if (statSync(path).size > maxBytes) renameSync(path, `${path}.1`); } catch { /* chưa có tệp */ }
  }
  function readLines(p) {
    if (!existsSync(p)) return [];
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  }
  return {
    append({ actor, action, detail = '', ok = true }) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      rotate();
      const entry = { at: now(), actor: String(actor).slice(0, 64), action: String(action), detail: String(detail).slice(0, 500), ok: Boolean(ok) };
      appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
      return entry;
    },
    list({ before = Infinity, limit = 50 } = {}) {
      return [...readLines(`${path}.1`), ...readLines(path)]
        .filter((e) => e.at < before)
        .sort((a, b) => b.at - a.at)
        .slice(0, Math.min(Math.max(limit, 1), 200));
    },
  };
}
