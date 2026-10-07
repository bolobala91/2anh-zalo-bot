import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCpuMeter, readHost } from './host-metrics.js';
import { createHealthHistory } from './health-history.js';

const core = (busy, idle) => ({ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } });

test('CPU: phần trăm bận trung bình mọi nhân giữa hai lần đo; không đổi gì → 0', () => {
  let snap = [core(100, 900), core(100, 900)];
  const cpu = createCpuMeter({ cpus: () => snap });
  snap = [core(190, 910), core(160, 940)]; // +90/+10 và +60/+40 → 150 bận / 200
  assert.equal(cpu.sample(), 75);
  assert.equal(cpu.sample(), 0);
});

test('readHost: RAM, ổ đĩa (đúng ổ chứa dữ liệu bot), thời gian chạy; ổ đĩa lỗi → null', () => {
  const osImpl = { totalmem: () => 4 * 1024 ** 3, freemem: () => 1024 ** 3, uptime: () => 3600.4, cpus: () => [{}, {}] };
  const seen = [];
  const statfsImpl = (p) => { seen.push(p); return { blocks: 1000, bsize: 1024 ** 2, bavail: 100 }; };
  const s = readHost({ cpu: { sample: () => 12.3 }, diskPath: '/root/.hermes', osImpl, statfsImpl, now: () => 5 });
  assert.deepEqual(s, {
    at: 5, cpuPct: 12.3, ramPct: 75, ramUsedMb: 3072, ramTotalMb: 4096,
    diskPct: 90, diskUsedGb: 0.9, diskTotalGb: 1, uptimeSec: 3600, cores: 2,
  });
  assert.deepEqual(seen, ['/root/.hermes']);
  const broken = readHost({ cpu: { sample: () => 0 }, diskPath: 'Z:/khong-co', osImpl, statfsImpl: () => { throw new Error('ENOENT'); } });
  assert.equal(broken.diskPct, null);
  assert.equal(broken.diskTotalGb, null);
});

test('readHost chạy được trên máy thật (Linux lẫn Windows) không cần lệnh nào', () => {
  const s = readHost({ cpu: createCpuMeter(), diskPath: tmpdir() });
  assert.ok(s.ramPct > 0 && s.ramPct <= 100);
  assert.ok(s.diskPct > 0 && s.diskPct <= 100);
  assert.ok(s.cores >= 1);
});

test('lịch sử 24 giờ: bỏ điểm quá 24 giờ, ghi tệp quyền 600 mỗi 5 điểm, khởi động lại đọc lại; tệp hỏng → trống', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-health-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'health-history.json');
  let clock = 0;
  const h = createHealthHistory({ file, now: () => clock });
  for (let i = 0; i < 5; i++) { clock = i * 60_000; h.add({ at: clock, cpuPct: i, ramPct: 50, diskPct: null }); }
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).points[4], [240_000, 4, 50, null]);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  clock = 24 * 3600_000 + 90_000; // điểm 0 và 1 quá 24 giờ
  const again = createHealthHistory({ file, now: () => clock });
  assert.deepEqual(again.points().map((p) => p[0]), [120_000, 180_000, 240_000]);
  writeFileSync(file, '{hỏng');
  assert.deepEqual(createHealthHistory({ file, now: () => clock }).points(), []);
});
