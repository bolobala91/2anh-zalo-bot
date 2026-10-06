import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const defaultExec = (file, args, opts) => execFileP(file, args, opts);

// Tìm PID đang LISTEN đúng cổng từ đầu ra `netstat -ano -p tcp`.
function findListenerPid(stdout, port) {
  for (const line of String(stdout).split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || !/^TCP$/i.test(cols[0])) continue;
    const [, local, , state, pid] = cols;
    if (state !== 'LISTENING' || !local.endsWith(`:${port}`)) continue;
    const n = Number(pid);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

export function makeRestartSidecar({
  cmd, platform = process.platform, sidecarRoot, port = 3872,
  spawnImpl = spawn, execImpl = defaultExec, ownPid = process.pid,
}) {
  const opts = { detached: true, windowsHide: true, stdio: 'ignore' };

  async function freePort() {
    const { stdout } = await execImpl('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true });
    const pid = findListenerPid(stdout, port);
    if (pid && pid !== ownPid) await execImpl('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true });
  }

  return async () => {
    let child;
    if (cmd) child = spawnImpl(cmd, { ...opts, shell: true });
    else if (platform === 'win32') {
      await freePort().catch((e) => console.warn('[restart] không giải phóng được cổng:', e.message));
      child = spawnImpl(process.execPath, ['server.js'], { ...opts, cwd: sidecarRoot });
    } else child = spawnImpl('systemctl', ['restart', 'zalo-bridge'], opts);
    child.unref?.();
  };
}
