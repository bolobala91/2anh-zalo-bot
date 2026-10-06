import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserStore } from './users.js';

function store(t) { const d = mkdtempSync(join(tmpdir(), 'zd-users-')); t.after(() => rmSync(d, { recursive: true, force: true })); return { s: createUserStore(join(d, 'users.json')), file: join(d, 'users.json') }; }

test('tạo, đặt mật khẩu, kiểm mật khẩu; tệp không chứa mật khẩu thật', (t) => {
  const { s, file } = store(t);
  s.create({ username: 'anh', role: 'admin', zaloUid: '1234567890123456', password: 'matkhau-dai' });
  assert.equal(s.verifyPassword('anh', 'matkhau-dai'), true);
  assert.equal(s.verifyPassword('anh', 'sai'), false);
  assert.equal(s.verifyPassword('khongco', 'x'), false);
  assert.ok(!readFileSync(file, 'utf8').includes('matkhau-dai'));
  assert.equal(s.hasAdmin(), true);
});

test('bản công khai không lộ mật khẩu băm', (t) => {
  const { s } = store(t);
  const u = s.create({ username: 'khach', role: 'owner', password: 'abcdefgh' });
  assert.deepEqual(Object.keys(u).sort(), ['createdAt', 'disabled', 'hasPassword', 'role', 'username', 'zaloUid']);
});

test('từ chối dữ liệu sai', (t) => {
  const { s } = store(t);
  assert.throws(() => s.create({ username: 'A', role: 'admin' }), /Tên đăng nhập/);
  assert.throws(() => s.create({ username: 'abc', role: 'boss' }), /Vai trò/);
  assert.throws(() => s.create({ username: 'abc', role: 'owner', zaloUid: '0912345678' }), /UID/);
  assert.throws(() => s.create({ username: 'abc', role: 'owner', password: 'ngan' }), /8 ký tự/);
  s.create({ username: 'abc', role: 'owner' });
  assert.throws(() => s.create({ username: 'abc', role: 'owner' }), /đã tồn tại/);
});

test('khoá tài khoản thì không kiểm mật khẩu được', (t) => {
  const { s } = store(t);
  s.create({ username: 'khach', role: 'owner', password: 'abcdefgh' });
  s.update('khach', { disabled: true });
  assert.equal(s.verifyPassword('khach', 'abcdefgh'), false);
});
