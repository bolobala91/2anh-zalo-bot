import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chatMsg, loginAs, makeDeps, seedHistory, startApp } from '../test-helpers.js';

const A = '1234567890123456'; const B = '2234567890123456'; const C = '3234567890123456';

async function ready(t, { env = `OPENAI_API_KEY=sk-bimat\nZALO_ALLOWED_USERS=${A}\n`, ...over } = {}) {
  const deps = makeDeps(t, over);
  writeFileSync(join(deps.dir, 'hermes.env'), env);
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call, { zaloUid: A });
  return { deps, call, admin };
}

test('Chủ bot không xem/sửa được chủ nhân: 403; chưa đăng nhập: 401', async (t) => {
  const { deps, call } = await ready(t);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/owners', { cookie: owner })).status, 403);
  assert.equal((await call('/api/admin/owners', { method: 'PUT', cookie: owner, body: { owners: [B] } })).status, 403);
  assert.equal((await call('/api/admin/owners')).status, 401);
  assert.match(readFileSync(join(deps.dir, 'hermes.env'), 'utf8'), new RegExp(`ZALO_ALLOWED_USERS=${A}\\n`));
});

test('GET: UID kèm tên trong lịch sử và tài khoản dashboard trùng UID; không lộ khoá khác của .env', async (t) => {
  const { deps, call, admin } = await ready(t, { env: `OPENAI_API_KEY=sk-bimat\nZALO_ALLOWED_USERS=${A},${B},0912345678\n` });
  seedHistory(deps, { messages: [chatMsg({ threadId: B, threadType: 0, senderUid: B, senderName: 'Cô Hà' })] });
  const r = await call('/api/admin/owners', { cookie: admin });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.owners, [
    { uid: A, valid: true, name: '', dashboardUsers: ['anh'] },
    { uid: B, valid: true, name: 'Cô Hà', dashboardUsers: [] },
    { uid: '0912345678', valid: false, name: '', dashboardUsers: [] },
  ]);
  assert.equal(r.json.pendingRestart, false);
  assert.equal(r.json.shadowed, false);
  assert.doesNotMatch(JSON.stringify(r.json), /sk-bimat|OPENAI/);
});

test('PUT: ghi .env Hermes đúng một dòng, trả pendingRestart, ghi Nhật ký; lưu y nguyên thì không đánh dấu', async (t) => {
  const { deps, call, admin } = await ready(t);
  const same = await call('/api/admin/owners', { method: 'PUT', cookie: admin, body: { owners: [A] } });
  assert.equal(same.status, 200);
  assert.equal(same.json.pendingRestart, false);
  const r = await call('/api/admin/owners', { method: 'PUT', cookie: admin, body: { owners: [A, B] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.pendingRestart, true);
  assert.deepEqual(r.json.owners.map((o) => o.uid), [A, B]);
  assert.equal(readFileSync(join(deps.dir, 'hermes.env'), 'utf8'), `OPENAI_API_KEY=sk-bimat\nZALO_ALLOWED_USERS=${A},${B}\n`);
  assert.equal(readFileSync(join(deps.dir, 'hermes.env.bak'), 'utf8'), `OPENAI_API_KEY=sk-bimat\nZALO_ALLOWED_USERS=${A}\n`);
  assert.equal((await call('/api/admin/owners', { cookie: admin })).json.pendingRestart, true, 'tải lại trang vẫn thấy banner');
  const log = deps.activity.list().filter((e) => e.action === 'owners_update');
  assert.equal(log.length, 1);
  assert.equal(log[0].actor, 'anh');
});

test('PUT: không cho bỏ chủ nhân cuối cùng, UID sai, sai kiểu — 400, .env không đổi', async (t) => {
  const { deps, call, admin } = await ready(t);
  for (const body of [{ owners: [] }, { owners: ['0912345678'] }, { owners: A }, {}]) {
    const r = await call('/api/admin/owners', { method: 'PUT', cookie: admin, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.json.error, /—/);
  }
  assert.equal(readFileSync(join(deps.dir, 'hermes.env'), 'utf8'), `OPENAI_API_KEY=sk-bimat\nZALO_ALLOWED_USERS=${A}\n`);
  assert.equal(deps.owners.pending(), null);
});

test('.env của thư mục bot cũng đặt UID chủ nhân khác → shadowed để giao diện cảnh báo', async (t) => {
  const { deps, call, admin } = await ready(t);
  writeFileSync(join(deps.dir, 'sidecar.env'), `ZALO_ALLOWED_USERS=${C}\n`);
  assert.equal((await call('/api/admin/owners', { cookie: admin })).json.shadowed, true);
});

test('khởi động lại trợ lý khi đang chờ: khởi động lại kết nối Zalo trước, rồi trợ lý, rồi xoá cờ chờ', async (t) => {
  const order = [];
  const { deps, call, admin } = await ready(t, {
    restartSidecar: async () => { order.push('zalo'); }, restartAssistant: async () => { order.push('assistant'); },
  });
  await call('/api/admin/owners', { method: 'PUT', cookie: admin, body: { owners: [A, B] } });
  const r = await call('/api/admin/restart-assistant', { method: 'POST', cookie: admin, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.appliedOwners, true);
  assert.deepEqual(order, ['zalo', 'assistant']);
  assert.equal(deps.owners.pending(), null);
  // Không còn chờ: chỉ khởi động lại trợ lý như trước.
  const again = await call('/api/admin/restart-assistant', { method: 'POST', cookie: admin, body: {} });
  assert.equal(again.json.appliedOwners, false);
  assert.deepEqual(order, ['zalo', 'assistant', 'assistant']);
});

test('khởi động lại lỗi giữa chừng thì vẫn giữ cờ chờ (banner vàng còn), trả 500 không lộ chi tiết', async (t) => {
  const { deps, call, admin } = await ready(t, {
    restartSidecar: async () => {}, restartAssistant: async () => { throw new Error('spawn ENOENT /bi/mat'); },
  });
  await call('/api/admin/owners', { method: 'PUT', cookie: admin, body: { owners: [B] } });
  const orig = console.error; console.error = () => {};
  let r;
  try { r = await call('/api/admin/restart-assistant', { method: 'POST', cookie: admin, body: {} }); } finally { console.error = orig; }
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.json.error, /ENOENT|bi\/mat/);
  assert.notEqual(deps.owners.pending(), null);
});
