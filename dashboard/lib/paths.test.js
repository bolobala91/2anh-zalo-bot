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
  assert.equal(p.sqliteFile, join(resolve('/s'), 'data', 'zalo.sqlite'));
});

test('thiếu HERMES_HOME thì báo lỗi dễ hiểu', () => {
  assert.throws(() => resolveDashboardPaths({ env: {}, sidecarRoot: '/s' }), /HERMES_HOME/);
});

test('cấu hình mặc định và ghi đè', () => {
  assert.deepEqual(loadDashboardConfig({}), { port: 3880, publicUrl: 'http://localhost:3880', restartCmd: null, assistantRestartCmd: null });
  const c = loadDashboardConfig({ ZALO_DASHBOARD_PORT: '4000', ZALO_DASHBOARD_URL: 'https://d.example.vn/', ZALO_SIDECAR_RESTART_CMD: 'systemctl restart zalo-bridge', ZALO_ASSISTANT_RESTART_CMD: ' systemctl restart hermes-gateway ' });
  assert.deepEqual(c, { port: 4000, publicUrl: 'https://d.example.vn', restartCmd: 'systemctl restart zalo-bridge', assistantRestartCmd: 'systemctl restart hermes-gateway' });
});

test('cổng sai thì quay về mặc định', () => {
  assert.equal(loadDashboardConfig({ ZALO_DASHBOARD_PORT: 'abc' }).port, 3880);
});
