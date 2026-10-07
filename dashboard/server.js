#!/usr/bin/env node
/**
 * Dashboard quản trị Zalo — tiến trình riêng. Sống độc lập với sidecar và Hermes
 * để vẫn báo lỗi và cho quét QR đúng lúc các phần kia hỏng.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRepoEnv, loadHermesEnv } from '../scripts/setup-env.js';
import { createDashboardApp } from './app.js';
import { resolveDashboardPaths } from './lib/paths.js';
import { loadDashboardConfig } from './lib/config.js';
import { createUserStore } from './lib/users.js';
import { createSessionStore } from './lib/sessions.js';
import { createLoginGuard } from './lib/login-guard.js';
import { createSetupToken } from './lib/setup-token.js';
import { createActivityLog } from './lib/activity-log.js';
import { createSidecarClient } from './lib/sidecar-client.js';
import { createTelegramLinker } from './lib/telegram.js';
import { createStoreReader } from './lib/store-reader.js';
import { createThreadNames } from './lib/thread-names.js';
import { createPermissionsStore, makeDmEnv, makeGlobalReplyOnlyTagged } from './lib/permissions.js';
import { createWatchdog } from './lib/watchdog.js';
import { makeRestartSidecar } from './lib/restart.js';
import { makeRestartAssistant } from './lib/restart-assistant.js';
import { createBrandStore } from './lib/brand.js';
import { createOwnersStore } from './lib/owners.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * @param {object} [opts]
 * @param {string} [opts.inheritedReplyOnlyTagged] ZALO_GROUP_REPLY_ONLY_TAGGED trong môi trường dịch vụ, chụp trước khi
 *   nạp .env của sidecar — .env của sidecar không phải nơi bot đọc cờ này.
 * @param {string} [opts.inheritedOwners] ZALO_ALLOWED_USERS trong môi trường dịch vụ, chụp trước khi nạp bất kỳ .env nào.
 */
export function buildDeps({ env = process.env, sidecarRoot = join(here, '..'), inheritedReplyOnlyTagged, inheritedOwners, inheritedDm = {} } = {}) {
  if (!env.ZALO_BRIDGE_TOKEN) throw new Error('Thiếu ZALO_BRIDGE_TOKEN trong .env của sidecar — chạy lại "npm run install:hermes".');
  const paths = resolveDashboardPaths({ env, sidecarRoot });
  const config = loadDashboardConfig(env);
  const sidecarPort = Number(env.ZCA_PORT) || 3872;
  const sidecar = createSidecarClient({ token: env.ZALO_BRIDGE_TOKEN, baseUrl: `http://127.0.0.1:${sidecarPort}` });
  const users = createUserStore(paths.usersFile);
  const linker = createTelegramLinker({
    file: paths.telegramFile, hermesTelegramToken: String(env.TELEGRAM_BOT_TOKEN || '').trim(),
    isActive: (username) => { const u = users.get(username); return Boolean(u && !u.disabled); },
  });
  const restartSidecar = makeRestartSidecar({ cmd: config.restartCmd, sidecarRoot: paths.sidecarRoot, port: sidecarPort });
  let botName = 'Bot Zalo';
  const watchedSidecar = { health: async () => { const h = await sidecar.health(); if (h?.zalo?.displayName) botName = h.zalo.displayName; return h; } };
  return {
    paths, config, sidecar, linker,
    store: createStoreReader({ path: paths.sqliteFile }),
    threadNames: createThreadNames({ loadGroups: () => sidecar.groups() }),
    users,
    sessions: createSessionStore(paths.sessionsFile),
    guard: createLoginGuard(),
    setupToken: createSetupToken(paths.setupFile),
    activity: createActivityLog(paths.activityFile),
    // Cờ tag chung đọc đúng nguồn adapter đọc (.env và config.yaml của Hermes), đọc lại khi tệp đổi.
    permissions: createPermissionsStore({
      file: paths.permissionsFile,
      globalReplyOnlyTagged: makeGlobalReplyOnlyTagged({
        envFile: paths.hermesEnvFile, configFile: paths.hermesConfigFile, inherited: inheritedReplyOnlyTagged,
      }),
      dmEnv: makeDmEnv({ envFile: paths.hermesEnvFile, configFile: paths.hermesConfigFile, inherited: inheritedDm }),
    }),
    watchdog: createWatchdog({
      sidecar: watchedSidecar, notify: (text) => linker.broadcast(text),
      restartSidecar,
      stateFile: paths.watchdogFile, publicUrl: config.publicUrl, botName: () => botName,
    }),
    restartAssistant: makeRestartAssistant({ cmd: config.assistantRestartCmd, hermesHome: paths.hermesHome }),
    restartSidecar,
    owners: createOwnersStore({ envFile: paths.hermesEnvFile, sidecarEnvFile: paths.sidecarEnvFile, pendingFile: paths.pendingRestartFile, inheritedValue: inheritedOwners }),
    brand: createBrandStore({ file: paths.brandFile, logoFile: paths.brandLogoFile }),
    publicDir: join(here, 'public'),
  };
}

async function main() {
  const sidecarRoot = join(here, '..');
  const inheritedReplyOnlyTagged = process.env.ZALO_GROUP_REPLY_ONLY_TAGGED;
  const inheritedOwners = process.env.ZALO_ALLOWED_USERS; // trước khi nạp .env nào
  const inheritedDm = Object.fromEntries(['ZALO_DM_POLICY', 'ZALO_ALLOW_ALL_USERS', 'GATEWAY_ALLOW_ALL_USERS'].map((k) => [k, process.env[k]]));
  if (existsSync(join(sidecarRoot, '.env'))) loadRepoEnv(join(sidecarRoot, '.env'));
  loadHermesEnv();
  const deps = buildDeps({ sidecarRoot, inheritedReplyOnlyTagged, inheritedOwners, inheritedDm });
  // Chủ nhân đọc từ tệp .env, không từ môi trường: tiến trình con khởi động lại sẽ thừa hưởng bản cũ và không bao giờ áp dụng danh sách mới.
  delete process.env.ZALO_ALLOWED_USERS;
  const app = createDashboardApp(deps);
  app.listen(deps.config.port, '127.0.0.1', () => console.log(`[dashboard] đang chạy tại ${deps.config.publicUrl} (127.0.0.1:${deps.config.port})`));
  const tick = async () => { try { await deps.watchdog.tick(); } catch (e) { console.warn('[watchdog]', e.message); } };
  setInterval(tick, 30_000); tick();
  (async function poll() {
    for (;;) {
      if (!deps.linker.configured()) { await new Promise((r) => setTimeout(r, 15_000)); continue; }
      try { await deps.linker.pollOnce(25); } catch (e) { console.warn('[telegram]', e.message); await new Promise((r) => setTimeout(r, 10_000)); }
    }
  })();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error('[dashboard]', e.message); process.exitCode = 1; });
