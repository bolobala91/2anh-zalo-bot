/**
 * Cầu nối tới mã Hermes: chạy `hermes-admin.py` (cùng thư mục) bằng chính Python của Hermes, cwd = thư mục
 * hermes-agent. Tham số JSON qua stdin, nhận một dòng JSON trên stdout. Lệnh ghi (cài/gỡ/bật/tắt) chạy lần lượt
 * để hai thao tác không cùng sửa config.yaml.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELPER = join(dirname(fileURLToPath(import.meta.url)), 'hermes-admin.py');

const venvPython = (root, platform) => (platform === 'win32'
  ? [join(root, 'venv', 'Scripts', 'python.exe'), join(root, '.venv', 'Scripts', 'python.exe')]
  : [join(root, '.venv', 'bin', 'python'), join(root, 'venv', 'bin', 'python')]);

/** Lệnh `hermes` trên PATH → đường thật (symlink) → python cạnh nó trong venv. */
function pythonBesideHermes({ env, platform, exists, real }) {
  for (const dir of String(env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    const bin = join(dir, platform === 'win32' ? 'hermes.exe' : 'hermes');
    if (!exists(bin)) continue;
    try {
      const py = join(dirname(real(bin)), platform === 'win32' ? 'python.exe' : 'python');
      if (exists(py)) return py;
    } catch { /* thử thư mục kế */ }
  }
  return '';
}

/**
 * Tìm Python của Hermes và thư mục hermes-agent: ZALO_HERMES_PYTHON → `<HERMES_HOME>/hermes-agent/(.)venv` (bản cài
 * Windows) → venv chứa lệnh `hermes` trên PATH → /opt/hermes/hermes-agent/.venv. Không thấy → null.
 */
export function locateHermesPython({ hermesHome, env = process.env, platform = process.platform, exists = existsSync, real = realpathSync,
  managed = () => managedEnvPython(hermesHome, platform) }) {
  const rootOf = (py) => dirname(dirname(dirname(py)));
  const ok = (py) => py && exists(py) && exists(join(rootOf(py), 'hermes_cli'));
  const candidates = [
    env.ZALO_HERMES_PYTHON,
    ...venvPython(join(hermesHome, 'hermes-agent'), platform),
    pythonBesideHermes({ env, platform, exists, real }),
    ...(platform === 'win32' ? [] : venvPython('/opt/hermes/hermes-agent', platform)),
  ];
  const python = candidates.find(ok);
  // Hermes mới (bộ quản lý gói `hermes pm`): chạy bằng môi trường riêng ghi trong <HERMES_HOME>/installs/*/facts.json,
  // .venv cũ trong mã Hermes không còn đủ thư viện. Mã Hermes vẫn là thư mục cài → dùng Python mới + root cũ.
  const roots = [python && rootOf(python), join(hermesHome, 'hermes-agent'), platform === 'win32' ? '' : '/opt/hermes/hermes-agent']
    .filter((r) => r && exists(join(r, 'hermes_cli')));
  const env2 = env.ZALO_HERMES_PYTHON ? '' : managed();
  if (env2 && roots.length) return { python: env2, root: roots[0], managed: true };
  return python ? { python, root: rootOf(python) } : null;
}

/** Python của môi trường do Hermes quản lý (facts.json mới nhất còn môi trường tồn tại), hoặc ''. */
export function managedEnvPython(hermesHome, platform = process.platform) {
  const base = join(hermesHome, 'installs');
  let best = { at: -1, py: '' };
  let ids = [];
  try { ids = readdirSync(base); } catch { return ''; }
  for (const id of ids) {
    const facts = join(base, id, 'facts.json');
    try {
      const dir = JSON.parse(readFileSync(facts, 'utf8'))?.packages?.venv?.environment;
      if (!dir) continue;
      const envDir = isAbsolute(dir) ? dir : join(hermesHome, dir);
      const py = platform === 'win32' ? join(envDir, 'Scripts', 'python.exe') : join(envDir, 'bin', 'python');
      const at = statSync(facts).mtimeMs;
      if (existsSync(py) && at > best.at) best = { at, py };
    } catch { /* facts hỏng → bỏ qua */ }
  }
  return best.py;
}

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/**
 * Chạy một lệnh. Trả Promise kết quả, kèm `.closed` (xong khi tiến trình thật sự thoát). Quá giờ: lệnh đọc bị giết;
 * lệnh ghi (`keepAlive`) KHÔNG bị giết giữa chừng (đang xoá/chép thư mục skill) — chỉ báo 504, hàng đợi chờ nó xong.
 */
function runOnce({ python, root, hermesHome, cmd, args, timeoutMs, spawnImpl, keepAlive = false }) {
  let closedResolve;
  const closed = new Promise((r) => { closedResolve = r; });
  const result = new Promise((resolve, reject) => {
    const child = spawnImpl(python, [HELPER, cmd], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HERMES_HOME: hermesHome, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', NO_COLOR: '1',
        // Môi trường Hermes mới không cài mã Hermes vào venv — cho Python thấy thư mục mã.
        PYTHONPATH: [root, process.env.PYTHONPATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':') },
    });
    child.stdout.setEncoding?.('utf8'); child.stderr.setEncoding?.('utf8');
    let out = ''; let err = '';
    const timer = setTimeout(() => { if (!keepAlive) child.kill(); reject(fail(504, keepAlive ? 'Việc vẫn đang chạy trên máy chủ — tải lại trang sau ít phút để xem kết quả.' : 'Hermes trả lời quá lâu — thử lại sau.')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { if (err.length < 20_000) err += d; });
    child.stdin.on?.('error', () => {}); // Python thoát sớm (lỗi import) → EPIPE, không được làm sập dashboard
    child.on('error', (e) => { clearTimeout(timer); closedResolve(); reject(fail(500, `Không chạy được Python của Hermes: ${e.message}`)); });
    child.on('close', () => {
      clearTimeout(timer);
      closedResolve();
      const line = out.trim().split('\n').pop() || '';
      let res;
      try { res = JSON.parse(line); } catch {
        console.error('[dashboard] hermes-admin', cmd, err.slice(-2000));
        return reject(fail(500, 'Hermes không trả kết quả hợp lệ.'));
      }
      if (res.ok) return resolve(res);
      if (!res.user) console.error('[dashboard] hermes-admin', cmd, res.error, err.slice(-2000));
      reject(fail(res.user ? 400 : 500, res.user ? res.error : 'Hermes báo lỗi khi làm việc này — xem nhật ký dashboard.'));
    });
    child.stdin.end(JSON.stringify(args || {}));
  });
  return Object.assign(result, { closed });
}

/** Giữ bản sao config.yaml trước mỗi lệnh ghi (10 bản gần nhất) — Hermes ghi lại cả tệp khi lưu. */
export function backupConfig(configFile, dir, now = Date.now()) {
  if (!configFile || !dir || !existsSync(configFile)) return;
  mkdirSync(dir, { recursive: true });
  copyFileSync(configFile, join(dir, `config-${now}.yaml`));
  const old = readdirSync(dir).filter((f) => /^config-\d+\.yaml$/.test(f)).sort((a, b) => Number(b.slice(7, -5)) - Number(a.slice(7, -5))).slice(10);
  for (const f of old) rmSync(join(dir, f), { force: true });
}

/**
 * Lệnh hai chiều (đăng nhập OAuth): tham số ở dòng đầu stdin, stdin còn mở. `first` = dòng JSON đầu Hermes in
 * (vd. địa chỉ đăng nhập), `send(obj)` gửi một dòng (callback), `done` = dòng cuối.
 */
function runStream({ python, root, hermesHome, cmd, args, timeoutMs, spawnImpl }) {
  const child = spawnImpl(python, [HELPER, cmd], {
    cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HERMES_HOME: hermesHome, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', NO_COLOR: '1' },
  });
  child.stdout.setEncoding?.('utf8'); child.stderr.setEncoding?.('utf8');
  child.stdin.on?.('error', () => {});
  const lines = []; const waiters = [];
  let buf = ''; let err = ''; let closed = false;
  const settle = () => {
    while (waiters.length && (lines.length || closed)) {
      const w = waiters.shift();
      const line = lines.shift();
      if (line === undefined) { w.reject(fail(500, 'Hermes dừng giữa chừng.')); continue; }
      let res;
      try { res = JSON.parse(line); } catch { w.reject(fail(500, 'Hermes không trả kết quả hợp lệ.')); continue; }
      if (res.ok) w.resolve(res); else w.reject(fail(res.user ? 400 : 500, res.user ? res.error : 'Hermes báo lỗi khi đăng nhập — xem nhật ký dashboard.'));
    }
  };
  const next = () => new Promise((resolve, reject) => { waiters.push({ resolve, reject }); settle(); });
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) lines.push(l); }
    settle();
  });
  child.stderr.on('data', (d) => { if (err.length < 20_000) err += d; });
  // Huỷ nhẹ: gửi "cancelled" để Hermes tự hoàn tác token cũ rồi thoát; 30 giây sau mới giết hẳn.
  let sent = false;
  const send = (obj) => { if (closed || sent) return false; sent = true; child.stdin.end(`${JSON.stringify(obj)}\n`); return true; };
  const cancel = () => { send({ error: 'cancelled' }); setTimeout(() => { if (!closed) child.kill(); }, 30_000).unref?.(); };
  const timer = setTimeout(cancel, timeoutMs);
  child.on('error', () => {});
  child.on('close', () => { clearTimeout(timer); if (buf.trim()) lines.push(buf.trim()); closed = true; if (err && !lines.length) console.error('[dashboard] hermes-admin', cmd, err.slice(-2000)); settle(); });
  child.stdin.write(`${JSON.stringify(args || {})}\n`);
  const first = next();
  const done = first.then(() => next());
  done.catch(() => {});
  return {
    first, done,
    send, cancel,
  };
}

