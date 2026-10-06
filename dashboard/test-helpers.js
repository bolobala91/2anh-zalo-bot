import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDashboardApp } from './app.js';
import { createUserStore } from './lib/users.js';
import { createSessionStore } from './lib/sessions.js';
import { createLoginGuard } from './lib/login-guard.js';
import { createSetupToken } from './lib/setup-token.js';
import { createActivityLog } from './lib/activity-log.js';

export function fakeSidecar(overrides = {}) {
  const calls = [];
  return {
    calls,
    health: async () => ({ status: 'healthy', zalo: { status: 'logged-in', listener: 'connected', needsRelogin: false, displayName: 'Uyển Nhi' },
      bridge: { attachedClients: 1 }, traffic: { lastInboundAtMs: 1, lastOutboundAtMs: 2 }, lastError: null }),
    loginCode: async (m) => { calls.push(['code', m]); },
    qrStart: async () => { calls.push('qr-start'); },
    qr: async () => ({ status: 'qr-pending', image: 'data:image/png;base64,AAA', user: null }),
    logout: async () => { calls.push('logout'); },
    ...overrides,
  };
}

export function makeDeps(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return {
    config: { port: 3880, publicUrl: 'http://localhost:3880', restartCmd: null },
    users: createUserStore(join(dir, 'users.json')),
    sessions: createSessionStore(join(dir, 'sessions.json')),
    guard: createLoginGuard({}),
    setupToken: createSetupToken(join(dir, 'setup.json')),
    activity: createActivityLog(join(dir, 'activity.jsonl')),
    sidecar: fakeSidecar(),
    publicDir: join(dir, 'public'),
    dir,
    ...overrides,
  };
}

export async function startApp(t, deps) {
  const app = createDashboardApp(deps);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'zalo-dashboard', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    let json = null;
    try { json = await res.json(); } catch { /* không phải JSON */ }
    return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : null, headers: res.headers };
  }
  return { base, call };
}

export async function loginAs(t, deps, call, { username = 'anh', role = 'admin', password = 'matkhau-dai', zaloUid = '1234567890123456' } = {}) {
  if (!deps.users.get(username)) deps.users.create({ username, role, password, zaloUid });
  const res = await call('/api/auth/verify', { method: 'POST', body: { username, password } });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.json)}`);
  return res.cookie;
}
