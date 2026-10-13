import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLearnedMemory } from '../lib/learned-memory.js';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

const G = 'zalo-g-2054797107487294899';
const O = 'zalo-u-1234567890123456789';            // kho DM của chủ nhân bot
const FILE = `viking://user/${G}/memories/preferences/mem_1.md`;
const OWNER_FILE = `viking://user/${O}/memories/preferences/mem_2.md`;

/** Thư viện thật + OpenViking giả (fetch giả) — kiểm chặn theo vai trò ở phía máy chủ, không chỉ ẩn ở giao diện. */
function realLearned(t) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-lmr-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const reply = {
    'GET /api/v1/fs/ls': (u) => (u.searchParams.get('uri') === 'viking://user'
      ? [{ uri: `viking://user/${G}`, isDir: true }, { uri: `viking://user/${O}`, isDir: true }]
      : [{ uri: `viking://user/${G}/sessions/s1`, isDir: true }]),
    'GET /api/v1/content/read': 'Nhóm gọi bot là Nhi',
    'GET /api/v1/sessions/s1': { pending_tokens: 10 },
  };
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    calls.push({ method: opts.method, path: u.pathname, uri: u.searchParams.get('uri'), user: opts.headers['X-OpenViking-User'] });
    const r = reply[`${opts.method} ${u.pathname}`];
    return { ok: true, json: async () => ({ status: 'ok', result: typeof r === 'function' ? r(u) : r ?? null }) };
  };
  const settingsFile = join(dir, 'zalo', 'memory.json');
  const learnedMemory = createLearnedMemory({ settings: () => ({ provider: 'zalo_memory', endpoint: '' }), platform: 'linux', fetchImpl,
    settingsFile, owners: () => ['1234567890123456789'], names: () => '' });
  return { learnedMemory, calls, settingsFile };
}

test('Kho tri thức tự học: Quản trị và Chủ bot cùng xem/sửa/xoá; kho DM của chủ nhân chỉ Quản trị — chặn ở máy chủ', async (t) => {
  const { learnedMemory, calls } = realLearned(t);
  const deps = makeDeps(t, { learnedMemory });
  const { call } = await startApp(t, deps);
  assert.equal((await call('/api/learned-memory/scopes')).status, 401);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const admin = await loginAs(t, deps, call);
  assert.deepEqual((await call('/api/learned-memory/scopes', { cookie: owner })).json.scopes.map((s) => s.scope), [G]);
  assert.deepEqual((await call('/api/learned-memory/scopes', { cookie: admin })).json.scopes.map((s) => s.scope), [G, O]);
  assert.equal((await call(`/api/learned-memory/${G}/read?uri=${encodeURIComponent(FILE)}`, { cookie: owner })).json.text, 'Nhóm gọi bot là Nhi');
  assert.equal((await call(`/api/learned-memory/${G}/item`, { method: 'PUT', cookie: owner, body: { uri: FILE, text: 'Nhóm gọi bot là Uyển Nhi' } })).status, 200);
  assert.equal((await call(`/api/learned-memory/${G}/item`, { method: 'DELETE', cookie: owner, body: { uri: FILE } })).status, 200);
  const before = calls.length;
  for (const [p, method, body] of [[`/api/learned-memory/${O}/read?uri=${encodeURIComponent(OWNER_FILE)}`, 'GET'],
    [`/api/learned-memory/${O}/list`, 'GET'], [`/api/learned-memory/${O}/search?q=cà phê`, 'GET'],
    [`/api/learned-memory/${O}/item`, 'PUT', { uri: OWNER_FILE, text: 'x' }], [`/api/learned-memory/${O}/item`, 'DELETE', { uri: OWNER_FILE }],
    [`/api/learned-memory/${O}`, 'DELETE']]) {
    assert.equal((await call(p, { method, cookie: owner, body })).status, 404, `${method} ${p}`);
  }
  assert.equal(calls.length, before, 'Chủ bot không chạm được kho DM của chủ nhân, kể cả gọi thẳng API');
  assert.equal((await call(`/api/learned-memory/${O}/read?uri=${encodeURIComponent(OWNER_FILE)}`, { cookie: admin })).status, 200);
  assert.equal((await call(`/api/learned-memory/${G}`, { method: 'DELETE', cookie: owner })).status, 200);
  const log = deps.activity.list().filter((e) => e.action.startsWith('learned_memory_'));
  assert.deepEqual(log.map((e) => e.action).sort(), ['learned_memory_delete', 'learned_memory_edit', 'learned_memory_forget']);
  assert.equal(JSON.stringify(log).includes('Uyển Nhi'), false, 'Nhật ký không chép nội dung trí nhớ');
});

test('chu kỳ rút và "Rút trí nhớ ngay": chỉ Quản trị; ghi memory.json; Nhật ký có dòng', async (t) => {
  const { learnedMemory, calls, settingsFile } = realLearned(t);
  const deps = makeDeps(t, { learnedMemory });
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const admin = await loginAs(t, deps, call);
  const st = await call('/api/learned-memory/status', { cookie: owner });
  assert.deepEqual([st.json.settings.extractMinutes, st.json.canAdmin], [120, false]);
  assert.equal((await call('/api/learned-memory/settings', { method: 'PUT', cookie: owner, body: { extractMinutes: 60 } })).status, 403);
  assert.equal((await call(`/api/learned-memory/${G}/extract`, { method: 'POST', cookie: owner })).status, 403);
  assert.equal((await call('/api/learned-memory/settings', { method: 'PUT', cookie: admin, body: { extractMinutes: 10 } })).status, 400);
  const saved = await call('/api/learned-memory/settings', { method: 'PUT', cookie: admin, body: { extractMinutes: 60 } });
  assert.equal(saved.json.settings.extractMinutes, 60);
  assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')), { version: 1, extractMinutes: 60 });
  const now = await call(`/api/learned-memory/${G}/extract`, { method: 'POST', cookie: admin });
  assert.deepEqual([now.status, now.json.committed], [200, 1]);
  assert.ok(calls.some((c) => c.method === 'POST' && c.path === '/api/v1/sessions/s1/commit' && c.user === G));
  assert.deepEqual(deps.activity.list().filter((e) => e.action.startsWith('learned_memory_')).map((e) => e.action).sort(),
    ['learned_memory_extract', 'learned_memory_settings']);
});

test('Kho tri thức tự học: xoá nhiều mục một lần — một dòng Nhật ký; kho DM chủ nhân vẫn chặn Chủ bot', async (t) => {
  const { learnedMemory, calls } = realLearned(t);
  const deps = makeDeps(t, { learnedMemory });
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const second = `viking://user/${G}/memories/events/mem_3.md`;
  assert.equal((await call(`/api/learned-memory/${O}/bulk-delete`, { method: 'POST', cookie: owner, body: { uris: [OWNER_FILE] } })).status, 404);
  assert.equal((await call(`/api/learned-memory/${G}/bulk-delete`, { method: 'POST', cookie: owner, body: { uris: [FILE, OWNER_FILE] } })).status, 400);
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0);
  const r = await call(`/api/learned-memory/${G}/bulk-delete`, { method: 'POST', cookie: owner, body: { uris: [FILE, second] } });
  assert.deepEqual([r.status, r.json.done, r.json.failed], [200, [FILE, second], []]);
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 2);
  assert.deepEqual(deps.activity.list().filter((e) => e.action === 'learned_memory_delete').map((e) => e.detail), [`${G}: 2 mục`]);
});
