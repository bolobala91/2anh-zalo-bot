/**
 * Quyền nhắn riêng (spec §16): mục `dm` trong `<HERMES_HOME>/zalo/permissions.json`.
 * Dùng chung cho kết nối Zalo (chặn lệnh của lượt nhắn riêng) và dashboard (đọc/ghi).
 * Plugin Python đọc cùng lược đồ ở hermes-plugin/zalo_tools/group_permissions.py — hai bên phải khớp.
 *
 * {
 *   "who": "owners" | "list" | "everyone",
 *   "features": { "web": false },                    // chỉ khoá khác "bật"
 *   "people": { "<uid>": { "name": "Cô Lan", "features": { "voice": false } } }
 * }
 * Không có mục `dm` → null: mọi nơi giữ hành vi cũ (ZALO_DM_POLICY, mọi tính năng bật).
 * Thư mục (`folders[fid].people`) cũng chứa người: vào thư mục = có trong danh sách, và nhận đúng các nút thư mục
 * đang hiện (mặc định nhóm ← thư mục). Dữ liệu này chỉ gắn vào bản đọc ở kết nối Zalo (`folderPeople`), không ghi lại.
 * Chủ nhân không bao giờ bị mục này chặn — bên gọi tự miễn trừ trước.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const DM_WHO = ['owners', 'list', 'everyone'];
// "Hẹn giờ cho nhóm" không có nghĩa trong tin nhắn riêng (công cụ tự từ chối ngoài nhóm).
export const DM_FEATURE_KEYS = ['web', 'files', 'voice', 'reminders', 'kb', 'people', 'academic', 'video', 'history'];
// Xưởng tạo sản phẩm (spec §17): nằm cùng `features` trong tệp nhưng thiếu khoá = TẮT. Kết nối Zalo không dùng tới;
// chỉ giữ lại để dashboard lưu nhắn riêng không làm rơi chúng.
export const STUDIO_KEYS = ['studioSlides', 'studioDocs', 'studioExams', 'studioVideo', 'studioImage', 'studioAIVideo'];
const UID_KEY = /^\d{1,32}$/;
const MAX_NAME = 80;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function bools(raw, keys = [...DM_FEATURE_KEYS, ...STUDIO_KEYS]) {
  const out = {};
  if (isObj(raw)) for (const k of keys) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  return out;
}

/** Chuẩn hoá mục `dm`; không phải object → null. Khoá lạ, sai kiểu bị bỏ — giống `_dm` bên Python. */
export function normalizeDm(raw) {
  if (!isObj(raw)) return null;
  const out = { features: bools(raw.features), people: {} };
  if (DM_WHO.includes(raw.who)) out.who = raw.who;
  if (isObj(raw.people)) {
    for (const [uid, entry] of Object.entries(raw.people)) {
      if (!UID_KEY.test(uid)) continue;
      const person = { features: bools(isObj(entry) ? entry.features : null) };
      const name = isObj(entry) && typeof entry.name === 'string' ? entry.name.trim().slice(0, MAX_NAME) : '';
      if (name) person.name = name;
      out.people[uid] = person;
    }
  }
  return out;
}

/**
 * Quyết định cho một người KHÔNG phải chủ nhân.
 * `allowed`: true/false theo `who`; null khi tệp chưa chọn `who` (bên gọi dùng ZALO_DM_POLICY).
 * `features`: đủ 8 nút — mặc định bật ← `dm.features` ← `people[uid].features`.
 */
export function dmVerdict(dm, uid) {
  const key = String(uid ?? '');
  // Object.hasOwn: "constructor", "__proto__"… không được tính là người trong danh sách qua prototype.
  const person = dm?.people && Object.hasOwn(dm.people, key) ? dm.people[key] : undefined;
  const inFolder = dm?.folderPeople && Object.hasOwn(dm.folderPeople, key) ? dm.folderPeople[key] : undefined;
  const features = Object.fromEntries(DM_FEATURE_KEYS.map((k) => [k, true]));
  Object.assign(features, inFolder ? bools(inFolder, DM_FEATURE_KEYS) : bools(dm?.features, DM_FEATURE_KEYS), bools(person?.features, DM_FEATURE_KEYS));
  const who = dm?.who;
  const allowed = who == null ? null : who === 'everyone' || (who === 'list' && Boolean(person || inFolder));
  return { allowed, features };
}

/** `{ uid: nút đã gộp (mặc định nhóm ← thư mục) }` cho mọi người nằm trong thư mục; người ở nhiều thư mục → thư mục đầu. */
export function folderPeople(data) {
  const out = {};
  const defaults = bools(isObj(data?.defaults) ? data.defaults.features : null, DM_FEATURE_KEYS);
  for (const [fid, f] of Object.entries(isObj(data?.folders) ? data.folders : {})) {
    if (!/^[a-z0-9]{1,16}$/.test(fid) || !isObj(f) || !Array.isArray(f.people)) continue;
    const merged = { ...defaults, ...bools(f.features, DM_FEATURE_KEYS) };
    for (const p of f.people) {
      const uid = String((isObj(p) ? p.uid : p) ?? '');
      if (UID_KEY.test(uid) && !Object.hasOwn(out, uid)) out[uid] = merged;
    }
  }
  return out;
}

/** Đường dẫn permissions.json mà plugin cũng đọc: ZALO_PERMISSIONS_FILE hoặc <HERMES_HOME>/zalo/permissions.json. */
export function permissionsFileFromEnv(env = process.env) {
  const explicit = String(env.ZALO_PERMISSIONS_FILE || '').trim();
  if (explicit) return explicit;
  const home = String(env.HERMES_HOME || '').trim();
  return home ? join(home, 'zalo', 'permissions.json') : null;
}

/**
 * Đọc nóng mục `dm` (theo mtime + cỡ tệp). Trả hàm `() => dm | null`.
 * Không có tệp / tệp hỏng / không phải phiên bản 1 → null (không chặn gì thêm), cảnh báo một lần mỗi lần tệp đổi.
 */
export function createDmRules({ file, statImpl = statSync, readImpl = (p) => readFileSync(p, 'utf8'), warn = console.warn }) {
  let key = null;
  let value = null;
  return () => {
    if (!file) return null;
    let st;
    try { st = statImpl(file); } catch { key = null; value = null; return null; }
    const next = `${st.mtimeMs}:${st.size}`;
    if (next === key) return value;
    key = next;
    try {
      const data = JSON.parse(String(readImpl(file)).replace(/^\uFEFF/, ''));
      if (isObj(data) && data.version === 1) {
        const fp = folderPeople(data);
        const dm = normalizeDm(data.dm);
        value = dm || Object.keys(fp).length ? { ...(dm || { features: {}, people: {} }), folderPeople: fp } : null;
      } else value = null;
    } catch (err) {
      warn(`[dm] ${file} hỏng — bỏ qua quyền nhắn riêng trong tệp: ${err.message}`);
      value = null;
    }
    return value;
  };
}
