import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, createMaintenance, HERMES_UPDATE_ARGS, parseUpdateCheck, pluginVersion, runHermesUpdate } from './maintenance.js';

test('phiên bản: đọc plugin.yaml, so x.y.z, hiểu kết quả hermes update --check', () => {
  assert.equal(pluginVersion('name: zalo_tools\nversion: 2.7.0\n'), '2.7.0');
  assert.equal(pluginVersion(''), '');
  assert.ok(compareVersions('v2.10.0', '2.9.1') > 0);
  assert.equal(compareVersions('v2.7.0', '2.7.0'), 0);
  assert.ok(compareVersions('2.6.9', '2.7.0') < 0);
  assert.equal(parseUpdateCheck('→ Fetching from origin...\n\u001b[33m⚕ Update available (behind origin/main).\u001b[0m'), 'available');
  assert.equal(parseUpdateCheck('✓ Already up to date.'), 'current');
  assert.equal(parseUpdateCheck('fatal: not a git repository'), 'unknown');
});

function setup(t, over = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zalo-maint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const m = createMaintenance({
    hermesBin: 'hermes', dataDir: dir, pluginYaml: () => 'version: 2.7.0\n',
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v2.8.0', name: 'v2.8.0 — Skill', html_url: 'https://x', body: '## Mới' }) }),
    runImpl: async (file, args) => { calls.push(args); return { ok: true, out: args[0] === '--version' ? 'Hermes Agent v0.21.1 (2026.9.7)\nInstall: git' : 'Update available' }; },
    ...over,
  });
  return { dir, m, calls };
}

test('thông tin bảo trì: bản mới của bot, phiên bản Hermes; kiểm tra Hermes chỉ khi bấm', async (t) => {
  const { m, calls } = setup(t);
  const v = await m.versions();
  assert.deepEqual([v.bot.version, v.bot.latest.tag, v.bot.newer], ['2.7.0', 'v2.8.0', true]);
  assert.equal(v.hermes.version, 'Hermes Agent v0.21.1 (2026.9.7)');
  assert.equal(v.hermes.check, null);
  assert.ok(!calls.some((a) => a[0] === 'update'), 'không tự chạy update --check');
  assert.equal((await m.checkHermes()).status, 'available');
  assert.equal((await m.versions()).hermes.check.status, 'available');
});

test('mất mạng: không biết bản mới, không lỗi', async (t) => {
  const { m } = setup(t, { fetchImpl: async () => { throw new Error('offline'); } });
  const v = await m.versions();
  assert.deepEqual([v.bot.latest, v.bot.newer], [null, false]);
});

test('cập nhật Hermes: chạy tách rời với --yes --backup, ghi nhật ký; đang chạy thì từ chối', async (t) => {
  const spawned = [];
  const { m, dir } = setup(t, { spawnImpl: (file, args, opts) => { spawned.push({ file, args, opts }); const c = new EventEmitter(); c.pid = process.pid; c.unref = () => {}; setImmediate(() => c.emit('spawn')); return c; } });
  const st = await m.updateHermes();
  assert.deepEqual(spawned[0].args, ['update', '--yes', '--backup']);
  assert.equal(spawned[0].opts.detached, true);
  assert.equal(spawned[0].opts.windowsHide, true);
  assert.equal(st.running, true, 'pid còn sống');
  await assert.rejects(m.updateHermes(), { statusCode: 409 });
  writeFileSync(join(dir, 'hermes-update.log'), '\u001b[32mĐang tải…\u001b[0m\n\nXong\n');
  assert.equal(m.updateState().log, 'Đang tải…\nXong');
});

test('bản sao lưu: chỉ tên đúng mẫu trong thư mục backups', (t) => {
  const { m, dir } = setup(t);
  mkdirSync(join(dir, 'backups'));
  writeFileSync(join(dir, 'backups', 'hermes-zalo-20261010-134504.zip'), 'x');
  writeFileSync(join(dir, 'backups', 'khac.txt'), 'x');
  assert.deepEqual(m.backups().map((b) => b.file), ['hermes-zalo-20261010-134504.zip']);
  assert.throws(() => m.backupPath('../users.json'), { statusCode: 400 });
  assert.throws(() => m.backupPath('hermes-zalo-20261010-134505.zip'), { statusCode: 404 });
  assert.ok(m.backupPath('hermes-zalo-20261010-134504.zip').endsWith('hermes-zalo-20261010-134504.zip'));
});

