import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { waitSpawned } from './spawn-detached.js';

const execFileP = promisify(execFile);
const defaultExec = (file, args, opts) => execFileP(file, args, opts);

// Khởi động lại trợ lý Hermes. Windows: tuyệt đối không chạy Hermes-Online.vbs (nó bật hộp thoại).
export function makeRestartAssistant({
  cmd, platform = process.platform, hermesHome,
  spawnImpl = spawn, execImpl = defaultExec, existsImpl = existsSync,
}) {
  const opts = { detached: true, windowsHide: true, stdio: 'ignore' };
  return async () => {
    let child;
    if (cmd) child = spawnImpl(cmd, { ...opts, shell: true });
    else if (platform === 'win32') {
      const bundled = join(hermesHome, 'bin', 'hermes.exe');
      const exe = existsImpl(bundled) ? bundled : 'hermes';
      await execImpl(exe, ['gateway', 'stop'], { windowsHide: true, timeout: 30_000 })
        .catch((e) => console.warn('[restart] hermes gateway stop lỗi, vẫn chạy lại:', e.message));
      child = spawnImpl(exe, ['gateway', 'run', '--accept-hooks'], { ...opts, cwd: hermesHome });
    } else child = spawnImpl('systemctl', ['restart', 'hermes-gateway'], opts);
    await waitSpawned(child);
  };
}
