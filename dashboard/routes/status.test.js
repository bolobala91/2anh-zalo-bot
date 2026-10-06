import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatMsg, fakeSidecar, loginAs, makeDeps, seedHistory, startApp } from '../test-helpers.js';

test('trạng thái khi mọi thứ ổn', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  const res = await call('/api/status', { cookie });
  assert.equal(res.json.sidecar, 'up');
  assert.equal(res.json.zalo.status, 'logged-in');
  assert.equal(res.json.assistant, 'connected');
  assert.equal(res.json.zalo.userId, undefined);
});

test('status khi sidecar không trả lời', async (t) => {
  const { SidecarDown } = await import('../lib/sidecar-client.js');
  const deps = makeDeps(t, { sidecar: fakeSidecar({ health: async () => { throw new SidecarDown(); } }) });
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  const res = await call('/api/status', { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.sidecar, 'down');
  assert.equal(res.json.assistant, 'unknown');
});

test('lastError chỉ giữ code, message, atMs', async (t) => {
  const health = async () => ({ zalo: { status: 'logged-in' }, bridge: { attachedClients: 1 },
    lastError: { code: 'E1', message: 'lỗi', atMs: 5, cookie: 'bí mật' } });
  const deps = makeDeps(t, { sidecar: fakeSidecar({ health }) });
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  const res = await call('/api/status', { cookie });
  assert.deepEqual(res.json.lastError, { code: 'E1', message: 'lỗi', atMs: 5 });
});

test('sidecar trả 401 thì trình duyệt nhận 502 tiếng Việt, không lộ unauthorized', async (t) => {
  const deps = makeDeps(t, { sidecar: fakeSidecar({ qr: async () => { throw Object.assign(new Error('unauthorized'), { statusCode: 401 }); } }) });
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  const orig = console.error; console.error = () => {};
  t.after(() => { console.error = orig; });
  const res = await call('/api/zalo/qr', { cookie });
  assert.equal(res.status, 502);
  assert.doesNotMatch(res.json.error, /unauthorized|sidecar|bridge|toolset/i);
});

test('chưa đăng nhập dashboard thì 401', async (t) => {
  const { call } = await startApp(t, makeDeps(t));
  assert.equal((await call('/api/status')).status, 401);
  assert.equal((await call('/api/zalo/qr')).status, 401);
});

test('QR: bắt đầu và đọc ảnh; đăng xuất Zalo ghi nhật ký', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/zalo/qr/start', { method: 'POST', cookie })).status, 200);
  assert.match((await call('/api/zalo/qr', { cookie })).json.image, /^data:image\/png/);
  assert.equal((await call('/api/zalo/logout', { method: 'POST', cookie })).status, 200);
  assert.ok(deps.activity.list({}).some((e) => e.action === 'zalo_logout' && e.actor === 'khach'));
});

test('sidecar tắt thì /api/zalo/qr trả 503 tiếng Việt, không lộ chữ kỹ thuật', async (t) => {
  const { SidecarDown } = await import('../lib/sidecar-client.js');
  const deps = makeDeps(t, { sidecar: fakeSidecar({ qr: async () => { throw new SidecarDown(); } }) });
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  const res = await call('/api/zalo/qr', { cookie });
  assert.equal(res.status, 503);
  assert.doesNotMatch(res.json.error, /sidecar|bridge|toolset/i);
});

test('lỗi 5xx từ sidecar trả thông báo chung, không lộ nội dung gốc', async (t) => {
  const deps = makeDeps(t, { sidecar: fakeSidecar({ qr: async () => { throw Object.assign(new Error('ECONNRESET internal'), { statusCode: 502 }); } }) });
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  const orig = console.error; console.error = () => {};
  t.after(() => { console.error = orig; });
  const res = await call('/api/zalo/qr', { cookie });
  assert.equal(res.status, 502);
  assert.doesNotMatch(res.json.error, /ECONNRESET/);
});

test('tin hôm nay và 5 nhóm sôi nổi nhất đọc từ lịch sử, kể cả khi kết nối Zalo tắt', async (t) => {
  const NOW = Date.UTC(2026, 9, 7, 5, 0);      // 12:00 giờ Việt Nam
  const TODAY = Date.UTC(2026, 9, 6, 17, 0);   // 0:00 giờ Việt Nam
  const { SidecarDown } = await import('../lib/sidecar-client.js');
  let down = false;
  const base = fakeSidecar();
  const sidecar = fakeSidecar({ health: async () => { if (down) throw new SidecarDown(); return base.health(); } });
  const deps = makeDeps(t, { sidecar, now: () => NOW });
  seedHistory(deps, { messages: [
    chatMsg({ threadId: '200', threadType: 1, ts: TODAY - 1 }),               // hôm qua: không tính
    chatMsg({ threadId: '200', threadType: 1, ts: TODAY + 1 }),
    chatMsg({ threadId: '200', threadType: 1, ts: TODAY + 2 }),
    chatMsg({ threadId: '987654', threadType: 1, ts: TODAY + 3 }),
    chatMsg({ threadId: '100', threadType: 0, ts: TODAY + 4, isSelf: true }),
  ] });
  await deps.threadNames.load();
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const expected = { received: 3, sent: 1, topGroups: [
    { threadId: '200', count: 2, name: 'Tổ Hoá' }, { threadId: '987654', count: 1, name: 'Nhóm …7654' },
  ] };
  assert.deepEqual((await call('/api/status', { cookie })).json.today, expected);
  down = true;
  const res = await call('/api/status', { cookie });
  assert.equal(res.json.sidecar, 'down');
  assert.deepEqual(res.json.today, expected);
});

test('chưa có lịch sử thì today = null', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  assert.equal((await call('/api/status', { cookie })).json.today, null);
});