test('cập nhật bot: chỉ lên đúng bản mới nhất; Linux+systemd chạy qua systemd-run, còn lại tách rời; đang chạy thì từ chối', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'zalo-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts', 'self-update.js'), '');
  const spawned = [];
  const fakeSpawn = (file, args, opts) => { spawned.push({ file, args, opts }); const c = new EventEmitter(); c.pid = 1; c.unref = () => {}; setImmediate(() => c.emit('spawn')); return c; };
  const { m } = setup(t, { sidecarRoot: root, spawnImpl: fakeSpawn, platform: 'linux', useSystemdRun: () => true });
  assert.deepEqual(await m.botNotice(), { current: '2.7.0', latest: 'v2.8.0', newer: true, updating: false });
  await assert.rejects(m.updateBot('v9.9.9'), { statusCode: 400 });
  const st = await m.updateBot('v2.8.0');
  assert.equal(st.running, true);
  assert.equal(spawned[0].file, 'systemd-run');
  assert.ok(spawned[0].args.includes('--collect'));
  assert.deepEqual(spawned[0].args.slice(-4), ['--to', 'v2.8.0', '--from', '2.7.0']);
  await assert.rejects(m.updateBot('v2.8.0'), { statusCode: 409 });
  assert.equal((await m.botNotice()).updating, true);

  const { m: win } = setup(t, { sidecarRoot: root, spawnImpl: fakeSpawn, platform: 'win32' });
  await win.updateBot('v2.8.0');
  assert.equal(spawned[1].file, process.execPath);
  assert.equal(spawned[1].opts.detached, true);
  assert.equal(spawned[1].opts.windowsHide, true);
});

test('cập nhật bot: bản cài cũ chưa có trình cập nhật → báo rõ; trạng thái kẹt quá 60 phút coi như hỏng', async (t) => {
  let clock = 1_000_000;
  const { m, dir } = setup(t, { sidecarRoot: join(tmpdir(), 'khong-co-thu-muc-nay'), now: () => clock });
  await assert.rejects(m.updateBot('v2.8.0'), { statusCode: 503 });
  writeFileSync(join(dir, 'bot-update.json'), JSON.stringify({ status: 'running', startedAt: clock, to: 'v2.8.0' }));
  assert.equal(m.botUpdateState().running, true);
  clock += 31 * 60_000;
  assert.equal(m.botUpdateState().running, true, 'bộ cài có thể đang chạy hermes pm install (tới 20 phút)');
  clock += 30 * 60_000;
  assert.deepEqual([m.botUpdateState().running, m.botUpdateState().status], [false, 'failed']);
});

test('cập nhật Hermes qua scripts/hermes-update.js khi biết thư mục bot (để chạy thêm hermes pm install)', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'zalo-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts', 'hermes-update.js'), '');
  const spawned = [];
  const { m } = setup(t, { hermesBin: '/opt/hermes/bin/hermes', sidecarRoot: root, spawnImpl: (file, args, opts) => { spawned.push({ file, args, opts }); const c = new EventEmitter(); c.pid = process.pid; c.unref = () => {}; setImmediate(() => c.emit('spawn')); return c; } });
  assert.equal((await m.updateHermes()).running, true);
  assert.equal(spawned[0].file, process.execPath);
  assert.deepEqual(spawned[0].args, [join(root, 'scripts', 'hermes-update.js'), '--hermes-bin', '/opt/hermes/bin/hermes']);
  assert.equal(spawned[0].opts.detached, true);
});

function updateFlow({ codes = {}, managed = true, restartFails = false } = {}) {
  const calls = []; const logs = [];
  const deps = {
    hermesBin: 'hermes',
    run: async (file, args) => { calls.push(args.join(' ')); return codes[args[0]] ?? 0; },
    managed: () => { calls.push('managed?'); return managed; },
    restartAssistant: async () => { calls.push('restart assistant'); if (restartFails) throw new Error('systemctl lỗi'); },
    log: (s) => logs.push(s),
  };
  return { calls, logs, go: () => runHermesUpdate(deps) };
}

test('runHermesUpdate: Hermes mới → update xong mới xét, rồi hermes pm install, rồi khởi động lại trợ lý', async () => {
  const { calls, logs, go } = updateFlow();
  assert.equal(await go(), 0);
  assert.deepEqual(calls, [HERMES_UPDATE_ARGS.join(' '), 'managed?', 'pm install', 'restart assistant']);
  assert.ok(logs.some((l) => l.includes('pm install')));
});

test('runHermesUpdate: Hermes cũ → chỉ hermes update như trước; update lỗi → dừng, trả mã lỗi', async () => {
  let f = updateFlow({ managed: false });
  assert.equal(await f.go(), 0);
  assert.deepEqual(f.calls, ['update --yes --backup', 'managed?']);
  f = updateFlow({ codes: { update: 2 } });
  assert.equal(await f.go(), 2);
  assert.deepEqual(f.calls, ['update --yes --backup']);
});

test('runHermesUpdate: pm install lỗi → [WARN] kèm lệnh chạy tay, không khởi động lại; khởi động lại lỗi → [WARN]', async () => {
  let f = updateFlow({ codes: { pm: 1 } });
  assert.equal(await f.go(), 0, 'Hermes vẫn đã cập nhật xong');
  assert.ok(!f.calls.includes('restart assistant'));
  assert.ok(f.logs.some((l) => l.startsWith('[WARN]') && l.includes('hermes pm install')));
  f = updateFlow({ restartFails: true });
  assert.equal(await f.go(), 0);
  assert.ok(f.logs.some((l) => l.startsWith('[WARN]') && l.includes('systemctl lỗi')));
});
