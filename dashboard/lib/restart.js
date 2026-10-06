import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { waitSpawned } from './spawn-detached.js';

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

// Giải phóng cổng: chỉ kill đúng PID đang LISTEN trên cổng đó (không kill theo tên, không kill chính mình).
export async function freeListenerPort({
  port, execImpl = defaultExec, ownPid = process.pid,
  sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const listenerPid = async () => {
    const { stdout } = await execImpl('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true });
    return findListenerPid(stdout, port);
  };
  const pid = await listenerPid();
  if (!pid || pid === ownPid) return;
  await execImpl('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true });
  for (let i = 0; i < 12; i++) { // chờ tối đa ~3 giây cho cổng được nhả
    await sleepImpl(250);
    if (!(await listenerPid())) return;
  }
}

export function makeRestartSidecar({
  cmd, platform = process.platform, sidecarRoot, port = 3872,
  spawnImpl = spawn, execImpl = defaultExec, ownPid = process.pid,
  sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const opts = { detached: true, windowsHide: true, stdio: 'ignore' };
  const freePort = () => freeListenerPort({ port, execImpl, ownPid, sleepImpl });

  return async () => {
    let child;
    if (cmd) child = spawnImpl(cmd, { ...opts, shell: true });
    else if (platform === 'win32') {
      await freePort().catch((e) => console.warn('[restart] không giải phóng được cổng:', e.message));
      child = spawnImpl(process.execPath, ['server.js'], { ...opts, cwd: sidecarRoot });
    } else child = spawnImpl('systemctl', ['restart', 'zalo-bridge'], opts);
    await waitSpawned(child);
  };
}
