import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURE_KEYS } from '../lib/permissions.js';
import { fakeSidecar, loginAs, makeDeps, startApp } from '../test-helpers.js';

const G = '2054797107487294899';
const allOn = () => Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));
const body = (over = {}, features = {}) => ({ active: true, replyOnlyTagged: true, ...over, features: { ...allOn(), ...features } });

async function ready(t, overrides = {}) {
  const deps = makeDeps(t, overrides);
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const disk = () => JSON.parse(readFileSync(join(deps.dir, 'zalo', 'permissions.json'), 'utf8'));
  return { deps, call, admin, owner, disk };
}

test('chưa đăng nhập → 401 ở mọi route phân quyền', async (t) => {
  const { call } = await ready(t);
  for (const [path, method] of [['/api/permissions', 'GET'], ['/api/groups', 'GET'],
    ['/api/permissions/defaults', 'PUT'], [`/api/permissions/groups/${G}`, 'PUT']]) {
    assert.equal((await call(path, { method, body: method === 'PUT' ? body() : undefined })).status, 401, path);
  }
});

test('Chủ bot xem và sửa được phân quyền (spec §6), có hiệu lực trong tệp ngay', async (t) => {
  const { call, owner, disk, deps } = await ready(t, { sidecar: fakeSidecar({ groups: async () => [{ id: G, name: 'Tổ Hoá', members: 12 }] }) });
  const first = await call('/api/permissions', { cookie: owner });
  assert.equal(first.status, 200);
  assert.equal(first.json.exists, false);
  assert.deepEqual(first.json.features.map((f) => f.key), FEATURE_KEYS);
  assert.deepEqual(first.json.defaults.features, allOn());

  const saved = await call(`/api/permissions/groups/${G}`, { method: 'PUT', cookie: owner, body: body({ active: false }, { web: false }) });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.groups[G], { name: 'Tổ Hoá', custom: true, active: false, replyOnlyTagged: true, features: { ...allOn(), web: false } });
  assert.deepEqual(disk().groups[G], { name: 'Tổ Hoá', active: false, features: { web: false } });
  // Lần lưu đầu ghi cờ tag thật của bot vào mặc định một lần, không ghi vào nhóm.
  assert.equal(disk().defaults.replyOnlyTagged, true);

  const log = deps.activity.list();
  assert.equal(log[0].actor, 'khach');
  assert.equal(log[0].action, 'permissions_group');
  assert.equal(log[0].detail, 'Tổ Hoá: Tạm tắt · chỉ trả lời khi được tag · tắt: Tra cứu web');
});

test('lưu mặc định ghi đủ khoá; nhóm đưa về đúng mặc định thì mục riêng biến mất', async (t) => {
  const { call, admin, disk, deps } = await ready(t);
  const d = await call('/api/permissions/defaults', { method: 'PUT', cookie: admin, body: body({ replyOnlyTagged: false }, { video: false }) });
  assert.equal(d.status, 200);
  assert.deepEqual(disk().defaults, { active: true, replyOnlyTagged: false, features: { ...allOn(), video: false } });
  await call(`/api/permissions/groups/${G}`, { method: 'PUT', cookie: admin, body: body({}, { video: false }) });
  assert.deepEqual(disk().groups[G], { replyOnlyTagged: true }); // khác mặc định; bot chưa biết tên nhóm này → không ghi name
  await call(`/api/permissions/groups/${G}`, { method: 'PUT', cookie: admin, body: body({ replyOnlyTagged: false }, { video: false }) });
  assert.deepEqual(disk().groups, {});
  assert.match(deps.activity.list()[0].detail, /: dùng mặc định$/);
});

test('dữ liệu sai → 400 tiếng Việt, tệp không đổi', async (t) => {
  const { call, admin, deps } = await ready(t);
  for (const [path, payload] of [
    ['/api/permissions/groups/abc', body()],
    [`/api/permissions/groups/${G}`, { ...body(), active: 'true' }],
    [`/api/permissions/groups/${G}`, { ...body(), features: { web: true } }],
    ['/api/permissions/defaults', { ...body(), features: { ...allOn(), lạ: true } }],
  ]) {
    const res = await call(path, { method: 'PUT', cookie: admin, body: payload });
    assert.equal(res.status, 400, path);
    assert.match(res.json.error, /—/);
  }
  assert.equal(deps.permissions.get().exists, false);
});

test('tệp hỏng: GET báo corrupt và mặc định; lưu ghi lại tệp sạch', async (t) => {
  const { call, admin, deps, disk } = await ready(t);
  await call('/api/permissions/defaults', { method: 'PUT', cookie: admin, body: body() });
  writeFileSync(join(deps.dir, 'zalo', 'permissions.json'), 'không phải json');
  const res = await call('/api/permissions', { cookie: admin });
  assert.equal(res.json.corrupt, true);
  assert.deepEqual(res.json.defaults.features, allOn());
  await call(`/api/permissions/groups/${G}`, { method: 'PUT', cookie: admin, body: body({}, { kb: false }) });
  assert.equal(disk().version, 1);
});

test('GET /api/groups: tên trùng ID thành tên dự phòng; bot tắt → 503 tiếng Việt', async (t) => {
  const { call, admin } = await ready(t, { sidecar: fakeSidecar({ groups: async () => [
    { id: G, name: G, members: 3 }, { id: '200', name: 'Tổ Hoá', members: 12 }, { id: 'x', name: 'lạ' },
  ] }) });
  const res = await call('/api/groups', { cookie: admin });
  assert.deepEqual(res.json.groups, [
    { id: G, name: 'Nhóm …4899', members: 3 }, { id: '200', name: 'Tổ Hoá', members: 12 },
  ]);
  const down = await ready(t, { sidecar: fakeSidecar({ groups: async () => { throw Object.assign(new Error('x'), { name: 'SidecarDown' }); } }) });
  const off = await down.call('/api/groups', { cookie: down.admin });
  assert.equal(off.status, 503);
  assert.match(off.json.error, /Kết nối Zalo đang tắt/);
});

test('Nhật ký hỏng không biến lần lưu thành công thành 500', async (t) => {
  const { call, admin, disk, deps } = await ready(t);
  deps.activity.append = () => { throw new Error('đĩa đầy'); };
  const res = await call(`/api/permissions/groups/${G}`, { method: 'PUT', cookie: admin, body: body({ active: false }) });
  assert.equal(res.status, 200);
  assert.equal(disk().groups[G].active, false);
});

test('quá 500 nhóm riêng → 400 có hướng dẫn; nhóm đã có vẫn sửa được', async (t) => {
  const { call, admin, deps } = await ready(t);
  for (let i = 1; i <= 500; i++) deps.permissions.setGroup(String(i), { active: false, replyOnlyTagged: true, features: allOn() });
  const over = await call(`/api/permissions/groups/${G}`, { method: 'PUT', cookie: admin, body: body({ active: false }) });
  assert.equal(over.status, 400);
  assert.match(over.json.error, /500.*—/);
  const again = await call('/api/permissions/groups/1', { method: 'PUT', cookie: admin, body: body({ active: true }) });
  assert.equal(again.status, 200);
});
