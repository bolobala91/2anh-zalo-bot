/**
 * Phân quyền Bot theo nhóm (spec §8): đọc/ghi/kiểm `<HERMES_HOME>/zalo/permissions.json`.
 * Plugin Python (hermes-plugin/zalo_tools/group_permissions.py) đọc nóng tệp này — hai bên
 * phải cùng lược đồ: lớp gộp mặc định gốc ← `defaults` ← `groups[id]`, khoá thiếu rơi xuống lớp dưới.
 * Ghi nguyên tử (tệp tạm rồi đổi tên), quyền 600, giữ bản trước ở `.bak`.
 */
import { chmodSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './json-store.js';

export const FEATURES = [
  { key: 'web', label: 'Tra cứu web', hint: 'Tìm và đọc trang web' },
  { key: 'files', label: 'Gửi và tạo tệp', hint: 'Gửi tệp, tạo Word/Excel/PowerPoint, xử lý PDF' },
  { key: 'voice', label: 'Tin nhắn thoại', hint: 'Bot trả lời bằng giọng nói' },
  { key: 'reminders', label: 'Nhắc hẹn', hint: 'Tạo, xem, xoá lời nhắc của Zalo' },
  { key: 'groupCron', label: 'Hẹn giờ cho nhóm', hint: 'Thành viên tạo việc bot tự làm theo lịch. Tắt chỉ chặn tạo mới — việc đã tạo vẫn chạy' },
  { key: 'kb', label: 'Kho tài liệu', hint: 'Đọc tài liệu chủ bot đã mở cho nhóm' },
  { key: 'people', label: 'Sổ người quen', hint: 'Ghi nhớ và tra hồ sơ thành viên' },
  { key: 'academic', label: 'Tra cứu học thuật', hint: 'Tìm bài báo khoa học' },
  { key: 'video', label: 'Video', hint: 'Xem thông tin và tải video từ link' },
];
export const FEATURE_KEYS = FEATURES.map((f) => f.key);
const SWITCHES = ['active', 'replyOnlyTagged'];
export const GROUP_ID = /^\d{1,32}$/;
const MAX_NAME = 120;

export class InvalidPermissions extends Error {
  constructor(message) { super(message); this.name = 'InvalidPermissions'; this.status = 400; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Một lớp: chỉ giữ khoá biết và đúng kiểu boolean — giống `_layer` bên Python. */
function layer(raw) {
  if (!isObj(raw)) return {};
  const out = {};
  for (const k of SWITCHES) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  const features = {};
  if (isObj(raw.features)) for (const k of FEATURE_KEYS) if (typeof raw.features[k] === 'boolean') features[k] = raw.features[k];
  if (Object.keys(features).length) out.features = features;
  return out;
}

/** Chuẩn hoá nội dung tệp; ném lỗi khi không phải lược đồ phiên bản 1. */
export function normalize(raw) {
  if (!isObj(raw) || raw.version !== 1) throw new Error('không phải permissions.json phiên bản 1');
  const groups = {};
  for (const [id, entry] of Object.entries(isObj(raw.groups) ? raw.groups : {})) {
    if (!GROUP_ID.test(id)) continue;
    const l = layer(entry);
    const name = isObj(entry) && typeof entry.name === 'string' ? entry.name.trim().slice(0, MAX_NAME) : '';
    groups[id] = name ? { name, ...l } : l;
  }
  return { version: 1, defaults: layer(raw.defaults), groups };
}

/** Kiểm thân request: đủ hai công tắc và đủ 9 nút, tất cả boolean. */
export function parseSettings(body) {
  if (!isObj(body)) throw new InvalidPermissions('Dữ liệu phân quyền không hợp lệ — tải lại trang rồi thử lại.');
  for (const k of SWITCHES) {
    if (typeof body[k] !== 'boolean') throw new InvalidPermissions('Thiếu công tắc Hoạt động hoặc Chỉ trả lời khi được tag — tải lại trang rồi thử lại.');
  }
  const f = body.features;
  if (!isObj(f) || Object.keys(f).some((k) => !FEATURE_KEYS.includes(k)) || FEATURE_KEYS.some((k) => typeof f[k] !== 'boolean')) {
    throw new InvalidPermissions('Danh sách tính năng không hợp lệ — tải lại trang rồi thử lại.');
  }
  return { active: body.active, replyOnlyTagged: body.replyOnlyTagged, features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, f[k]])) };
}

