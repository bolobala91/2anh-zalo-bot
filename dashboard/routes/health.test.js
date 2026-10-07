import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeHealth, loginAs, makeDeps, startApp } from '../test-helpers.js';
import { createWatchdog } from '../lib/watchdog.js';
import { createHealthMonitor } from '../lib/health-monitor.js';

test('Sức khoẻ máy chủ: 401 khi chưa đăng nhập; Chủ bot thấy số đo + nhãn dịch vụ, không thấy tên dịch vụ hệ thống', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  assert.equal((await call('/api/server-health')).status, 401);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const r = await call('/api/server-health', { cookie: owner });
  assert.equal(r.status, 200);
  assert.equal(r.json.host.ramPct, 61);
  assert.equal(r.json.history.stepMs, 60_000);
  assert.equal(r.json.history.points.length, 2);
  assert.deepEqual(r.json.services[0], { id: 'svc-0', label: 'Kết nối Zalo', state: 'up' });
  assert.equal(r.json.services[2].label, 'Cổng AI');
  assert.doesNotMatch(JSON.stringify(r.json.services), /\.service|bridge·|detail/);
  assert.equal(r.json.usage.days[0].calls, 6);
  assert.deepEqual(r.json.threshold, { on: 90, off: 85 });
});

test('Chủ bot: id dạng svc-N, dịch vụ ngoài danh sách thân thiện là "Dịch vụ khác" — không lộ tên unit hay số cổng', async (t) => {
  const services = async () => [
    { id: 'zalo-bridge', label: 'Kết nối Zalo', state: 'up', detail: 'cổng 3872' },
    { id: 'caddy', label: 'Máy chủ web (HTTPS)', state: 'up', detail: 'caddy.service · active/running' },
    { id: 'hermes-rag', label: 'Tra cứu tài liệu', state: 'up', detail: 'hermes-rag.service · active/running' },
    { id: 'port-8765', label: 'Dịch vụ cục bộ cổng 8765', state: 'down', detail: '127.0.0.1:8765' },
    { id: 'port-20128', label: 'Cổng AI (9router)', state: 'up', detail: '127.0.0.1:20128' },
  ];
  const deps = makeDeps(t, { health: fakeHealth({ services }) });
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const r = await call('/api/server-health', { cookie: owner });
  assert.deepEqual(r.json.services.map((s) => [s.id, s.label]), [
    ['svc-0', 'Kết nối Zalo'], ['svc-1', 'Máy chủ web'], ['svc-2', 'Dịch vụ khác'], ['svc-3', 'Dịch vụ khác'], ['svc-4', 'Cổng AI'],
  ]);
  const text = JSON.stringify(r.json.services);
  assert.doesNotMatch(text, /hermes|caddy|rag|port-|zalo-bridge|\d{4,5}|cổng \d/i);
});

test('Quản trị thấy thêm chi tiết dịch vụ; cảnh báo máy chủ đang mở hiện ở alerts; đọc dịch vụ lỗi vẫn trả số đo', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-hr-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let clock = 0;
  const watchdog = createWatchdog({ sidecar: { health: async () => ({}) }, notify: async () => {}, restartSidecar: async () => {},
    stateFile: join(dir, 'wd.json'), publicUrl: 'http://localhost:3880', now: () => clock });
  await watchdog.checkHost({ diskPct: 95, ramPct: 40, cpuPct: 10 });
  clock = 60_000; await watchdog.checkHost({ diskPct: 95, ramPct: 40, cpuPct: 10 });
  const deps = makeDeps(t, { watchdog, health: fakeHealth({ services: async () => { throw new Error('systemctl treo'); } }) });
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const r = await call('/api/server-health', { cookie: admin });
  assert.equal(r.status, 200);
  assert.equal(r.json.servicesError, true);
  assert.deepEqual(r.json.services, []);
  assert.deepEqual(r.json.alerts, [{ kind: 'disk', since: 0, alerted: true }]);
  const again = makeDeps(t);
  const app2 = await startApp(t, again);
  const admin2 = await loginAs(t, again, app2.call);
  const r2 = await app2.call('/api/server-health', { cookie: admin2 });
  assert.equal(r2.json.services[1].detail, 'hermes-gateway.service · failed/failed');
});

test('health monitor: mỗi lần tick đo một lần, lấy mẫu AI mỗi 5 lần, đưa số đo cho canh gác', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-hm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const checked = [];
  let n = 0;
  const m = createHealthMonitor({
    diskPath: dir, historyFile: join(dir, 'h.json'), usageFile: join(dir, 'u.json'), stateDb: join(dir, 'khong-co.db'),
    services: { check: async () => [] }, watchdog: { checkHost: async (s) => { checked.push(s.cpuPct); } },
    read: () => ({ at: ++n * 60_000, cpuPct: n, ramPct: 50, diskPct: 40 }), now: () => n * 60_000,
  });
  assert.equal(m.latest(), null, 'chưa đo lần nào');
  for (let i = 0; i < 6; i++) await m.tick();
  assert.equal(m.latest().cpuPct, 6);
  assert.equal(m.points().length, 6);
  assert.deepEqual(checked, [1, 2, 3, 4, 5, 6]);
  assert.equal(m.usage().error, 'missing', 'chưa có state.db → báo thiếu, không ném lỗi');
});

test('health monitor: nhịp trước còn chạy thì bỏ qua nhịp sau; flush ghi lịch sử', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-hm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let release; let reads = 0;
  const m = createHealthMonitor({
    diskPath: dir, historyFile: join(dir, 'h.json'), usageFile: join(dir, 'u.json'), stateDb: join(dir, 'khong-co.db'),
    services: { check: async () => [] }, watchdog: { checkHost: () => new Promise((r) => { release = r; }) },
    read: () => ({ at: ++reads * 60_000, cpuPct: 1, ramPct: 2, diskPct: 3 }), now: () => reads * 60_000,
  });
  const first = m.tick();
  await m.tick(); // bị bỏ qua
  assert.equal(reads, 1);
  release(); await first;
  const third = m.tick(); release(); await third;
  assert.equal(reads, 2);
  m.flush();
  assert.equal(JSON.parse(readFileSync(join(dir, 'h.json'), 'utf8')).points.length, 2);
});
