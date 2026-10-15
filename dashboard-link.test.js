import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardLoginUrl } from './dashboard-link.js';

test('mở nhầm cổng sidecar → chuyển tới trang Tài khoản Zalo của dashboard', () => {
  assert.equal(dashboardLoginUrl({}, '127.0.0.1'), 'http://127.0.0.1:3880/#/zalo');
  assert.equal(dashboardLoginUrl({ ZALO_DASHBOARD_PORT: '4000' }, 'localhost'), 'http://localhost:4000/#/zalo');
  assert.equal(dashboardLoginUrl({ ZALO_DASHBOARD_URL: 'https://dashboard.truong.vn/' }, 'x'), 'https://dashboard.truong.vn/#/zalo');
  assert.equal(dashboardLoginUrl({ ZALO_DASHBOARD_URL: 'javascript:alert(1)' }, 'evil"host'), 'http://127.0.0.1:3880/#/zalo', 'địa chỉ lạ thì về mặc định');
});
