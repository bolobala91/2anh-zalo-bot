import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSidecar, loginAs, makeDeps, startApp } from '../test-helpers.js';

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