/**
 * @param {{ file: string, globalReplyOnlyTagged?: boolean }} opts
 *   globalReplyOnlyTagged — cờ ZALO_GROUP_REPLY_ONLY_TAGGED đang dùng, chỉ để hiển thị khi tệp chưa ghi khoá này.
 */
export function createPermissionsStore({ file, globalReplyOnlyTagged = true }) {
  const builtin = () => ({ active: true, replyOnlyTagged: globalReplyOnlyTagged, features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) });
  const merge = (base, l) => ({
    active: l.active ?? base.active,
    replyOnlyTagged: l.replyOnlyTagged ?? base.replyOnlyTagged,
    features: { ...base.features, ...(l.features || {}) },
  });

  /** `{ data, exists, corrupt }` — tệp hỏng thì data rỗng (bot cũng đang dùng mặc định), không đổi tên tệp. */
  function read() {
    if (!existsSync(file)) return { data: { version: 1, defaults: {}, groups: {} }, exists: false, corrupt: false };
    try {
      return { data: normalize(JSON.parse(readFileSync(file, 'utf8'))), exists: true, corrupt: false };
    } catch (err) {
      console.warn(`[dashboard] ${file} hỏng — bot đang dùng mặc định: ${err.message}`);
      return { data: { version: 1, defaults: {}, groups: {} }, exists: true, corrupt: true };
    }
  }

  function write(data) {
    if (existsSync(file)) {
      copyFileSync(file, `${file}.bak`);
      try { chmodSync(`${file}.bak`, 0o600); } catch { /* Windows */ }
    }
    writeJsonAtomic(file, data);
  }

  const view = ({ data, exists, corrupt }) => {
    const defaults = merge(builtin(), data.defaults);
    const groups = Object.fromEntries(Object.entries(data.groups).map(([id, g]) => [id, { name: g.name || '', custom: true, ...merge(defaults, g) }]));
    return { exists, corrupt, defaults, groups };
  };

  return {
    /** Trạng thái đã gộp cho giao diện: `{ exists, corrupt, defaults, groups: { id: { name, custom, active, replyOnlyTagged, features } } }`. */
    get() { return view(read()); },
    /** Lưu mặc định: ghi đủ mọi khoá (người dùng đã chọn từng nút). */
    setDefaults(settings) {
      const { data } = read();
      data.defaults = settings;
      write(data);
      return view({ data, exists: true, corrupt: false });
    },
    /**
     * Lưu một nhóm: chỉ ghi khoá khác mặc định (spec §8.1), để nút chưa đụng tới đi theo mặc định sau này.
     * Không còn khoá nào khác → xoá mục của nhóm. Trả `{ state, changed: string[] }` (các khoá khác mặc định).
     */
    setGroup(groupId, settings, name = '') {
      if (!GROUP_ID.test(groupId)) throw new InvalidPermissions('Nhóm không hợp lệ — chọn lại từ danh sách.');
      const { data } = read();
      const defaults = merge(builtin(), data.defaults);
      const entry = {};
      for (const k of SWITCHES) if (settings[k] !== defaults[k]) entry[k] = settings[k];
      const features = Object.fromEntries(FEATURE_KEYS.filter((k) => settings.features[k] !== defaults.features[k]).map((k) => [k, settings.features[k]]));
      if (Object.keys(features).length) entry.features = features;
      const changed = [...Object.keys(entry).filter((k) => k !== 'features'), ...Object.keys(features)];
      const cleanName = String(name || data.groups[groupId]?.name || '').trim().slice(0, MAX_NAME);
      if (changed.length) data.groups[groupId] = cleanName ? { name: cleanName, ...entry } : entry;
      else delete data.groups[groupId];
      write(data);
      return { state: view({ data, exists: true, corrupt: false }), changed };
    },
  };
}
