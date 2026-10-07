// Chủ nhân bot (spec §4 #8, §7.1, §9): ZALO_ALLOWED_USERS trong .env của Hermes. Đổi xong phải khởi động lại —
// trợ lý (gateway) và kết nối Zalo (sidecar) đều chỉ đọc biến này lúc khởi động. Cờ "chờ khởi động lại" lưu ra
// tệp để tải lại trang vẫn thấy banner vàng.
import { rmSync } from 'node:fs';
import { readEnvKey, writeEnvKey } from './env-file.js';
import { readJson, writeJsonAtomic } from './json-store.js';
import { ZALO_UID } from './users.js';

export const OWNER_KEY = 'ZALO_ALLOWED_USERS';
export const MAX_OWNERS = 20;

const bad = (m) => Object.assign(new Error(m), { statusCode: 400 });

export const splitOwners = (raw) => String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Kiểm danh sách UID gửi lên: mảng chuỗi UID hợp lệ, bỏ trùng, 1–20 người. */
export function parseOwners(list) {
  if (!Array.isArray(list)) throw bad('Danh sách chủ nhân không hợp lệ — tải lại trang rồi thử lại.');
  const uids = [];
  for (const item of list) {
    const uid = typeof item === 'string' ? item.trim() : '';
    if (!ZALO_UID.test(uid)) throw bad(`"${String(item).slice(0, 30)}" không phải UID Zalo (dãy 15–22 chữ số, không bắt đầu bằng 0) — sửa lại rồi lưu.`);
    if (!uids.includes(uid)) uids.push(uid);
  }
  if (!uids.length) throw bad('Bot phải còn ít nhất một chủ nhân — thêm UID khác trước khi bỏ người cuối cùng.');
  if (uids.length > MAX_OWNERS) throw bad(`Tối đa ${MAX_OWNERS} chủ nhân — bỏ bớt rồi lưu.`);
  return uids;
}

export function createOwnersStore({ envFile, sidecarEnvFile, pendingFile, now = Date.now }) {
  const list = () => splitOwners(readEnvKey(envFile, OWNER_KEY));
  return {
    list,
    /** .env của thư mục bot cũng đặt khoá này (nạp trước .env Hermes) và khác → kết nối Zalo sẽ không theo danh sách mới. */
    shadowed() {
      const local = sidecarEnvFile ? readEnvKey(sidecarEnvFile, OWNER_KEY) : null;
      return Boolean(local) && splitOwners(local).join(',') !== list().join(',');
    },
    /** Ghi danh sách mới; trả true nếu có thay đổi (khi đó đánh dấu chờ khởi động lại). */
    set(uids, by) {
      if (uids.join(',') === list().join(',')) return false;
      writeEnvKey(envFile, OWNER_KEY, uids.join(','));
      writeJsonAtomic(pendingFile, { since: now(), by: String(by) });
      return true;
    },
    pending() {
      const p = readJson(pendingFile, null);
      return p && Number.isFinite(p.since) ? p : null;
    },
    clearPending() { rmSync(pendingFile, { force: true }); },
  };
}
