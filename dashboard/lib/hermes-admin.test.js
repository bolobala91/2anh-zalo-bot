import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { createHermesAdmin, locateHermesPython } from './hermes-admin.js';

test('tìm Python của Hermes: biến môi trường → venv trong HERMES_HOME → venv cạnh lệnh hermes trên PATH', () => {
  const have = (...paths) => (p) => paths.includes(p);
  const winPy = join('E:/Hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe');
  const win = locateHermesPython({ hermesHome: 'E:/Hermes', env: {}, platform: 'win32', managed: () => '', exists: have(winPy, join('E:/Hermes', 'hermes-agent', 'hermes_cli')) });
  assert.deepEqual(win, { python: winPy, root: join('E:/Hermes', 'hermes-agent') });

  const real = '/opt/h/hermes-agent/.venv/bin/hermes';
  const linux = locateHermesPython({
    hermesHome: '/root/.hermes', env: { PATH: '/usr/bin:/usr/local/bin' }, platform: 'linux',
    exists: have(join('/usr/local/bin', 'hermes'), join('/opt/h/hermes-agent/.venv/bin', 'python'), join('/opt/h/hermes-agent', 'hermes_cli')),
    real: () => real, managed: () => '',
  });
  assert.equal(linux.root, join('/opt/h/hermes-agent'));

  assert.equal(locateHermesPython({ hermesHome: '/x', env: { ZALO_HERMES_PYTHON: '/bad/python' }, platform: 'linux', exists: () => false, managed: () => '' }), null);
});

test('Hermes mới (hermes pm): dùng Python của môi trường do Hermes quản lý, mã Hermes vẫn là thư mục cài', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { managedEnvPython } = await import('./hermes-admin.js');
  const home = mkdtempSync(join(tmpdir(), 'zd-pm-'));
  try {
    const env = join(home, 'installs', 'abc', 'environments', 'e1', 'venv');
    const py = process.platform === 'win32' ? join(env, 'Scripts', 'python.exe') : join(env, 'bin', 'python');
    mkdirSync(join(py, '..'), { recursive: true }); writeFileSync(py, '');
    writeFileSync(join(home, 'installs', 'abc', 'facts.json'), JSON.stringify({ packages: { venv: { environment: env } } }));
    mkdirSync(join(home, 'installs', 'old'), { recursive: true });
    writeFileSync(join(home, 'installs', 'old', 'facts.json'), JSON.stringify({ packages: { venv: { environment: join(home, 'gone') } } }));
    assert.equal(managedEnvPython(home), py, 'bỏ môi trường đã mất');
    assert.equal(managedEnvPython(join(home, 'khong-co')), '');
  } finally { rmSync(home, { recursive: true, force: true }); }
  const have = (...paths) => (p) => paths.includes(p);
  const oldPy = join('/opt/hermes/hermes-agent', '.venv', 'bin', 'python');
  const r = locateHermesPython({ hermesHome: '/root/.hermes', env: {}, platform: 'linux', real: (x) => x,
    exists: have(oldPy, join('/opt/hermes/hermes-agent', 'hermes_cli')), managed: () => '/root/.hermes/installs/a/environments/e/venv/bin/python' });
  assert.deepEqual(r, { python: '/root/.hermes/installs/a/environments/e/venv/bin/python', root: join('/opt/hermes/hermes-agent'), managed: true });
});

function fakeSpawn(script) {
  const calls = [];
  const spawnImpl = (file, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    let input = '';
    child.stdin = { end: (s) => { input = s; setImmediate(() => { const r = script(args[1], JSON.parse(input), calls.length); if (r.stderr) child.stderr.emit('data', r.stderr); child.stdout.emit('data', r.stdout); child.emit('close', 0); }); } };
    child.kill = () => {};
    calls.push({ file, args, opts });
    return child;
  };
  return { calls, spawnImpl };
}

test('chạy lệnh: tham số qua stdin, đọc dòng JSON cuối; lỗi người dùng → 400, lỗi lạ → 500 câu chung', async (t) => {
  const { calls, spawnImpl } = fakeSpawn((cmd, args) => {
    if (cmd === 'skills.list') return { stdout: 'rác in lẫn\n{"ok": true, "skills": [1]}\n' };
    if (cmd === 'skills.toggle') return { stdout: '{"ok": false, "error": "Skill này là lõi", "user": true}\n' };
    return { stdout: '{"ok": false, "error": "KeyError: secret"}\n', stderr: 'Traceback' };
  });
  t.mock.method(console, 'error', () => {});
  const admin = createHermesAdmin({ hermesHome: '/h', locate: () => ({ python: '/py', root: '/root' }), spawnImpl });
  assert.deepEqual((await admin.read('skills.list')).skills, [1]);
  assert.equal(calls[0].opts.cwd, '/root');
  assert.equal(calls[0].opts.env.HERMES_HOME, '/h');
  assert.equal(calls[0].opts.windowsHide, true);
  await assert.rejects(admin.write('skills.toggle', { name: 'x' }), { statusCode: 400, message: 'Skill này là lõi' });
  await assert.rejects(admin.read('hub.scan'), (e) => e.statusCode === 500 && !/secret/.test(e.message));
});

test('lệnh ghi chạy lần lượt; không tìm thấy Python → 503', async () => {
  const order = [];
  let live = 0;
  const spawnImpl = (file, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    child.stdin = { end: () => {
      live += 1; order.push(`start ${args[1]} (${live})`);
      setTimeout(() => { live -= 1; child.stdout.emit('data', '{"ok": true}\n'); child.emit('close', 0); }, 5);
    } };
    return child;
  };
  const admin = createHermesAdmin({ hermesHome: '/h', locate: () => ({ python: '/py', root: '/r' }), spawnImpl });
  await Promise.all([admin.write('a'), admin.write('b'), admin.write('c')]);
  assert.deepEqual(order, ['start a (1)', 'start b (1)', 'start c (1)']);
  const none = createHermesAdmin({ hermesHome: '/h', locate: () => null });
  assert.equal(none.available(), false);
  assert.throws(() => none.read('skills.list'), { statusCode: 503 });
});
