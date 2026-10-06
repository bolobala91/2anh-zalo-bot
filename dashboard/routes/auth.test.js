import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeps, startApp, fakeSidecar } from '../test-helpers.js';

test('thiết lập Quản trị đầu tiên bằng link dùng một lần', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const token = deps.setupToken.issue();
  const res = await call('/api/auth/setup', { method: 'POST', body: { token, username: 'anh', password: 'matkhau-dai', zaloUid: '1234567890123456' } });
  assert.equal(res.status, 200);
  assert.ok(res.cookie);
  assert.equal(deps.users.get('anh').role, 'admin');
  assert.equal((await call('/api/auth/setup', { method: 'POST', body: { token, username: 'x2', password: 'matkhau-dai' } })).status, 403);
});

test('setup-info: gợi ý UID chủ bot khi link còn hiệu lực, không đốt link', async (t) => {
  const deps = makeDeps(t, { config: { port: 3880, publicUrl: 'http://localhost:3880', suggestedZaloUid: '1234567890123456' } });
  const { call } = await startApp(t, deps);
  const token = deps.setupToken.issue();
  assert.equal((await call('/api/auth/setup-info?token=sai')).status, 403);
  assert.equal((await call('/api/auth/setup-info')).status, 403);
  const info = await call(`/api/auth/setup-info?token=${encodeURIComponent(token)}`);
  assert.equal(info.status, 200);
  assert.equal(info.json.suggestedZaloUid, '1234567890123456');
  // Link vẫn dùng được sau khi hỏi gợi ý.
  const res = await call('/api/auth/setup', { method: 'POST', body: { token, username: 'anh', password: 'matkhau-dai', zaloUid: info.json.suggestedZaloUid } });
  assert.equal(res.status, 200);
  // Đã có Quản trị thì không trả gì nữa, kể cả với link mới.
  const later = deps.setupToken.issue();
  assert.equal((await call(`/api/auth/setup-info?token=${encodeURIComponent(later)}`)).status, 403);
});

test('đăng nhập bằng mật khẩu, /api/me, đăng xuất', async (t) => {
  const deps = makeDeps(t);
  deps.users.create({ username: 'anh', role: 'admin', password: 'matkhau-dai' });
  const { call } = await startApp(t, deps);
  const login = await call('/api/auth/verify', { method: 'POST', body: { username: 'anh', password: 'matkhau-dai' } });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(login.headers.get('set-cookie'), /SameSite=Strict/i);
  const me = await call('/api/me', { cookie: login.cookie });
  assert.equal(me.json.user.username, 'anh');
  await call('/api/auth/logout', { method: 'POST', cookie: login.cookie });
  assert.equal((await call('/api/me', { cookie: login.cookie })).status, 401);
});

test('mã qua Zalo: start gửi mã tới UID, verify bằng mã', async (t) => {
  const sidecar = fakeSidecar();
  const deps = makeDeps(t, { sidecar });
  deps.users.create({ username: 'khach', role: 'owner', zaloUid: '1234567890123456' });
  const { call } = await startApp(t, deps);
  const start = await call('/api/auth/start', { method: 'POST', body: { username: 'khach' } });
  assert.equal(start.status, 200);
  const [, sent] = sidecar.calls.find((c) => c[0] === 'code');
  assert.equal(sent.zaloUid, '1234567890123456');
  assert.equal(sent.actor, 'khach'); // control API đòi actor — thiếu là 400 và mã không bao giờ tới
  const ok = await call('/api/auth/verify', { method: 'POST', body: { username: 'khach', code: sent.code } });
  assert.equal(ok.status, 200);
});

test('không đề nghị mã Zalo khi bot mất phiên', async (t) => {
  const sidecar = fakeSidecar({ health: async () => ({ zalo: { status: 'idle', needsRelogin: true }, bridge: { attachedClients: 0 } }) });
  const deps = makeDeps(t, { sidecar });
  deps.users.create({ username: 'anh', role: 'admin', zaloUid: '1234567890123456', password: 'matkhau-dai' });
  const { call } = await startApp(t, deps);
  const start = await call('/api/auth/start', { method: 'POST', body: { username: 'anh' } });
  assert.equal(start.status, 200);
  assert.equal(sidecar.calls.filter((c) => c[0] === 'code').length, 0);
});

