import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJson(path, fallback) {
  if (!existsSync(path)) return structuredClone(fallback);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    const aside = `${path}.corrupt-${Date.now()}`;
    try { renameSync(path, aside); } catch { /* tệp đã biến mất */ }
    console.warn(`[dashboard] ${path} hỏng, đã cất sang ${aside}: ${err.message}`);
    return structuredClone(fallback);
  }
}

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Windows: đổi tên đè lên tệp mà tiến trình khác (plugin Python, trình quét virus) đang mở
 * có thể lỗi tạm thời EPERM/EBUSY/EACCES — thử lại tối đa 3 lần, cách nhau 50 ms.
 */
export function writeJsonAtomic(path, value, { rename = renameSync, platform = process.platform } = {}) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  for (let retry = 0; ; retry += 1) {
    try {
      rename(tmp, path);
      return;
    } catch (err) {
      if (platform !== 'win32' || retry >= 3 || !RETRY_CODES.has(err?.code)) throw err;
      sleepSync(50);
    }
  }
}