export function createHermesAdmin({ hermesHome, env = process.env, locate = locateHermesPython, spawnImpl = spawn, configFile = '', backupDir = '' }) {
  let found;
  let chain = Promise.resolve();
  const where = () => {
    if (found === undefined) found = locate({ hermesHome, env });
    if (!found) throw fail(503, 'Không tìm thấy Python của Hermes trên máy này — đặt ZALO_HERMES_PYTHON trong .env của sidecar.');
    return found;
  };
  return {
    available: () => { try { return Boolean(where()); } catch { return false; } },
    /** Thư mục hermes-agent (rỗng nếu không tìm thấy Python của Hermes). */
    root: () => { try { return where().root; } catch { return ''; } },
    /** Lệnh đọc: chạy ngay. */
    read(cmd, args, { timeoutMs = 60_000 } = {}) {
      return runOnce({ ...where(), hermesHome, cmd, args, timeoutMs, spawnImpl });
    },
    /** Lệnh ghi: xếp hàng, lần lượt từng lệnh. */
    write(cmd, args, { timeoutMs = 180_000 } = {}) {
      let closed = Promise.resolve();
      const job = chain.then(() => {
        const loc = where();
        try { backupConfig(configFile, backupDir); } catch (e) { console.error('[dashboard] không sao lưu được config.yaml:', e.message); }
        const run = runOnce({ ...loc, hermesHome, cmd, args, timeoutMs, spawnImpl, keepAlive: true });
        closed = run.closed;
        return run;
      });
      // Lệnh kế chỉ chạy khi tiến trình này đã thoát hẳn (kể cả khi đã báo 504 cho trình duyệt).
      chain = job.then(() => closed, () => closed);
      return job;
    },
    /** Lệnh hai chiều (đăng nhập OAuth), tối đa 6 phút. */
    stream(cmd, args, { timeoutMs = 360_000 } = {}) {
      const loc = where();
      try { backupConfig(configFile, backupDir); } catch (e) { console.error('[dashboard] không sao lưu được config.yaml:', e.message); }
      return runStream({ ...loc, hermesHome, cmd, args, timeoutMs, spawnImpl });
    },
  };
}
