import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMcpServers } from '../lib/mcp-servers.js';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

test('Kết nối MCP: chỉ Quản trị; tắt ghi config + cờ chờ + Nhật ký; không có route thêm máy chủ', async (t) => {
  const deps = makeDeps(t);
  writeFileSync(join(deps.dir, 'config.yaml'), 'mcp_servers:\n  rag:\n    url: http://127.0.0.1:9998/mcp\n');
  deps.mcpServers = createMcpServers({ configFile: join(deps.dir, 'config.yaml'), probe: async () => false });
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/mcp', { cookie: owner })).status, 403);
  assert.equal((await call('/api/admin/mcp/rag', { method: 'PUT', cookie: owner, body: { enabled: false } })).status, 403);
  const admin = await loginAs(t, deps, call);
  assert.equal((await call('/api/admin/mcp', { cookie: admin })).json.servers[0].status, 'Không phản hồi');
  const off = await call('/api/admin/mcp/rag', { method: 'PUT', cookie: admin, body: { enabled: false } });
  assert.equal(off.json.servers[0].status, 'Đã tắt');
  assert.deepEqual(deps.restartFlags.get().assistant.reasons, ['Kết nối MCP: rag']);
  assert.equal(deps.activity.list().find((e) => e.action === 'mcp_disable').detail, 'rag');
  assert.equal((await call('/api/admin/mcp/rag', { method: 'PUT', cookie: admin, body: { enabled: 'x' } })).status, 400);
  assert.equal((await call('/api/admin/mcp/khac', { method: 'PUT', cookie: admin, body: { enabled: true } })).status, 404);
  assert.equal((await call('/api/admin/mcp', { method: 'POST', cookie: admin, body: { name: 'x', command: 'rm' } })).status, 404);
});

function fakeAdmin() {
  const calls = [];
  let sent = null;
  const answers = {
    'mcp.catalog': { entries: [{ name: 'notion', auth: 'oauth', env: [] }] },
    'mcp.install': (a) => ({ name: a.name, auth: 'oauth' }),
    'mcp.add': (a) => ({ name: a.name, auth: a.auth }),
    'mcp.test': (a) => ({ name: a.name, connected: true, tools: [{ name: 'q', enabled: true }] }),
    'mcp.tools': (a) => ({ name: a.name, disabled: a.disabled }),
    'mcp.remove': (a) => ({ name: a.name }),
    'mcp.edit': (a) => ({ name: a.name, changed: a.keys ? ['khoá'] : [], relogin: false }),
  };
  const run = (kind) => async (cmd, args) => { calls.push({ kind, cmd, args }); const a = answers[cmd]; return { ok: true, ...(typeof a === 'function' ? a(args) : a) }; };
  return {
    calls, sent: () => sent, read: run('read'), write: run('write'),
    stream(cmd, args) {
      calls.push({ kind: 'stream', cmd, args });
      let finish;
      const done = new Promise((res) => { finish = res; });
      return { first: Promise.resolve({ ok: true, url: 'https://notion.example/authorize?state=S123', state: 'S123' }), done,
        send(obj) { sent = obj; finish({ ok: true, tools: 7 }); return true; }, cancel() {} };
    },
  };
}

