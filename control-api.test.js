import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createControlRouter } from './control-api.js';

async function serve(t, overrides = {}) {
  const calls = [];
  const deps = {
    token: 'secret-token-123456',
    health: () => ({ status: 'healthy', zalo: { status: 'logged-in', needsRelogin: false } }),
    qr: { start: async () => { calls.push('qr-start'); }, state: () => ({ status: 'qr-pending', image: 'data:image/png;base64,AAA', user: null }) },
    logout: async () => { calls.push('logout'); },
    send: async (m) => { calls.push(['send', m]); return { msgId: '1' }; },
    loginCode: async (m) => { calls.push(['code', m]); },
    groups: async () => [{ id: '123', name: 'Tổ Hoá', members: 12 }],
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  app.use('/control', createControlRouter(deps));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/control`;
  const call = (path, { method = 'GET', body, token = deps.token } = {}) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { call, calls };
}

test('thiếu hoặc sai token thì 401', async (t) => {
  const { call } = await serve(t);
  assert.equal((await call('/health', { token: null })).status, 401);
  assert.equal((await call('/health', { token: 'sai' })).status, 401);
  assert.equal((await call('/health')).status, 200);
});

test('gửi tin tay chuyển đúng người gửi xuống', async (t) => {
  const { call, calls } = await serve(t);
  const res = await call('/send', { method: 'POST', body: { threadId: '9', threadType: 1, text: 'Chào', actor: 'khach' } });
  assert.equal(res.status, 200);
  assert.deepEqual(calls.at(-1), ['send', { threadId: '9', threadType: 1, text: 'Chào', actor: 'khach' }]);
});

test('gửi tin tay từ chối khi thiếu chữ hoặc quá 2000 ký tự', async (t) => {
  const { call } = await serve(t);
  assert.equal((await call('/send', { method: 'POST', body: { threadId: '9', threadType: 1, text: '  ', actor: 'a' } })).status, 400);
  assert.equal((await call('/send', { method: 'POST', body: { threadId: '9', threadType: 1, text: 'x'.repeat(2001), actor: 'a' } })).status, 400);
});

test('mã đăng nhập chỉ nhận đúng 6 chữ số và UID hợp lệ', async (t) => {
  const { call, calls } = await serve(t);
  assert.equal((await call('/login-code', { method: 'POST', body: { zaloUid: '1234567890123456', code: 'abc123' } })).status, 400);
  assert.equal((await call('/login-code', { method: 'POST', body: { zaloUid: '0987', code: '123456' } })).status, 400);
  assert.equal((await call('/login-code', { method: 'POST', body: { zaloUid: '1234567890123456', code: '123456' } })).status, 200);
  assert.deepEqual(calls.at(-1), ['code', { zaloUid: '1234567890123456', code: '123456' }]);
});

test('QR: bắt đầu không chặn, đọc trạng thái', async (t) => {
  const { call, calls } = await serve(t);
  assert.equal((await call('/qr/start', { method: 'POST' })).status, 200);
  assert.ok(calls.includes('qr-start'));
  const state = await (await call('/qr')).json();
  assert.equal(state.status, 'qr-pending');
  assert.match(state.image, /^data:image\/png;base64,/);
});

test('lỗi bên trong trả 502 kèm thông điệp, không làm sập', async (t) => {
  const { call } = await serve(t, { groups: async () => { throw new Error('Zalo chưa đăng nhập'); } });
  const res = await call('/groups');
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /Zalo chưa đăng nhập/);
});
