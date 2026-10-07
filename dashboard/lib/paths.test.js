import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { resolveDashboardPaths } from './paths.js';
import { loadDashboardConfig } from './config.js';

test('đường dẫn dựng từ HERMES_HOME và thư mục sidecar', () => {
  const p = resolveDashboardPaths({ env: { HERMES_HOME: '/h' }, sidecarRoot: '/s' });
  assert.equal(p.dataDir, join(resolve('/h'), 'zalo', 'dashboard'));
  assert.equal(p.usersFile, join(resolve('/h'), 'zalo', 'dashboard', 'users.json'));
  assert.equal(p.permissionsFile, join(resolve('/h'), 'zalo', 'permissions.json'));
  assert.equal(p.hermesEnvFile, join(resolve('/h'), '.env'));
  assert.equal(p.hermesConfigFile, join(resolve('/h'), 'config.yaml'));
  assert.equal(p.sqliteFile, join(resolve('/s'), 'data', 'zalo.sqlite'));
  assert.equal(p.brandLogoFile, join(resolve('/h'), 'zalo', 'dashboard', 'brand', 'logo.png'));
  assert.equal(p.pendingRestartFile, join(resolve('/h'), 'zalo', 'dashboard', 'pending-restart.json'));
  assert.equal(p.sidecarEnvFile, join(resolve('/s'), '.env'));
});

test('thiếu HERMES_HOME thì báo lỗi dễ hiểu', () => {
  assert.throws(() => resolveDashboardPaths({ env: {}, sidecarRoot: '/s' }), /HERMES_HOME/);
});

test('cấu hình mặc định và ghi đè', () => {
  assert.deepEqual(loadDashboardConfig({}), { port: 3880, publicUrl: 'http://localhost:3880', restartCmd: null, assistantRestartCmd: null, suggestedZaloUid: '' });
  const c = loadDashboardConfig({ ZALO_DASHBOARD_PORT: '4000', ZALO_DASHBOARD_URL: 'https://d.example.vn/', ZALO_SIDECAR_RESTART_CMD: 'systemctl restart zalo-bridge', ZALO_ASSISTANT_RESTART_CMD: ' systemctl restart hermes-gateway ' });
  assert.deepEqual(c, { port: 4000, publicUrl: 'https://d.example.vn', restartCmd: 'systemctl restart zalo-bridge', assistantRestartCmd: 'systemctl restart hermes-gateway', suggestedZaloUid: '' });
});

test('publicUrl mặc định dùng đúng cổng đã cấu hình', () => {
  assert.equal(loadDashboardConfig({ ZALO_DASHBOARD_PORT: '4100' }).publicUrl, 'http://localhost:4100');
});

test('UID gợi ý = UID hợp lệ đầu tiên trong ZALO_ALLOWED_USERS', () => {
  assert.equal(loadDashboardConfig({ ZALO_ALLOWED_USERS: ' 1234567890123456 , 9876543210987654' }).suggestedZaloUid, '1234567890123456');
  assert.equal(loadDashboardConfig({ ZALO_ALLOWED_USERS: 'abc,0123456789012345,2234567890123456' }).suggestedZaloUid, '2234567890123456');
  assert.equal(loadDashboardConfig({ ZALO_ALLOWED_USERS: '' }).suggestedZaloUid, '');
});

test('cổng sai thì quay về mặc định', () => {
  assert.equal(loadDashboardConfig({ ZALO_DASHBOARD_PORT: 'abc' }).port, 3880);
});
