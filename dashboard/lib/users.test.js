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

test('reset-admin (tiến trình khác) sửa users.json thì dashboard đang chạy thấy ngay, không ghi đè', (t) => {
  const { s: server, file } = store(t);
  server.create({ username: 'anh', role: 'owner', password: 'matkhau-cu-1' });
  server.create({ username: 'khach', role: 'owner', password: 'matkhau-khach' });
  server.update('anh', { disabled: true });
  const cli = createUserStore(file);
  cli.setPassword('anh', 'matkhau-moi-1');
  cli.update('anh', { disabled: false, role: 'admin' });
  assert.equal(server.verifyPassword('anh', 'matkhau-moi-1'), true);
  assert.equal(server.get('anh').disabled, false);
  server.update('khach', { disabled: true }); // ghi tiếp từ server không làm mất thay đổi của CLI
  assert.equal(createUserStore(file).verifyPassword('anh', 'matkhau-moi-1'), true);
  assert.equal(createUserStore(file).get('anh').role, 'admin');
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

test('UID phải là chuỗi: số JSON bị từ chối (create và update)', (t) => {
  const { s } = store(t);
  assert.throws(() => s.create({ username: 'abc', role: 'owner', zaloUid: 1234567890123456789 }), (e) => e.statusCode === 400 && /UID Zalo phải là chuỗi chữ số/.test(e.message));
  s.create({ username: 'abc', role: 'owner' });
  assert.throws(() => s.update('abc', { zaloUid: 1234567890123456789 }), (e) => e.statusCode === 400 && /chuỗi chữ số/.test(e.message));
});

test('mật khẩu tối đa 256 ký tự; verify mật khẩu quá dài trả false', (t) => {
  const { s } = store(t);
  const long = 'a'.repeat(257);
  assert.throws(() => s.create({ username: 'abc', role: 'owner', password: long }), (e) => e.statusCode === 400 && /tối đa 256/.test(e.message));
  s.create({ username: 'abc', role: 'owner', password: 'a'.repeat(256) });
  assert.throws(() => s.setPassword('abc', long), /tối đa 256/);
  assert.equal(s.verifyPassword('abc', 'a'.repeat(256)), true);
  assert.equal(s.verifyPassword('abc', long), false);
});