test('Kết nối MCP: thêm từ danh mục / theo địa chỉ, kiểm tra, chọn công cụ, gỡ — chỉ Quản trị, đánh dấu khởi động lại', async (t) => {
  const deps = makeDeps(t);
  writeFileSync(join(deps.dir, 'config.yaml'), 'mcp_servers:\n  rag:\n    url: http://127.0.0.1:9998/mcp\n');
  deps.mcpServers = createMcpServers({ configFile: join(deps.dir, 'config.yaml'), probe: async () => true });
  deps.hermesAdmin = fakeAdmin();
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  for (const [path, method] of [['/api/admin/mcp-catalog', 'GET'], ['/api/admin/mcp-catalog/install', 'POST'], ['/api/admin/mcp-add', 'POST'], ['/api/admin/mcp/rag/test', 'POST'], ['/api/admin/mcp/rag/oauth', 'POST']]) {
    assert.equal((await call(path, { method, cookie: owner, body: method === 'POST' ? {} : undefined })).status, 403, path);
  }
  const admin = await loginAs(t, deps, call);
  assert.equal((await call('/api/admin/mcp', { cookie: admin })).json.manage, true);
  assert.equal((await call('/api/admin/mcp-catalog', { cookie: admin })).json.entries[0].name, 'notion');
  await call('/api/admin/mcp-catalog/install', { method: 'POST', cookie: admin, body: { name: 'notion', env: { X: '1' } } });
  await call('/api/admin/mcp-add', { method: 'POST', cookie: admin, body: { name: 'tl', url: 'https://x/mcp', auth: 'bearer', token: 'secret-token' } });
  assert.equal((await call('/api/admin/mcp/rag/test', { method: 'POST', cookie: admin })).json.tools.length, 1);
  await call('/api/admin/mcp/rag/tools', { method: 'PUT', cookie: admin, body: { disabled: ['q'] } });
  await call('/api/admin/mcp/rag/remove', { method: 'POST', cookie: admin });
  assert.deepEqual(deps.hermesAdmin.calls.filter((c) => c.kind === 'write').map((c) => c.cmd), ['mcp.install', 'mcp.add', 'mcp.tools', 'mcp.remove']);
  assert.deepEqual(deps.restartFlags.get().assistant.reasons, ['Kết nối MCP: notion', 'Kết nối MCP: tl', 'Kết nối MCP: rag: tắt 1 công cụ', 'Kết nối MCP: rag']);
  assert.ok(!JSON.stringify(deps.activity.list()).includes('secret-token'), 'Nhật ký không ghi khoá');
});

test('Kết nối MCP: đăng nhập OAuth — trang quay về chỉ nhận đúng state đang chờ, không cần phiên', async (t) => {
  const deps = makeDeps(t);
  writeFileSync(join(deps.dir, 'config.yaml'), 'mcp_servers:\n  notion:\n    url: https://mcp.notion.com/mcp\n    auth: oauth\n');
  deps.mcpServers = createMcpServers({ configFile: join(deps.dir, 'config.yaml') });
  deps.hermesAdmin = fakeAdmin();
  deps.config = { ...deps.config, publicUrl: 'https://bot.example.vn' };
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const start = await call('/api/admin/mcp/notion/oauth', { method: 'POST', cookie: admin });
  assert.equal(start.json.url, 'https://notion.example/authorize?state=S123');
  assert.equal(deps.hermesAdmin.calls.find((c) => c.kind === 'stream').args.redirect_uri, 'https://bot.example.vn/api/mcp-oauth/callback');
  assert.equal((await call(`/api/admin/mcp/oauth/${start.json.flowId}`, { cookie: admin })).json.status, 'pending');

  assert.equal((await call('/api/mcp-oauth/callback?state=SAI&code=c')).status, 404, 'state lạ bị từ chối');
  assert.equal(deps.hermesAdmin.sent(), null);
  const ok = await call('/api/mcp-oauth/callback?state=S123&code=abc');
  assert.equal(ok.status, 200);
  assert.deepEqual(deps.hermesAdmin.sent(), { code: 'abc', state: 'S123', error: undefined });
  assert.equal((await call('/api/mcp-oauth/callback?state=S123&code=again')).status, 404, 'chỉ nhận một lần');
  await new Promise((r) => setImmediate(r));
  const fin = await call(`/api/admin/mcp/oauth/${start.json.flowId}`, { cookie: admin });
  assert.deepEqual([fin.json.status, fin.json.tools], ['done', 7]);
  assert.deepEqual(deps.restartFlags.get().assistant.reasons, ['Kết nối MCP: notion']);
});

