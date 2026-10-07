import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { childEnv, waitSpawned } from './spawn-detached.js';
import { systemctlRestart } from './restart.js';

const execFileP = promisify(execFile);
const defaultExec = (file, args, opts) => execFileP(file, args, opts);

// Khởi động lại trợ lý Hermes. Windows: tuyệt đối không chạy Hermes-Online.vbs (nó bật hộp thoại).
export function makeRestartAssistant({
  cmd, platform = process.platform, hermesHome,
  spawnImpl = spawn, execImpl = defaultExec, existsImpl = existsSync,
}) {
  const opts = { detached: true, windowsHide: true, stdio: 'ignore' };
  return async () => {
    // Linux mặc định: chờ systemctl xong và xét mã thoát. Các cách chạy tách rời giữ kiểu "spawn là xong".
    if (!cmd && platform !== 'win32') {
      await systemctlRestart({ service: 'hermes-gateway', envVar: 'ZALO_ASSISTANT_RESTART_CMD', execImpl });
      return;
    }
    let child;
    if (cmd) child = spawnImpl(cmd, { ...opts, shell: true, env: childEnv() });
    else {
      const bundled = join(hermesHome, 'bin', 'hermes.exe');
      const exe = existsImpl(bundled) ? bundled : 'hermes';
      await execImpl(exe, ['gateway', 'stop'], { windowsHide: true, timeout: 30_000 })
        .catch((e) => console.warn('[restart] hermes gateway stop lỗi, vẫn chạy lại:', e.message));
      child = spawnImpl(exe, ['gateway', 'run', '--accept-hooks'], { ...opts, cwd: hermesHome, env: childEnv() });
    }
    await waitSpawned(child);
  };
}
