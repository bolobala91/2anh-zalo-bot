import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { childEnv, waitSpawned } from './spawn-detached.js';
import { systemctlRestart } from './restart.js';

const execFileP = promisify(execFile);
const defaultExec = (file, args, opts) => execFileP(file, args, opts);

// Khởi động lại trợ lý Hermes. Windows: tuyệt đối không chạy Hermes-Online.vbs (nó bật hộp thoại).
export function makeRestartAssistant({
  cmd, platform = process.platform, hermesHome,
  spawnImpl = spawn, execImpl = defaultExec, existsImpl = existsSync,
  retryDelayMs = 5000, maxRetries = 10,
}) {
  const opts = { detached: true, windowsHide: true, stdio: 'ignore' };
  return async () => {
    const env = { ...childEnv(), HERMES_HOME: hermesHome };
    const profile = String(hermesHome || '').replace(/\\/g, '/').replace(/\/$/, '').match(/\/profiles\/([^/]+)$/)?.[1];
    const profileArgs = profile ? ['--profile', profile] : [];
    // Linux mặc định: chờ systemctl xong và xét mã thoát. Các cách chạy tách rời giữ kiểu "spawn là xong".
    if (!cmd && platform !== 'win32') {
      await systemctlRestart({ service: 'hermes-gateway', envVar: 'ZALO_ASSISTANT_RESTART_CMD', execImpl });
      return;
    }
    let child;
    if (cmd) child = spawnImpl(cmd, { ...opts, shell: true, env });
    else {
      const bundled = join(hermesHome, 'bin', 'hermes.exe');
      const rootBundled = join(dirname(dirname(hermesHome)), 'bin', 'hermes.exe');
      const exe = existsImpl(bundled) ? bundled : profile && existsImpl(rootBundled) ? rootBundled : 'hermes';
      try {
        await execImpl(exe, [...profileArgs, 'gateway', 'stop'], { windowsHide: true, timeout: 30_000, env });
      } catch {
        throw new Error('Chưa dừng được gateway của profile này — không khởi chạy thêm. Kiểm tra trạng thái rồi thử lại.');
      }
      // Hermes mới giữ khoá "mỗi máy một gateway": gateway cũ vừa nhận lệnh stop có thể chưa nhả khoá, gateway mới
      // thoát ngay với mã 75 ("A gateway already owns this host") → đợi một chút rồi chạy lại, có giới hạn số lần.
      const start = (attempt) => {
        const c = spawnImpl(exe, [...profileArgs, 'gateway', 'run', '--accept-hooks'], { ...opts, cwd: hermesHome, env });
        c.on?.('exit', (code) => {
          if (code !== 75 || attempt >= maxRetries) return;
          setTimeout(() => waitSpawned(start(attempt + 1)).catch((e) => console.warn('[restart] chạy lại gateway lỗi:', e.message)), retryDelayMs);
        });
        return c;
      };
      child = start(0);
    }
    await waitSpawned(child);
  };
}
