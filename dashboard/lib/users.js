import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readJson, writeJsonAtomic } from './json-store.js';

const NAME = /^[a-z0-9._-]{3,32}$/;
export const ZALO_UID = /^[1-9]\d{14,21}$/;
const ROLES = new Set(['admin', 'owner']);
const MAX_PASSWORD = 256;
const bad = (m) => Object.assign(new Error(m), { statusCode: 400 });

export function validatePassword(pw) {
  if (String(pw).length < 8) throw bad('Mật khẩu cần ít nhất 8 ký tự');
  if (String(pw).length > MAX_PASSWORD) throw bad('Mật khẩu tối đa 256 ký tự');
}

export function validateUsername(username) {
  const name = String(username || '').trim().toLowerCase();
  if (!NAME.test(name)) throw bad('Tên đăng nhập 3–32 ký tự: chữ thường, số, dấu . _ -');
  return name;
}

export function validateZaloUid(uid) {
  if (uid != null && uid !== '' && typeof uid !== 'string') throw bad('UID Zalo phải là chuỗi chữ số');
  if (uid && !ZALO_UID.test(uid)) throw bad('UID Zalo không hợp lệ (dãy 15–22 chữ số, không bắt đầu bằng 0)');
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(String(password), salt, 64).toString('hex')}`;
}

export function verifyHash(password, stored) {
  const [kind, saltHex, hashHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = scryptSync(String(password), Buffer.from(saltHex, 'hex'), want.length);
  return timingSafeEqual(got, want);
}

const toPublic = (u) => ({
  username: u.username, role: u.role, zaloUid: u.zaloUid, disabled: Boolean(u.disabled), hasPassword: Boolean(u.passwordHash),
  createdAt: u.createdAt, lastLoginAt: Number.isFinite(u.lastLoginAt) ? u.lastLoginAt : null,
});

export function createUserStore(path) {
  const load = () => readJson(path, { users: [] });
  const save = (data) => writeJsonAtomic(path, data);
  const checkPassword = validatePassword;
  const checkUid = validateZaloUid;

  return {
    list: () => load().users.map(toPublic),
    get: (username) => load().users.find((u) => u.username === username) || null,
    hasAdmin: () => load().users.some((u) => u.role === 'admin' && !u.disabled),
    create({ username, role, zaloUid = '', password = '' }) {
      const name = validateUsername(username);
      if (!ROLES.has(role)) throw bad('Vai trò phải là Quản trị hoặc Chủ bot');
      checkUid(zaloUid);
      if (password) checkPassword(password);
      const data = load();
      if (data.users.some((u) => u.username === name)) throw bad('Tên đăng nhập đã tồn tại');
      const user = { username: name, role, zaloUid: zaloUid || '', disabled: false, passwordHash: password ? hashPassword(password) : '', createdAt: Date.now() };
      data.users.push(user);
      save(data);
      return toPublic(user);
    },
    update(username, patch = {}) {
      const data = load();
      const user = data.users.find((u) => u.username === username);
      if (!user) throw Object.assign(new Error('Không có người dùng này'), { statusCode: 404 });
      if (patch.role !== undefined) { if (!ROLES.has(patch.role)) throw bad('Vai trò phải là Quản trị hoặc Chủ bot'); user.role = patch.role; }
      if (patch.zaloUid !== undefined) { checkUid(patch.zaloUid); user.zaloUid = patch.zaloUid || ''; }
      if (patch.disabled !== undefined) user.disabled = Boolean(patch.disabled);
      save(data);
      return toPublic(user);
    },
    setPassword(username, password) {
      checkPassword(password);
      const data = load();
      const user = data.users.find((u) => u.username === username);
      if (!user) throw Object.assign(new Error('Không có người dùng này'), { statusCode: 404 });
      user.passwordHash = hashPassword(password);
      save(data);
    },
    /** Ghi thời điểm đăng nhập thành công gần nhất (hiện ở màn Người dùng). Không có người này thì bỏ qua. */
    recordLogin(username, at = Date.now()) {
      const data = load();
      const user = data.users.find((u) => u.username === username);
      if (!user) return;
      user.lastLoginAt = at;
      save(data);
    },
    verifyPassword(username, password) {
      const user = load().users.find((u) => u.username === username);
      if (!user || user.disabled || !user.passwordHash || String(password).length > MAX_PASSWORD) { hashPassword('dummy-timing'); return false; }
      return verifyHash(password, user.passwordHash);
    },
  };
}
