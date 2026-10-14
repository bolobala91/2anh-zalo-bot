#!/usr/bin/env node
// Cập nhật Hermes — dashboard (Bảo trì › Cập nhật Hermes) chạy tách rời, nhật ký ra hermes-update.log:
//   node scripts/hermes-update.js --hermes-bin <lệnh hermes>
// `hermes update --yes --backup`; Hermes mới thì thêm `hermes pm install` rồi khởi động lại trợ lý (xem runHermesUpdate).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRepoEnv } from './setup-env.js';
import { managedHermes, resolveHermesLayout } from './hermes-install-lib.js';
import { runHermesUpdate } from '../dashboard/lib/maintenance.js';
import { makeRestartAssistant } from '../dashboard/lib/restart-assistant.js';
import { loadDashboardConfig } from '../dashboard/lib/config.js';
import { resolveDashboardPaths } from '../dashboard/lib/paths.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };
if (existsSync(join(root, '.env'))) loadRepoEnv(join(root, '.env'));
const env = process.env;
const paths = resolveDashboardPaths({ env, sidecarRoot: root });
const config = loadDashboardConfig(env);
const hermesBin = opt('--hermes-bin') || 'hermes';

// Nhật ký của tiến trình con đi thẳng vào tệp log (stdout của tiến trình này).
const run = (file, argv) => new Promise((ok) => {
  const child = spawn(file, argv, { stdio: 'inherit', windowsHide: true, env: { ...env, HERMES_HOME: paths.hermesHome, NO_COLOR: '1' } });
  child.once('error', (e) => { console.log(`[WARN] ${file} ${argv.join(' ')}: ${e.message}`); ok(null); });
  child.once('exit', (code) => ok(code));
});

const managed = () => {
  let layout = { home: paths.hermesHome, repoRoot: '' };
  try { layout = resolveHermesLayout({ hermesHome: paths.hermesHome }); } catch { /* chỉ dựa vào facts.json */ }
  return managedHermes(layout, paths.hermesHome);
};

const code = await runHermesUpdate({
  hermesBin, run, managed,
  restartAssistant: makeRestartAssistant({ cmd: config.assistantRestartCmd, hermesHome: paths.hermesHome }),
});
process.exitCode = code ?? 1;
