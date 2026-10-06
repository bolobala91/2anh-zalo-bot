#!/usr/bin/env node
// Đặt lại mật khẩu Quản trị: npm run dashboard:reset-admin -- --username <tên> --password <mật khẩu mới>
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadRepoEnv, loadHermesEnv } from '../../scripts/setup-env.js';
import { resolveDashboardPaths } from '../lib/paths.js';
import { createUserStore, validateUsername } from '../lib/users.js';
import { createSessionStore } from '../lib/sessions.js';

const USAGE = 'Cách dùng: npm run dashboard:reset-admin -- --username <tên> --password <mật khẩu mới (từ 8 ký tự)>';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

try {
  const rawName = arg('username');
  const password = arg('password');
  if (!rawName || !password) {
    console.error(USAGE);
    process.exitCode = 1;
  } else {
    const username = validateUsername(rawName);
    const sidecarRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    if (existsSync(join(sidecarRoot, '.env'))) loadRepoEnv(join(sidecarRoot, '.env'));
    loadHermesEnv();
    const paths = resolveDashboardPaths({ sidecarRoot });
    const users = createUserStore(paths.usersFile);
    if (!users.get(username)) users.create({ username, role: 'admin', password });
    else {
      users.setPassword(username, password);
      users.update(username, { disabled: false, role: 'admin' });
    }
    createSessionStore(paths.sessionsFile).destroyAll(username);
    console.log(`Đã đặt lại mật khẩu cho Quản trị "${username}". Mọi phiên đăng nhập cũ đã bị gỡ — đăng nhập lại bằng mật khẩu mới.`);
  }
} catch (err) {
  console.error(`Không đặt lại được: ${err.message}`);
  process.exitCode = 1;
}
