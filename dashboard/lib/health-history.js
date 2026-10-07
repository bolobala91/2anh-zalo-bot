/**
 * Kho cuộn 24 giờ cho biểu đồ Sức khoẻ máy chủ: mỗi phút một điểm `[t, cpu, ram, disk]`.
 * Giữ trong bộ nhớ, ghi `<dashboard>/health-history.json` (quyền 600) mỗi `saveEvery` điểm để khởi động
 * lại không mất biểu đồ. Tệp hỏng/thiếu → bắt đầu trống. Khoảng ~1440 điểm ≈ 40 KB.
 */
import { readJson, writeFileAtomic } from './json-store.js';

const DAY_MS = 24 * 3600_000;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function createHealthHistory({ file, now = Date.now, windowMs = DAY_MS, saveEvery = 5 }) {
  const raw = readJson(file, null);
  let points = Array.isArray(raw?.points)
    ? raw.points.filter((p) => Array.isArray(p) && p.length === 4 && num(p[0]) !== null).map((p) => [p[0], num(p[1]), num(p[2]), num(p[3])])
    : [];
  let unsaved = 0;
  const prune = () => { const cut = now() - windowMs; points = points.filter((p) => p[0] >= cut); };
  prune();

  function save() {
    unsaved = 0;
    try { writeFileAtomic(file, JSON.stringify({ v: 1, points })); } catch (e) { console.warn('[health] không ghi được lịch sử:', e.message); }
  }

  return {
    /** Thêm một lần đo của `readHost`. */
    add(sample) {
      points.push([sample.at, num(sample.cpuPct), num(sample.ramPct), num(sample.diskPct)]);
      prune();
      if (++unsaved >= saveEvery) save();
    },
    /** Các điểm trong 24 giờ, cũ trước. */
    points() { prune(); return points.map((p) => [...p]); },
    flush: save,
  };
}
