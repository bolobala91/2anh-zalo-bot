import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderSystemdUnit, renderWindowsStartup, installDashboardService,
  uninstallDashboardService, caddySnippet,
} from './dashboard-service.js';

test('systemd unit has ExecStart, WorkingDirectory and restart policy', () => {
  const unit = renderSystemdUnit({ sidecarRoot: '/opt/zalo', nodePath: '/usr/bin/node' });
  assert.match(unit, /^ExecStart=\/usr\/bin\/node \/opt\/zalo\/dashboard\/server\.js$/m);
  assert.match(unit, /^WorkingDirectory=\/opt\/zalo$/m);
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^RestartSec=5$/m);
  assert.match(unit, /^After=network-online\.target zalo-bridge\.service$/m);
});

test('windows startup script runs hidden, never shows a dialog, quotes spaced paths', () => {
  const vbs = renderWindowsStartup({ sidecarRoot: 'C:\\Program Files\\zalo', nodePath: 'C:\\Program Files\\nodejs\\node.exe' });
  assert.ok(vbs.includes('dashboard\\server.js'));
  assert.ok(vbs.includes(', 0, False'));
  assert.ok(vbs.includes('CurrentDirectory = "C:\\Program Files\\zalo"'));
  assert.ok(vbs.includes('""C:\\Program Files\\nodejs\\node.exe""'));
  assert.doesNotMatch(vbs, /MsgBox|Popup/i);
});

function recorder(status = 0) {
  const calls = [];
  return { calls, runner: (cmd, args) => { calls.push([cmd, ...args]); return { status }; } };
}

test('installDashboardService on Linux writes the unit and enables it', () => {
  const { calls, runner } = recorder();
  const written = [];
  const result = installDashboardService({
    sidecarRoot: '/opt/zalo', platform: 'linux', nodePath: '/usr/bin/node', runner,
    writeFile: (path, content) => written.push([path, content]),
    isRoot: true, hasSystemd: true,
  });
  assert.equal(result.installed, true);
  assert.equal(written[0][0], '/etc/systemd/system/zalo-dashboard.service');
  assert.match(written[0][1], /Restart=always/);
  assert.deepEqual(calls, [
    ['systemctl', 'daemon-reload'],
    ['systemctl', 'enable', '--now', 'zalo-dashboard'],
  ]);
});

test('installDashboardService on Linux without root or systemd returns instructions, never throws', () => {
  const { calls, runner } = recorder();
  for (const opts of [{ isRoot: false, hasSystemd: true }, { isRoot: true, hasSystemd: false }]) {
    const result = installDashboardService({
      sidecarRoot: '/opt/zalo', platform: 'linux', runner, writeFile: () => { throw new Error('không được ghi'); }, ...opts,
    });
    assert.equal(result.installed, false);
    assert.match(result.detail, /npm run dashboard/);
  }
  assert.deepEqual(calls, []);
});

test('installDashboardService on Linux reports failure when systemctl fails', () => {
  const { runner } = recorder(1);
  const result = installDashboardService({
    sidecarRoot: '/opt/zalo', platform: 'linux', runner, writeFile: () => {}, isRoot: true, hasSystemd: true,
  });
  assert.equal(result.installed, false);
});

test('installDashboardService on Windows writes into startupDir and launches it with wscript', () => {
  const { calls, runner } = recorder();
  const written = [];
  const result = installDashboardService({
    sidecarRoot: 'C:\\zalo', platform: 'win32', nodePath: 'C:\\node.exe', runner,
    writeFile: (path, content) => written.push([path, content]), startupDir: 'C:\\Startup',
  });
  assert.equal(result.installed, true);
  assert.match(written[0][0], /^C:\\Startup[\\/]zalo-dashboard\.vbs$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'wscript');
  assert.match(calls[0][1], /zalo-dashboard\.vbs$/);
});

test('uninstallDashboardService removes exactly the files it wrote', () => {
  const lin = recorder();
  const removed = [];
  const a = uninstallDashboardService({
    platform: 'linux', runner: lin.runner, isRoot: true, hasSystemd: true,
    exists: () => true, removeFile: (p) => removed.push(p),
  });
  assert.deepEqual(removed, ['/etc/systemd/system/zalo-dashboard.service']);
  assert.deepEqual(a.removed, removed);
  assert.deepEqual(lin.calls[0], ['systemctl', 'disable', '--now', 'zalo-dashboard']);

  const removedWin = [];
  const b = uninstallDashboardService({
    platform: 'win32', startupDir: 'C:\\Startup', exists: () => true, removeFile: (p) => removedWin.push(p),
  });
  assert.equal(removedWin.length, 1);
  assert.match(removedWin[0], /zalo-dashboard\.vbs$/);
  assert.equal(b.removed.length, 1);

  const none = uninstallDashboardService({ platform: 'win32', startupDir: 'C:\\Startup', exists: () => false, removeFile: () => { throw new Error('x'); } });
  assert.deepEqual(none.removed, []);
});

test('caddySnippet only for https public URLs', () => {
  const block = caddySnippet('https://d.vn');
  assert.match(block, /d\.vn \{/);
  assert.match(block, /reverse_proxy 127\.0\.0\.1:3880/);
  assert.match(caddySnippet('https://d.vn', 4000), /127\.0\.0\.1:4000/);
  assert.equal(caddySnippet('http://localhost:3880'), '');
  assert.equal(caddySnippet(''), '');
});
