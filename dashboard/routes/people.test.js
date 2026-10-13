import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

const A = '1111111111111111111';

function seed(deps, data) {
  mkdirSync(join(deps.dir, 'zalo'), { recursive: true });
  writeFileSync(join(deps.dir, 'zalo', 'people.json'), JSON.stringify(data));
}

test('sổ người quen: 401 khi chưa đăng nhập; Chủ bot xem, tìm không dấu, sửa, xoá — mỗi lần ghi vào Nhật ký', async (t) => {
  const deps = makeDeps(t);
  seed(deps, { [A]: { name: 'Cô Lan', note: 'Tổ Hoá', updated_at: 1 } });
  const { call } = await startApp(t, deps);
  assert.equal((await call('/api/people')).status, 401);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/people?q=hoa', { cookie: owner })).json.people[0].uid, A);
  assert.equal((await call('/api/people?q=minh', { cookie: owner })).json.people.length, 0);
  const put = await call(`/api/people/${A}`, { method: 'PUT', cookie: owner, body: { name: 'Cô Lan', note: '', fields: [{ key: 'môn', value: 'Hoá' }] } });
  assert.equal(put.status, 200);
  assert.equal(JSON.parse(readFileSync(join(deps.dir, 'zalo', 'people.json'), 'utf8'))[A].updated_by, 'dashboard:khach');
  assert.equal((await call(`/api/people/${A}`, { method: 'PUT', cookie: owner, body: { name: '', note: '' } })).status, 400);
  assert.equal((await call('/api/people/abc', { method: 'PUT', cookie: owner, body: { name: 'x' } })).status, 400);
  assert.equal((await call(`/api/people/${A}`, { method: 'DELETE', cookie: owner })).status, 200);
  assert.equal((await call(`/api/people/${A}`, { method: 'DELETE', cookie: owner })).status, 404);
  assert.deepEqual(deps.activity.list().map((e) => e.action).filter((a) => a.startsWith('people')), ['people_delete', 'people_update']);
});

test('sổ người quen hỏng: đọc báo 503 có bước tiếp theo, không lộ đường dẫn tệp', async (t) => {
  const deps = makeDeps(t);
  seed(deps, {});
  writeFileSync(join(deps.dir, 'zalo', 'people.json'), '{hỏng');
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const r = await call('/api/people', { cookie: admin });
  assert.equal(r.status, 503);
  assert.match(r.json.error, /báo người cài đặt/);
  assert.doesNotMatch(r.json.error, /[\\/]zalo[\\/]/);
});

test('sổ người quen: gửi updatedAt cũ (bot vừa sửa) → 409 cho cả PUT lẫn DELETE, không ghi; đúng mốc thì ghi được', async (t) => {
  const deps = makeDeps(t);
  seed(deps, { [A]: { name: 'Cô Lan', note: 'Tổ Hoá', updated_at: 100 } });
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const file = join(deps.dir, 'zalo', 'people.json');
  const stale = await call(`/api/people/${A}`, { method: 'PUT', cookie: owner, body: { name: 'Mới', note: 'x', updatedAt: 50_000 } });
  assert.equal(stale.status, 409);
  assert.match(stale.json.error, /vừa được bot cập nhật/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8'))[A].name, 'Cô Lan');
  assert.equal((await call(`/api/people/${A}`, { method: 'DELETE', cookie: owner, body: { updatedAt: 50_000 } })).status, 409);
  assert.ok(JSON.parse(readFileSync(file, 'utf8'))[A], 'không xoá');
  assert.equal((await call(`/api/people/${A}`, { method: 'PUT', cookie: owner, body: { name: 'Cô Lan 2', note: '', updatedAt: 100_000 } })).status, 200);
  const seen = (await call('/api/people', { cookie: owner })).json.people[0].updatedAt;
  assert.equal((await call(`/api/people/${A}`, { method: 'DELETE', cookie: owner, body: { updatedAt: seen } })).status, 200);
  // Người mới (chưa có hồ sơ): mốc null khớp; mốc khác null nghĩa là hồ sơ đã bị xoá/đổi → 409.
  const B = '2222222222222222222';
  assert.equal((await call(`/api/people/${B}`, { method: 'PUT', cookie: owner, body: { name: 'Minh', updatedAt: 7 } })).status, 409);
  assert.equal((await call(`/api/people/${B}`, { method: 'PUT', cookie: owner, body: { name: 'Minh', updatedAt: null } })).status, 200);
});

test('sổ người quen: nơi dùng từng mục thành chữ dễ hiểu (tên nhóm, nhắn riêng)', async (t) => {
  const deps = makeDeps(t);
  const B = '2222222222222222222';
  seed(deps, { [A]: { name: 'Cô Lan', fields: { lop: '12A1', mon: 'Hoá' }, note: 'Tổ Hoá', updated_at: 1,
    scopes: { fields: { lop: ['g:555', `u:${A}`] }, note: [`u:${B}`] } }, [B]: { name: 'Chủ', updated_at: 2 } });
  deps.threadNames = { load: async () => new Map([['555', 'Nhóm 12A1']]), cached: () => new Map() };
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const lan = (await call('/api/people', { cookie: admin })).json.people.find((p) => p.uid === A);
  assert.deepEqual(lan.fields.map((f) => [f.key, f.places]), [['lop', ['Nhóm 12A1', 'Nhắn riêng']], ['mon', []]]);
  assert.deepEqual(lan.notePlaces, ['Nhắn riêng của Chủ']);
});

test('sổ người quen: xoá nhiều người một lần — kiểm hết trước, một dòng Nhật ký', async (t) => {
  const B = '2222222222222222222';
  const deps = makeDeps(t);
  seed(deps, { [A]: { name: 'Cô Lan', updated_at: 1 }, [B]: { name: 'Thầy Minh', updated_at: 2 } });
  const { call } = await startApp(t, deps);
  assert.equal((await call('/api/people/bulk-delete', { method: 'POST', body: { people: [{ uid: A }] } })).status, 401);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/people/bulk-delete', { method: 'POST', cookie: owner, body: { people: [{ uid: A, updatedAt: 1000 }, { uid: B, updatedAt: 5 }] } })).status, 409);
  assert.equal((await call('/api/people/bulk-delete', { method: 'POST', cookie: owner, body: { people: 'x' } })).status, 400);
  assert.equal((await call('/api/people', { cookie: owner })).json.total, 2);
  const r = await call('/api/people/bulk-delete', { method: 'POST', cookie: owner, body: { people: [{ uid: A, updatedAt: 1000 }, { uid: B, updatedAt: 2000 }] } });
  assert.deepEqual([r.status, r.json.count], [200, 2]);
  assert.equal((await call('/api/people', { cookie: owner })).json.total, 0);
  assert.deepEqual(deps.activity.list().filter((e) => e.action === 'people_delete').map((e) => e.detail), ['2 người']);
});
