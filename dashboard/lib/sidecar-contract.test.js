// Hợp đồng dashboard ↔ bot: client THẬT (sidecar-client.js) gọi router /control THẬT
// (control-api.js) qua HTTP, chỉ phần Zalo/runtime phía sau là giả. Bắt được lỗi kiểu
// "route gọi thiếu actor → control trả 400 → bị nuốt im lặng" mà test với fake không thấy.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createControlRouter } from '../../control-api.js';
import { createSidecarClient } from './sidecar-client.js';
import { makeDeps, startApp, loginAs } from '../test-helpers.js';

const TOKEN = 'hop-dong-token';
const UID = '1234567890123456';

async function startControl(t) {
  const calls = [];
  let qrStatus = 'idle';
  const health = { status: 'healthy', zalo: { status: 'logged-in', userId: '1', displayName: 'Bot', listener: 'connected', needsRelogin: false },
    bridge: { attachedClients: 1, heartbeatAgeMs: 0, staleClients: 0 }, traffic: { lastInboundAtMs: 1, lastOutboundAtMs: 2 }, lastError: null };
  const app = express();
  app.use(express.json());
  app.use('/control', createControlRouter({
    token: TOKEN,
    health: () => health,
    qr: { start: async () => { calls.push(['qr-start']); qrStatus = 'qr-pending'; }, state: () => ({ status: qrStatus, image: qrStatus === 'qr-pending' ? 'data:image/png;base64,AAA' : null, user: null }) },
    logout: async () => { calls.push(['logout']); },
    send: async (m) => { calls.push(['send', m]); return { msgId: '42' }; },
    loginCode: async (m) => { calls.push(['code', m]); },
    groups: async () => [{ groupId: '123', name: 'Lớp 10A' }],
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const client = createSidecarClient({ token: TOKEN, baseUrl: `http://127.0.0.1:${server.address().port}` });
  return { client, calls, health };
}

test('hợp đồng: mọi hàm của client chạy được với router /control thật', async (t) => {
  const { client, calls } = await startControl(t);
  assert.equal((await client.health()).zalo.status, 'logged-in');
  await client.qrStart();
  const qr = await client.qr();
  assert.equal(qr.status, 'qr-pending');
  assert.match(qr.image, /^data:image\/png;base64,/);
  await client.logout();
  assert.deepEqual(await client.send({ threadId: '123', threadType: 1, text: 'Xin chào', actor: 'anh' }), { msgId: '42' });
  await client.loginCode({ zaloUid: UID, code: '123456', actor: 'anh' });
  assert.deepEqual(await client.groups(), [{ groupId: '123', name: 'Lớp 10A' }]);
  assert.deepEqual(calls.map((c) => c[0]), ['qr-start', 'logout', 'send', 'code']);
  assert.deepEqual(calls.find((c) => c[0] === 'code')[1], { zaloUid: UID, code: '123456', actor: 'anh' });
});

test('hợp đồng: thiếu actor thì router thật từ chối (400) — client báo lỗi chứ không im lặng', async (t) => {
  const { client } = await startControl(t);
  await assert.rejects(client.loginCode({ zaloUid: UID, code: '123456' }), (e) => e.statusCode === 400);
  await assert.rejects(client.send({ threadId: '1', threadType: 0, text: 'x' }), (e) => e.statusCode === 400);
});

test('hợp đồng: route dashboard gọi bot đúng dạng tham số (mã đăng nhập, QR, đăng xuất, trạng thái)', async (t) => {
  const { client, calls } = await startControl(t);
  const deps = makeDeps(t, { sidecar: client });
  deps.users.create({ username: 'khach', role: 'owner', zaloUid: UID });
  const { call } = await startApp(t, deps);

  assert.equal((await call('/api/auth/start', { method: 'POST', body: { username: 'khach' } })).status, 200);
  const code = calls.find((c) => c[0] === 'code');
  assert.ok(code, 'mã đăng nhập phải tới được bot');
  assert.equal(code[1].zaloUid, UID);
  assert.equal(code[1].actor, 'khach');
  assert.equal((await call('/api/auth/verify', { method: 'POST', body: { username: 'khach', code: code[1].code } })).status, 200);

  const cookie = await loginAs(t, deps, call);
  const status = await call('/api/status', { cookie });
  assert.equal(status.json.sidecar, 'up');
  assert.equal(status.json.zalo.listener, 'connected');
  assert.equal((await call('/api/zalo/qr/start', { method: 'POST', cookie })).status, 200);
  const qr = await call('/api/zalo/qr', { cookie });
  assert.equal(qr.status, 200);
  assert.equal(qr.json.status, 'qr-pending');
  assert.equal((await call('/api/zalo/logout', { method: 'POST', cookie })).status, 200);
  assert.deepEqual(calls.map((c) => c[0]), ['code', 'qr-start', 'logout']);
});
