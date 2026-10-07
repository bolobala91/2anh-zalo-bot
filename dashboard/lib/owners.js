// Chủ nhân bot (spec §4 #8, §7.1, §9): ZALO_ALLOWED_USERS trong .env của Hermes. Gateway Hermes nạp lại .env mỗi
// lượt nên đổi là có hiệu lực ngay với trợ lý; chỉ kết nối Zalo (sidecar) đọc biến này lúc khởi động nên cần khởi
// động lại. Cờ "chờ khởi động lại" lưu ra tệp để tải lại trang vẫn thấy banner vàng.
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

const sameSet = (a, b) => {
  const x = [...new Set(a)].sort(); const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** `inheritedValue`: ZALO_ALLOWED_USERS trong môi trường dịch vụ, chụp trước khi nạp bất kỳ .env nào. */
export function createOwnersStore({ envFile, sidecarEnvFile, pendingFile, inheritedValue, now = Date.now }) {
  const list = () => splitOwners(readEnvKey(envFile, OWNER_KEY));
  return {
    list,
    /**
     * Nguồn ghi đè danh sách chủ nhân của kết nối Zalo: `sidecar` = .env của thư mục bot đặt khoá khác (nạp trước
     * .env Hermes); `os` = biến môi trường của dịch vụ/hệ điều hành đặt khoá khác. So như tập hợp, không theo thứ tự.
     */
    overrides() {
      const mine = list();
      const local = sidecarEnvFile ? readEnvKey(sidecarEnvFile, OWNER_KEY) : null;
      return {
        sidecar: Boolean(local) && !sameSet(splitOwners(local), mine),
        os: Boolean(inheritedValue) && !sameSet(splitOwners(inheritedValue), mine),
      };
    },
    /** Ghi danh sách mới; trả true nếu có thay đổi. Đặt cờ chờ TRƯỚC khi ghi .env để không bao giờ mất banner. */
    set(uids, by) {
      if (sameSet(uids, list())) return false;
      const prev = this.pending();
      writeJsonAtomic(pendingFile, { since: now(), by: String(by) });
      try { writeEnvKey(envFile, OWNER_KEY, uids.join(',')); } catch (err) {
        // .env không ghi được → không có gì cần áp dụng: trả cờ về như cũ.
        try { if (prev) writeJsonAtomic(pendingFile, prev); else rmSync(pendingFile, { force: true }); } catch { /* giữ cờ còn hơn mất */ }
        throw err;
      }
      return true;
    },
    pending() {
      const p = readJson(pendingFile, null);
      return p && Number.isFinite(p.since) ? p : null;
    },
    /** Đặt cờ chờ khởi động lại nếu chưa có (vd. thấy .env bot ghi đè: kết nối Zalo đang chạy theo danh sách khác). */
    markPending(by) {
      if (!this.pending()) writeJsonAtomic(pendingFile, { since: now(), by: String(by) });
    },
    clearPending() { rmSync(pendingFile, { force: true }); },
  };
}
