import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDashboardApp } from './app.js';
import { createUserStore } from './lib/users.js';
import { createSessionStore } from './lib/sessions.js';
import { createLoginGuard } from './lib/login-guard.js';
import { createSetupToken } from './lib/setup-token.js';
import { createActivityLog } from './lib/activity-log.js';
import { createTelegramApi, createTelegramLinker } from './lib/telegram.js';

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

export function fakeBot({ failGetMe = false } = {}) {
  const sent = []; const updates = [];
  const fetchImpl = async (url, opts) => {
    const method = url.split('/').pop();
    const body = opts?.body ? JSON.parse(opts.body) : {};
    const reply = (result) => ({ ok: true, json: async () => ({ ok: true, result }) });
    if (method === 'getMe') {
      if (failGetMe) return { ok: true, json: async () => ({ ok: false, description: 'Unauthorized' }) };
      return reply({ username: 'canhbao_bot' });
    }
    if (method === 'sendMessage') { sent.push(body); return reply({ message_id: 1 }); }
    if (method === 'getUpdates') return reply(updates.filter((x) => x.update_id >= (body.offset || 0)));
    throw new Error(method);
  };
  return { sent, fetchImpl, push: (u) => { updates.push(u); } };
}

export function makeDeps(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bot = overrides.bot || fakeBot();
  return {
    bot,
    linker: createTelegramLinker({ file: join(dir, 'telegram.json'), apiFactory: (token) => createTelegramApi({ token, fetchImpl: bot.fetchImpl }) }),
    config: { port: 3880, publicUrl: 'http://localhost:3880', restartCmd: null },
    users: createUserStore(join(dir, 'users.json')),
    sessions: createSessionStore(join(dir, 'sessions.json')),
    guard: createLoginGuard({}),
    setupToken: createSetupToken(join(dir, 'setup.json')),
    activity: createActivityLog(join(dir, 'activity.jsonl')),
    sidecar: fakeSidecar(),
    restartAssistant: async () => {},
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
