#!/usr/bin/env node
// In link thiết lập tài khoản Quản trị đầu tiên (dùng một lần, 24 giờ).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadRepoEnv, loadHermesEnv } from '../../scripts/setup-env.js';
import { resolveDashboardPaths } from '../lib/paths.js';
import { loadDashboardConfig } from '../lib/config.js';
import { createUserStore } from '../lib/users.js';
import { createSetupToken } from '../lib/setup-token.js';

try {
  const sidecarRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (existsSync(join(sidecarRoot, '.env'))) loadRepoEnv(join(sidecarRoot, '.env'));
  loadHermesEnv();
  const paths = resolveDashboardPaths({ sidecarRoot });
  const config = loadDashboardConfig();
  if (createUserStore(paths.usersFile).hasAdmin()) {
    console.log('Đã có tài khoản Quản trị. Quên mật khẩu thì chạy: npm run dashboard:reset-admin -- --username <tên> --password <mật khẩu mới>');
  } else {
    const token = createSetupToken(paths.setupFile).issue();
    console.log(`Mở link sau trong 24 giờ để tạo tài khoản Quản trị:\n${config.publicUrl}/#/setup/${token}`);
  }
} catch (err) {
  console.error(`Không tạo được link thiết lập: ${err.message}`);
  process.exitCode = 1;
}
