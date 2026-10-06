import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeRestartAssistant } from './restart-assistant.js';

function fakes({ exeExists = false, stopFails = false } = {}) {
  const spawned = []; const execs = []; const order = [];
  const spawnImpl = (...args) => { const rec = args; spawned.push(rec); order.push('spawn'); return { unref() { rec.unrefd = true; } }; };
  const execImpl = async (file, args, opts) => { execs.push([file, args, opts]); order.push('exec'); if (stopFails) throw new Error('exit 1'); return { stdout: '' }; };
  const existsImpl = (p) => exeExists && p.endsWith('hermes.exe');
  return { spawned, execs, order, spawnImpl, execImpl, existsImpl };
}

test('Linux: systemctl restart hermes-gateway', async () => {
  const f = fakes();
  await makeRestartAssistant({ platform: 'linux', hermesHome: '/h', spawnImpl: f.spawnImpl, execImpl: f.execImpl, existsImpl: f.existsImpl })();
  assert.deepEqual(f.spawned[0].slice(0, 2), ['systemctl', ['restart', 'hermes-gateway']]);
  assert.equal(f.spawned[0].unrefd, true);
  assert.equal(f.execs.length, 0);
});

test('có cmd: chạy qua shell, ẩn cửa sổ, tách rời', async () => {
  const f = fakes();
  await makeRestartAssistant({ cmd: 'do-it', platform: 'win32', hermesHome: 'C:/h', spawnImpl: f.spawnImpl, execImpl: f.execImpl, existsImpl: f.existsImpl })();
  assert.equal(f.spawned[0][0], 'do-it');
  assert.equal(f.spawned[0][1].shell, true);
  assert.equal(f.spawned[0][1].windowsHide, true);
  assert.equal(f.spawned[0][1].detached, true);
  assert.equal(f.spawned[0].unrefd, true);
  assert.equal(f.execs.length, 0);
});

test('Windows có hermes.exe: stop rồi mới chạy lại, không dùng Hermes-Online.vbs', async () => {
  const f = fakes({ exeExists: true });
  await makeRestartAssistant({ platform: 'win32', hermesHome: 'C:/h', spawnImpl: f.spawnImpl, execImpl: f.execImpl, existsImpl: f.existsImpl })();
  const exe = join('C:/h', 'bin', 'hermes.exe');
  assert.equal(f.execs[0][0], exe);
  assert.deepEqual(f.execs[0][1], ['gateway', 'stop']);
  assert.equal(f.execs[0][2].windowsHide, true);
  assert.ok(f.execs[0][2].timeout >= 1000);
  assert.deepEqual(f.order, ['exec', 'spawn']);
  assert.equal(f.spawned[0][0], exe);
  assert.deepEqual(f.spawned[0][1], ['gateway', 'run', '--accept-hooks']);
  assert.deepEqual({ ...f.spawned[0][2] }, { detached: true, windowsHide: true, stdio: 'ignore', cwd: 'C:/h' });
  assert.equal(f.spawned[0].unrefd, true);
  assert.ok(!JSON.stringify(f.execs).includes('vbs') && !JSON.stringify(f.spawned).includes('vbs'));
});

test('Windows không có hermes.exe: dùng "hermes"; stop lỗi vẫn chạy tiếp', async () => {
  const f = fakes({ exeExists: false, stopFails: true });
  const warn = console.warn; console.warn = () => {};
  try {
    await makeRestartAssistant({ platform: 'win32', hermesHome: 'C:/h', spawnImpl: f.spawnImpl, execImpl: f.execImpl, existsImpl: f.existsImpl })();
  } finally { console.warn = warn; }
  assert.equal(f.execs[0][0], 'hermes');
  assert.equal(f.spawned[0][0], 'hermes');
  assert.deepEqual(f.spawned[0][1], ['gateway', 'run', '--accept-hooks']);
});

test('spawn phát sự kiện error (ENOENT) thì rejects', async () => {
  const { EventEmitter } = await import('node:events');
  const spawnImpl = () => { const c = new EventEmitter(); c.unref = () => {}; setImmediate(() => c.emit('error', new Error('ENOENT'))); return c; };
  await assert.rejects(makeRestartAssistant({ platform: 'linux', hermesHome: '/h', spawnImpl })(), /ENOENT/);
});
