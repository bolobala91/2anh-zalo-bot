import { join, resolve } from 'node:path';

export function resolveDashboardPaths({ env = process.env, sidecarRoot }) {
  const home = String(env.HERMES_HOME || '').trim();
  if (!home) throw new Error('Không tìm thấy HERMES_HOME — chạy lại "npm run install:hermes" để bộ cài ghi vào .env của sidecar.');
  const hermesHome = resolve(home);
  const dataDir = join(hermesHome, 'zalo', 'dashboard');
  return {
    sidecarRoot: resolve(sidecarRoot),
    hermesHome,
    dataDir,
    usersFile: join(dataDir, 'users.json'),
    sessionsFile: join(dataDir, 'sessions.json'),
    setupFile: join(dataDir, 'setup.json'),
    telegramFile: join(dataDir, 'telegram.json'),
    watchdogFile: join(dataDir, 'watchdog.json'),
    activityFile: join(dataDir, 'activity.jsonl'),
    brandFile: join(dataDir, 'brand.json'),
    brandLogoFile: join(dataDir, 'brand', 'logo.png'),
    pendingRestartFile: join(dataDir, 'pending-restart.json'),
    sidecarEnvFile: join(resolve(sidecarRoot), '.env'),
    permissionsFile: join(hermesHome, 'zalo', 'permissions.json'),
    hermesEnvFile: join(hermesHome, '.env'),
    hermesConfigFile: join(hermesHome, 'config.yaml'),
    sqliteFile: join(resolve(sidecarRoot), 'data', 'zalo.sqlite'),
  };
}
