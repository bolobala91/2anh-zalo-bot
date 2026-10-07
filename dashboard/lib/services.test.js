import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { configPorts, createServiceChecker, parseSystemctl, pidAlive, tcpOpen } from './services.js';

const VPS = `9router.service           loaded active running 9Router AI Gateway
caddy.service             loaded active running Caddy
hermes-gateway.service    loaded failed failed  Hermes Agent Gateway - Messaging Platform Integration
● hermes-rag.service      loaded activating start Hermes Agent — RAG MCP service (local retrieval)
zalo-bridge.service       loaded active running 2Anh Zalo Bot sidecar (zca-js bridge for Hermes)
zalo-dashboard.service    loaded active running Zalo dashboard quản trị
hermes-old.service        not-found inactive dead hermes-old.service
`;

test('parseSystemctl: nhãn tiếng Việt, trạng thái chạy/dừng/đang bật/không có; bỏ dấu ● của dịch vụ lỗi', () => {
  const list = parseSystemctl(VPS);
  const by = Object.fromEntries(list.map((s) => [s.id, s]));
  assert.deepEqual(by['zalo-bridge'], { id: 'zalo-bridge', label: 'Kết nối Zalo', state: 'up', detail: 'zalo-bridge.service · active/running' });
  assert.equal(by['hermes-gateway'].state, 'down');
  assert.equal(by['hermes-rag'].state, 'starting');
  assert.equal(by['hermes-old'].state, 'missing');
  assert.equal(by['9router'].label, 'Cổng AI (9router)');
  for (const s of list) assert.doesNotMatch(s.label, /sidecar|bridge|toolset/i, 'nhãn không dùng thuật ngữ hạ tầng');
});

test('Linux: một lệnh systemctl chỉ đọc, có timeout và windowsHide; thiếu dịch vụ lõi thì báo "không có"; có đệm 10 giây', async () => {
  const calls = [];
  let clock = 0;
  const checker = createServiceChecker({
    platform: 'linux', hermesHome: '/root/.hermes', now: () => clock,
    execImpl: async (file, args, opts) => { calls.push([file, args, opts]); return { stdout: '9router.service loaded active running 9Router\n' }; },
  });
  const list = await checker.check();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'systemctl');
  assert.equal(calls[0][1][0], 'list-units');
  assert.ok(!calls[0][1].some((a) => /^(start|stop|restart|enable|disable)$/.test(a)), 'không bao giờ đổi trạng thái dịch vụ');
  assert.deepEqual(calls[0][2], { windowsHide: true, timeout: 5000 });
  assert.deepEqual(list.map((s) => [s.id, s.state]), [['zalo-bridge', 'missing'], ['zalo-dashboard', 'missing'], ['hermes-gateway', 'missing'], ['9router', 'up']]);
  await checker.check();
  assert.equal(calls.length, 1, 'trong 10 giây dùng lại kết quả');
  clock = 11_000;
  await checker.check();
  assert.equal(calls.length, 2);
});

test('Windows: không chạy lệnh nào — dò cổng, gateway.pid còn sống, dịch vụ cục bộ trong config.yaml', async () => {
  const home = 'E:/Hermes';
  const files = {
    [join(home, 'gateway.pid')]: '{"pid": 21336, "kind": "hermes-gateway"}',
    [join(home, 'config.yaml')]: 'model:\n  base_url: http://127.0.0.1:20128/v1\nx: http://localhost:3880\nplatforms:\n  zalo:\n    extra:\n      bridge_url: ws://127.0.0.1:3872\n',
  };
  const open = new Set([3872]);
  const checker = createServiceChecker({
    platform: 'win32', hermesHome: home,
    execImpl: async () => { throw new Error('không được chạy lệnh trên Windows'); },
    tcpImpl: async (port) => open.has(port),
    readImpl: (p) => { if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return files[p]; },
    killImpl: (pid) => { if (pid !== 21336) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); },
  });
  assert.deepEqual((await checker.check()).map((s) => [s.id, s.label, s.state]), [
    ['zalo-bridge', 'Kết nối Zalo', 'up'],
    ['zalo-dashboard', 'Dashboard quản trị', 'up'],
    ['hermes-gateway', 'Trợ lý (Hermes)', 'up'],
    ['port-20128', 'Cổng AI (9router)', 'down'],
  ]);
});

test('máy Linux không có systemd → chuyển sang dò cổng', async () => {
  const checker = createServiceChecker({
    platform: 'linux', hermesHome: '/h',
    execImpl: async () => { throw Object.assign(new Error('spawn systemctl ENOENT'), { code: 'ENOENT' }); },
    tcpImpl: async () => false, readImpl: () => { throw new Error('ENOENT'); },
  });
  assert.deepEqual((await checker.check()).map((s) => [s.id, s.state]), [['zalo-bridge', 'down'], ['zalo-dashboard', 'up'], ['hermes-gateway', 'down']]);
});

test('configPorts, pidAlive, tcpOpen thật', async (t) => {
  assert.deepEqual(configPorts('a: http://127.0.0.1:20128/v1\nb: https://localhost:1933\nc: http://10.0.0.1:80\nd: http://127.0.0.1:20128/v1beta'), [20128, 1933]);
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive(123, () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); }), true, 'có nhưng thuộc người dùng khác');
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  assert.equal(await tcpOpen(server.address().port), true);
  const closed = server.address().port;
  await new Promise((r) => server.close(r));
  assert.equal(await tcpOpen(closed, { timeoutMs: 500 }), false);
});