test('không tiết lộ tên đăng nhập có tồn tại hay không', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const res = await call('/api/auth/start', { method: 'POST', body: { username: 'khongco' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.methods, ['zalo', 'password']);
});

test('sai 5 lần thì khoá', async (t) => {
  const deps = makeDeps(t);
  deps.users.create({ username: 'anh', role: 'admin', password: 'matkhau-dai' });
  const { call } = await startApp(t, deps);
  for (let i = 0; i < 5; i++) await call('/api/auth/verify', { method: 'POST', body: { username: 'anh', password: 'sai-sai-sai' } });
  const res = await call('/api/auth/verify', { method: 'POST', body: { username: 'anh', password: 'matkhau-dai' } });
  assert.equal(res.status, 429);
});

test('đăng nhập đúng không xoá khoá theo IP', async (t) => {
  const deps = makeDeps(t);
  deps.users.create({ username: 'anh', role: 'admin', password: 'matkhau-dai' });
  deps.users.create({ username: 'khach', role: 'owner', password: 'matkhau-dai' });
  const { call } = await startApp(t, deps);
  // 4 lần sai trên 'khach' => IP có 4 lần sai
  for (let i = 0; i < 4; i++) await call('/api/auth/verify', { method: 'POST', body: { username: 'khach', password: 'sai-sai-sai' } });
  // đăng nhập đúng bằng tài khoản khác không được reset bộ đếm IP
  assert.equal((await call('/api/auth/verify', { method: 'POST', body: { username: 'anh', password: 'matkhau-dai' } })).status, 200);
  // 1 lần sai nữa (tên không tồn tại) => IP chạm 5 lần => bị khoá
  await call('/api/auth/verify', { method: 'POST', body: { username: 'khongco', password: 'sai-sai-sai' } });
  const res = await call('/api/auth/verify', { method: 'POST', body: { username: 'anh', password: 'matkhau-dai' } });
  assert.equal(res.status, 429);
});

test('tài khoản bị khoá thì phiên cũ hết hiệu lực ngay', async (t) => {
  const deps = makeDeps(t);
  deps.users.create({ username: 'khach', role: 'owner', password: 'matkhau-dai' });
  const { call } = await startApp(t, deps);
  const login = await call('/api/auth/verify', { method: 'POST', body: { username: 'khach', password: 'matkhau-dai' } });
  deps.users.update('khach', { disabled: true });
  assert.equal((await call('/api/me', { cookie: login.cookie })).status, 401);
});

test('yêu cầu ghi từ Origin lạ bị chặn', async (t) => {
  const deps = makeDeps(t);
  deps.users.create({ username: 'anh', role: 'admin', password: 'matkhau-dai' });
  const { call } = await startApp(t, deps);
  const res = await call('/api/auth/verify', { method: 'POST', body: { username: 'anh', password: 'matkhau-dai' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('header bảo mật có mặt', async (t) => {
  const { call } = await startApp(t, makeDeps(t));
  const res = await call('/api/me');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('/auth/start trả phản hồi y hệt cho tên có thật và tên không tồn tại', async (t) => {
  const deps = makeDeps(t);
  deps.users.create({ username: 'khach', role: 'owner', zaloUid: '1234567890123456' });
  const { call } = await startApp(t, deps);
  const real = await call('/api/auth/start', { method: 'POST', body: { username: 'khach' } });
  const fake = await call('/api/auth/start', { method: 'POST', body: { username: 'khongco' } });
  assert.equal(real.status, fake.status);
  assert.deepEqual(real.json, fake.json);
});

test('/auth/start vẫn trả cùng phản hồi khi gửi mã Zalo lỗi', async (t) => {
  const deps = makeDeps(t, { sidecar: fakeSidecar({ loginCode: async () => { throw new Error('boom'); } }) });
  deps.users.create({ username: 'khach', role: 'owner', zaloUid: '1234567890123456' });
  const { call } = await startApp(t, deps);
  const real = await call('/api/auth/start', { method: 'POST', body: { username: 'khach' } });
  const fake = await call('/api/auth/start', { method: 'POST', body: { username: 'khongco' } });
  assert.equal(real.status, 200);
  assert.deepEqual(real.json, fake.json);
});

test('/auth/start trong 60 giây chỉ gửi một mã, mã đầu vẫn dùng được', async (t) => {
  const sidecar = fakeSidecar();
  const deps = makeDeps(t, { sidecar });
  deps.users.create({ username: 'khach', role: 'owner', zaloUid: '1234567890123456' });
  const { call } = await startApp(t, deps);
  await call('/api/auth/start', { method: 'POST', body: { username: 'khach' } });
  const again = await call('/api/auth/start', { method: 'POST', body: { username: 'khach' } });
  assert.equal(again.status, 200);
  const sent = sidecar.calls.filter((c) => c[0] === 'code');
  assert.equal(sent.length, 1);
  const ok = await call('/api/auth/verify', { method: 'POST', body: { username: 'khach', code: sent[0][1].code } });
  assert.equal(ok.status, 200);
});

test('thiết lập với mật khẩu yếu trả 400 và không đốt link', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const token = deps.setupToken.issue();
  const weak = await call('/api/auth/setup', { method: 'POST', body: { token, username: 'anh', password: '123' } });
  assert.equal(weak.status, 400);
  const ok = await call('/api/auth/setup', { method: 'POST', body: { token, username: 'anh', password: 'matkhau-dai' } });
  assert.equal(ok.status, 200);
});

test('JSON hỏng trả 400, không phải 500', async (t) => {
  const { base } = await startApp(t, makeDeps(t));
  const res = await fetch(`${base}/api/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'zalo-dashboard' }, body: '{oops' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).ok, false);
});
