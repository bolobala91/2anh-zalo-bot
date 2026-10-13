import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';
import { createMemoryTags } from '../lib/memory-tags.js';

test('bộ nhớ trợ lý: chỉ Quản trị; sửa/xoá ghi Nhật ký không kèm nội dung; mục cũ → 409', async (t) => {
  const deps = makeDeps(t);
  mkdirSync(join(deps.dir, 'memories'), { recursive: true });
  writeFileSync(join(deps.dir, 'memories', 'MEMORY.md'), 'Anh dạy Hoá\n§\nBí mật: số nhà 12');
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/agent-memory', { cookie: owner })).status, 403);
  const admin = await loginAs(t, deps, call);
  const v = await call('/api/admin/agent-memory', { cookie: admin });
  assert.deepEqual(v.json.memory.entries, ['Anh dạy Hoá', 'Bí mật: số nhà 12']);
  const put = await call('/api/admin/agent-memory/memory/0', { method: 'PUT', cookie: admin, body: { old: 'Anh dạy Hoá', text: 'Anh dạy Hoá lớp 10' } });
  assert.equal(put.status, 200);
  assert.equal(put.json.memory.entries[0], 'Anh dạy Hoá lớp 10');
  assert.equal((await call('/api/admin/agent-memory/memory/1', { method: 'DELETE', cookie: admin, body: { old: 'sai' } })).status, 409);
  assert.equal((await call('/api/admin/agent-memory/memory/1', { method: 'DELETE', cookie: admin, body: { old: 'Bí mật: số nhà 12' } })).status, 200);
  assert.equal(readFileSync(join(deps.dir, 'memories', 'MEMORY.md'), 'utf8'), 'Anh dạy Hoá lớp 10');
  assert.equal((await call('/api/admin/agent-memory/khac/0', { method: 'DELETE', cookie: admin, body: { old: 'x' } })).status, 400);
  const log = deps.activity.list().filter((e) => e.action.startsWith('agent_memory'));
  assert.deepEqual(log.map((e) => e.detail), ['Ghi chú của trợ lý, mục 2', 'Ghi chú của trợ lý, mục 1']);
  assert.doesNotMatch(JSON.stringify(log), /Bí mật/);
});

test('bộ nhớ trợ lý: thêm điều cần nhớ (chỉ Quản trị), trùng → 409, trống → 400, ghi Nhật ký', async (t) => {
  const deps = makeDeps(t);
  mkdirSync(join(deps.dir, 'memories'), { recursive: true });
  writeFileSync(join(deps.dir, 'memories', 'USER.md'), 'Anh dạy Hoá');
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/agent-memory/user', { method: 'POST', cookie: owner, body: { text: 'x' } })).status, 403);
  const admin = await loginAs(t, deps, call);
  const add = await call('/api/admin/agent-memory/user', { method: 'POST', cookie: admin, body: { text: 'Thích trả lời ngắn' } });
  assert.equal(add.status, 200);
  assert.deepEqual(add.json.user.entries, ['Anh dạy Hoá', 'Thích trả lời ngắn']);
  assert.equal(readFileSync(join(deps.dir, 'memories', 'USER.md'), 'utf8'), 'Anh dạy Hoá\n§\nThích trả lời ngắn');
  assert.equal((await call('/api/admin/agent-memory/user', { method: 'POST', cookie: admin, body: { text: 'Thích trả lời ngắn' } })).status, 409);
  assert.equal((await call('/api/admin/agent-memory/user', { method: 'POST', cookie: admin, body: { text: '  ' } })).status, 400);
  assert.ok(deps.activity.list().some((e) => e.action === 'agent_memory_add'));
});

test('bộ nhớ trợ lý: xoá nhiều mục một lần (chỉ Quản trị), một dòng Nhật ký; mục lệch → 409 không xoá gì', async (t) => {
  const deps = makeDeps(t);
  mkdirSync(join(deps.dir, 'memories'), { recursive: true });
  const file = join(deps.dir, 'memories', 'MEMORY.md');
  writeFileSync(file, 'a\n§\nb\n§\nc');
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const items = [{ index: 0, old: 'a' }, { index: 2, old: 'c' }];
  assert.equal((await call('/api/admin/agent-memory/memory/bulk-delete', { method: 'POST', cookie: owner, body: { items } })).status, 403);
  const admin = await loginAs(t, deps, call);
  assert.equal((await call('/api/admin/agent-memory/memory/bulk-delete', { method: 'POST', cookie: admin, body: { items: [...items, { index: 1, old: 'x' }] } })).status, 409);
  assert.equal((await call('/api/admin/agent-memory/memory/bulk-delete', { method: 'POST', cookie: admin, body: { items: 'a' } })).status, 400);
  assert.equal((await call('/api/admin/agent-memory/khac/bulk-delete', { method: 'POST', cookie: admin, body: { items } })).status, 400);
  const r = await call('/api/admin/agent-memory/memory/bulk-delete', { method: 'POST', cookie: admin, body: { items } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.memory.entries, ['b']);
  assert.equal(readFileSync(file, 'utf8'), 'b');
  const log = deps.activity.list().filter((e) => e.action === 'agent_memory_delete');
  assert.deepEqual(log.map((e) => e.detail), ['Ghi chú của trợ lý, 2 mục']);
});

test('bộ nhớ trợ lý: gắn một loại cho nhiều mục (thay thẻ cũ), loại lạ → 400, một dòng Nhật ký', async (t) => {
  const deps = makeDeps(t);
  deps.memoryTags = createMemoryTags({ hermesHome: deps.dir, agentMemory: deps.agentMemory });
  mkdirSync(join(deps.dir, 'memories'), { recursive: true });
  const file = join(deps.dir, 'memories', 'USER.md');
  writeFileSync(file, '[Khác] a\n§\nb\n§\nc');
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const items = [{ index: 0, old: '[Khác] a' }, { index: 1, old: 'b' }];
  assert.equal((await call('/api/admin/agent-memory/user/bulk-tag', { method: 'POST', cookie: owner, body: { items, tag: 'Dịch vụ & giá' } })).status, 403);
  const admin = await loginAs(t, deps, call);
  assert.equal((await call('/api/admin/agent-memory/user/bulk-tag', { method: 'POST', cookie: admin, body: { items, tag: 'Không có' } })).status, 400);
  const r = await call('/api/admin/agent-memory/user/bulk-tag', { method: 'POST', cookie: admin, body: { items, tag: 'Dịch vụ & giá' } });
  assert.equal(r.status, 200);
  assert.equal(readFileSync(file, 'utf8'), '[Dịch vụ & giá] a\n§\n[Dịch vụ & giá] b\n§\nc');
  assert.equal((await call('/api/admin/agent-memory/user/bulk-tag', { method: 'POST', cookie: admin, body: { items, tag: 'Khác' } })).status, 409);
  const log = deps.activity.list().filter((e) => e.action === 'agent_memory_edit');
  assert.deepEqual(log.map((e) => e.detail), ['Hồ sơ chủ nhân: gắn loại "Dịch vụ & giá" cho 2 mục']);
});