test('Kết nối MCP: Ai được dùng ghi ZALO_PUBLIC_MCP (không cần khởi động lại); Sửa chỉ chuyển trường được phép, không lộ khoá', async (t) => {
  const deps = makeDeps(t);
  writeFileSync(join(deps.dir, 'config.yaml'), 'mcp_servers:\n  rag:\n    url: http://127.0.0.1:9998/mcp\n');
  let env = '';
  deps.mcpServers = createMcpServers({ configFile: join(deps.dir, 'config.yaml'), probe: async () => true, publicMcp: () => env, writePublicMcp: (v) => { env = v; } });
  deps.hermesAdmin = fakeAdmin();
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/mcp/rag/members', { method: 'PUT', cookie: owner, body: { open: true } })).status, 403);
  assert.equal((await call('/api/admin/mcp/rag/edit', { method: 'PUT', cookie: owner, body: { timeout: 30 } })).status, 403);
  const admin = await loginAs(t, deps, call);
  const open = await call('/api/admin/mcp/rag/members', { method: 'PUT', cookie: admin, body: { open: true } });
  assert.equal(open.json.servers[0].publicToMembers, true);
  assert.equal(env, 'rag');
  assert.ok(!deps.restartFlags.get().assistant, 'ZALO_PUBLIC_MCP có hiệu lực ngay');
  assert.ok(deps.activity.list().some((e) => e.action === 'mcp_members_open'));
  const ed = await call('/api/admin/mcp/rag/edit', { method: 'PUT', cookie: admin, body: { keys: { MCP_RAG_API_KEY: 'bi-mat-123456' }, timeout: 60, evil: 'x', name: 'khac' } });
  assert.equal(ed.status, 200);
  const sent = deps.hermesAdmin.calls.find((c) => c.cmd === 'mcp.edit').args;
  assert.deepEqual(Object.keys(sent).sort(), ['keys', 'name', 'timeout']);
  assert.equal(sent.name, 'rag', 'tên lấy từ đường dẫn, không từ thân yêu cầu');
  assert.ok(!JSON.stringify(ed.json).includes('bi-mat'), 'không trả khoá');
  assert.ok(!JSON.stringify(deps.activity.list()).includes('bi-mat'), 'Nhật ký không ghi khoá');
  assert.deepEqual(deps.restartFlags.get().assistant.reasons, ['Kết nối MCP: rag: khoá']);
});

test('Kết nối MCP: Việt hoá công cụ — chỉ Quản trị, kiểm danh sách, dịch lỗi thì trả rỗng', async (t) => {
  const deps = makeDeps(t);
  writeFileSync(join(deps.dir, 'config.yaml'), 'mcp_servers:\n  rag:\n    url: http://127.0.0.1:9998/mcp\n');
  deps.mcpServers = createMcpServers({ configFile: join(deps.dir, 'config.yaml'), probe: async () => true });
  deps.hermesAdmin = fakeAdmin();
  let fail = false;
  deps.mcpToolVi = { describe: async (tools) => { if (fail) throw new Error('x'); return { [tools[0].name]: { label: 'Tìm tài liệu', desc: 'Tìm trong kho.' } }; } };
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/mcp-tools-vi', { method: 'POST', cookie: owner, body: { tools: [] } })).status, 403);
  const admin = await loginAs(t, deps, call);
  assert.equal((await call('/api/admin/mcp-tools-vi', { method: 'POST', cookie: admin, body: { tools: 'x' } })).status, 400);
  const ok = await call('/api/admin/mcp-tools-vi', { method: 'POST', cookie: admin, body: { tools: [{ name: 'search', description: 'Search docs' }] } });
  assert.deepEqual(ok.json.vi, { search: { label: 'Tìm tài liệu', desc: 'Tìm trong kho.' } });
  fail = true;
  assert.deepEqual((await call('/api/admin/mcp-tools-vi', { method: 'POST', cookie: admin, body: { tools: [{ name: 'a', description: '' }] } })).json.vi, {});
});
