import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRestartSidecar } from './restart.js';

function fakes({ netstat = '' } = {}) {
  const calls = []; const execCalls = [];
  const spawnImpl = (...args) => { const rec = args; calls.push(rec); return { unref() { rec.unrefd = true; } }; };
  const execImpl = async (file, args, opts) => { execCalls.push([file, args, opts]); return { stdout: file === 'netstat' ? netstat : '' }; };
  return { calls, execCalls, spawnImpl, execImpl };
}
const LINE = (port, pid, state = 'LISTENING') =>
  `  TCP    127.0.0.1:${port}        0.0.0.0:0              ${state}       ${pid}\n`;
const HEAD = '  Proto  Local Address          Foreign Address        State           PID\n';

test('Linux không cmd: systemctl restart zalo-bridge', async () => {
  const f = fakes();
  await makeRestartSidecar({ platform: 'linux', sidecarRoot: '/x', spawnImpl: f.spawnImpl, execImpl: f.execImpl })();
  assert.deepEqual(f.calls[0].slice(0, 2), ['systemctl', ['restart', 'zalo-bridge']]);
  assert.equal(f.calls[0].unrefd, true);
  assert.equal(f.execCalls.length, 0);
});

test('có cmd: chạy qua shell, ẩn cửa sổ, không đụng netstat', async () => {
  const f = fakes();
  await makeRestartSidecar({ cmd: 'start-it', platform: 'win32', sidecarRoot: 'C:/x', spawnImpl: f.spawnImpl, execImpl: f.execImpl })();
  assert.equal(f.calls[0][0], 'start-it');
  assert.equal(f.calls[0][1].shell, true);
  assert.equal(f.calls[0][1].windowsHide, true);
  assert.equal(f.calls[0].unrefd, true);
  assert.equal(f.execCalls.length, 0);
});

test('Windows: giết đúng tiến trình đang LISTEN cổng rồi mới spawn', async () => {
  const f = fakes({ netstat: HEAD + LINE(3872, 4321) + LINE(5000, 999) });
  await makeRestartSidecar({ platform: 'win32', sidecarRoot: 'C:/x', spawnImpl: f.spawnImpl, execImpl: f.execImpl, ownPid: 1 })();
  assert.equal(f.execCalls[0][0], 'netstat');
  assert.deepEqual(f.execCalls[0][1], ['-ano', '-p', 'tcp']);
  assert.equal(f.execCalls.length, 2);
  assert.equal(f.execCalls[1][0], 'taskkill');
  assert.deepEqual(f.execCalls[1][1], ['/PID', '4321', '/F']);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], process.execPath);
  assert.deepEqual(f.calls[0][1], ['server.js']);
  assert.equal(f.calls[0][2].cwd, 'C:/x');
  assert.equal(f.calls[0][2].windowsHide, true);
  assert.equal(f.calls[0].unrefd, true);
});

test('Windows: dòng cổng khác / không LISTENING / cổng có tiền tố trùng bị bỏ qua', async () => {
  const f = fakes({ netstat: HEAD + LINE(5000, 999) + LINE(3872, 77, 'TIME_WAIT') + LINE(38720, 55) });
  await makeRestartSidecar({ platform: 'win32', sidecarRoot: 'C:/x', spawnImpl: f.spawnImpl, execImpl: f.execImpl })();
  assert.equal(f.execCalls.filter((c) => c[0] === 'taskkill').length, 0);
  assert.equal(f.calls.length, 1);
});

test('Windows: tuỳ chọn port được dùng', async () => {
  const f = fakes({ netstat: HEAD + LINE(4000, 12) });
  await makeRestartSidecar({ platform: 'win32', sidecarRoot: 'C:/x', port: 4000, spawnImpl: f.spawnImpl, execImpl: f.execImpl, ownPid: 1 })();
  assert.deepEqual(f.execCalls[1][1], ['/PID', '12', '/F']);
});

test('Windows: không bao giờ giết chính tiến trình này', async () => {
  const f = fakes({ netstat: HEAD + LINE(3872, 555) });
  await makeRestartSidecar({ platform: 'win32', sidecarRoot: 'C:/x', spawnImpl: f.spawnImpl, execImpl: f.execImpl, ownPid: 555 })();
  assert.equal(f.execCalls.filter((c) => c[0] === 'taskkill').length, 0);
  assert.equal(f.calls.length, 1);
});

test('Windows: netstat và taskkill đều ẩn cửa sổ', async () => {
  const f = fakes({ netstat: HEAD + LINE(3872, 4321) });
  await makeRestartSidecar({ platform: 'win32', sidecarRoot: 'C:/x', spawnImpl: f.spawnImpl, execImpl: f.execImpl, ownPid: 1 })();
  for (const c of f.execCalls) assert.equal(c[2].windowsHide, true);
});
