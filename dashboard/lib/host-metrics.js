/**
 * Số đo máy chủ cho trang Sức khoẻ máy chủ (spec §16.B) — chỉ dùng `node:os` và `fs.statfsSync`,
 * không chạy lệnh nào, chạy giống nhau trên Linux và Windows.
 * RAM "đã dùng" = tổng − khả dụng (`os.freemem()` trên Linux là MemAvailable từ Node 22).
 */
import os from 'node:os';
import { statfsSync } from 'node:fs';

const round1 = (x) => Math.round(x * 10) / 10;
const pct = (used, total) => (total > 0 ? round1((used / total) * 100) : 0);

/** CPU % trung bình mọi nhân giữa hai lần gọi `sample()`. Lần đầu so với lúc tạo. */
export function createCpuMeter({ cpus = os.cpus } = {}) {
  const totals = () => {
    let idle = 0; let all = 0;
    for (const c of cpus()) {
      const t = c.times;
      idle += t.idle;
      all += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    return { idle, all };
  };
  let prev = totals();
  return {
    sample() {
      const cur = totals();
      const all = cur.all - prev.all;
      const idle = cur.idle - prev.idle;
      prev = cur;
      return all > 0 ? Math.min(100, Math.max(0, round1(((all - idle) / all) * 100))) : 0;
    },
  };
}

/**
 * Một lần đo. `diskPath`: thư mục dữ liệu của bot (HERMES_HOME) — đo đúng ổ đĩa chứa nó.
 * Ổ đĩa đọc lỗi → các trường đĩa là null (giao diện ghi "Chưa đo được").
 */
export function readHost({ cpu, diskPath, osImpl = os, statfsImpl = statfsSync, now = Date.now }) {
  const total = osImpl.totalmem();
  const used = total - osImpl.freemem();
  let disk = { diskPct: null, diskUsedGb: null, diskTotalGb: null };
  try {
    const s = statfsImpl(diskPath);
    const size = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    disk = { diskPct: pct(size - free, size), diskUsedGb: round1((size - free) / 1024 ** 3), diskTotalGb: round1(size / 1024 ** 3) };
  } catch { /* để null */ }
  return {
    at: now(),
    cpuPct: cpu.sample(),
    ramPct: pct(used, total),
    ramUsedMb: Math.round(used / 1024 ** 2),
    ramTotalMb: Math.round(total / 1024 ** 2),
    ...disk,
    uptimeSec: Math.round(osImpl.uptime()),
    cores: osImpl.cpus().length,
  };
}
