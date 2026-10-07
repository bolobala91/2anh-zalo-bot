/**
 * Phân quyền Bot theo nhóm (spec §8): đọc/ghi/kiểm `<HERMES_HOME>/zalo/permissions.json`.
 * Plugin Python (hermes-plugin/zalo_tools/group_permissions.py) đọc nóng tệp này — hai bên
 * phải cùng lược đồ: lớp gộp mặc định gốc ← `defaults` ← `groups[id]`, khoá thiếu rơi xuống lớp dưới.
 * Ghi nguyên tử (tệp tạm rồi đổi tên), quyền 600, giữ bản trước ở `.bak`.
 */
import { chmodSync, copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { parseEnv } from 'node:util';
import YAML from 'yaml';
import { writeJsonAtomic } from './json-store.js';
import { ZALO_UID } from './users.js';
import { DM_FEATURE_KEYS, DM_WHO, normalizeDm } from '../../dm-rules.js';

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
// Nút cho tin nhắn riêng (spec §16): 8 nút, không có "Hẹn giờ cho nhóm"; lời gợi ý viết cho một người.
const DM_HINTS = { kb: 'Đọc tài liệu chủ bot đã mở cho mọi người', people: 'Bot nhớ hồ sơ người nhắn để xưng hô đúng' };
export const DM_FEATURES = FEATURES.filter((f) => DM_FEATURE_KEYS.includes(f.key)).map((f) => ({ ...f, hint: DM_HINTS[f.key] || f.hint }));
const SWITCHES = ['active', 'replyOnlyTagged'];
export const GROUP_ID = /^\d{1,32}$/;
const MAX_NAME = 120;
const MAX_GROUPS = 500;
const MAX_DM_PEOPLE = 200;
const MAX_PERSON_NAME = 80;

export class InvalidPermissions extends Error {
  constructor(message) { super(message); this.name = 'InvalidPermissions'; this.status = 400; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `_truthy` của adapter: None → mặc định, còn lại so chuỗi đã hạ chữ thường. */
const truthy = (v, dflt = false) => (v === undefined || v === null ? dflt : ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase()));
const FLAG = 'ZALO_GROUP_REPLY_ONLY_TAGGED';

function readText(path) {
  try { return readFileSync(path, 'utf8').replace(/^﻿/, ''); } catch { return null; }
}

function fileStamp(path) {
  try { const s = statSync(path); return `${s.mtimeMs}:${s.size}`; } catch { return '-'; }
}

/**
 * Cờ ZALO_GROUP_REPLY_ONLY_TAGGED mà adapter của bot đang thấy — đọc lại khi tệp đổi (theo mtime).
 * Adapter: `_truthy(extra.get("reply_only_tagged", secret(FLAG, "true")))`, trong đó Hermes nạp
 * `<HERMES_HOME>/.env` đè lên biến môi trường của tiến trình, và giá trị env khác rỗng đè lên
 * `platforms.zalo.extra.reply_only_tagged` trong config.yaml (`_env_enablement`).
 * `inherited` = giá trị biến này trong môi trường dịch vụ trước khi dashboard nạp .env của sidecar
 * (cùng nguồn gateway được trao); không bao giờ lấy từ .env của sidecar.
 */
export function makeGlobalReplyOnlyTagged({ envFile, configFile, inherited }) {
  let key = null;
  let value = true;
  return () => {
    const next = `${fileStamp(envFile)}|${configFile ? fileStamp(configFile) : '-'}`;
    if (next === key) return value;
    const text = readText(envFile);
    let env = inherited;
    if (text !== null) {
      try { const parsed = parseEnv(text); if (Object.hasOwn(parsed, FLAG)) env = parsed[FLAG]; } catch { /* .env hỏng: Hermes cũng bỏ qua */ }
    }
    let extra;
    if (configFile) {
      try { extra = YAML.parse(readText(configFile) ?? '')?.platforms?.zalo?.extra; } catch { extra = undefined; }
    }
    if (env !== undefined && String(env).trim()) value = truthy(env, true);
    else if (isObj(extra) && Object.hasOwn(extra, 'reply_only_tagged')) value = truthy(extra.reply_only_tagged);
    else value = truthy(env ?? 'true');
    key = next;
    return value;
  };
}

/**
 * Hai giá trị Hermes đang dùng cho tin nhắn riêng, đọc lại khi .env/config.yaml đổi:
 * - `legacyWho`: ZALO_DM_POLICY ("open" → 'everyone', còn lại → 'owners') — áp khi tệp chưa có mục dm.
 *   Adapter: `extra.get("dm_policy", get_secret("ZALO_DM_POLICY", "owner-only"))` — config.yaml thắng .env.
 * - `gatewayOpen`: ZALO_ALLOW_ALL_USERS hoặc GATEWAY_ALLOW_ALL_USERS bật. Tắt thì Hermes tự chặn mọi người
 *   ngoài chủ nhân trước khi tới bot, nên chọn "danh sách"/"mọi người" chưa có tác dụng.
 * `inherited`: các biến đó trong môi trường dịch vụ, chụp trước khi nạp .env của thư mục bot.
 */
export function makeDmEnv({ envFile, configFile, inherited = {} }) {
  let key = null;
  let value = { legacyWho: 'owners', gatewayOpen: false };
  return () => {
    const next = `${fileStamp(envFile)}|${configFile ? fileStamp(configFile) : '-'}`;
    if (next === key) return value;
    let env = {};
    const text = readText(envFile);
    if (text !== null) {
      try { env = parseEnv(text); } catch { /* .env hỏng: Hermes cũng bỏ qua */ }
    }
    const pick = (name) => (Object.hasOwn(env, name) ? env[name] : inherited[name]);
    let extra;
    if (configFile) {
      try { extra = YAML.parse(readText(configFile) ?? '')?.platforms?.zalo?.extra; } catch { extra = undefined; }
    }
    const policy = isObj(extra) && Object.hasOwn(extra, 'dm_policy') ? extra.dm_policy : (pick('ZALO_DM_POLICY') ?? 'owner-only');
    value = {
      legacyWho: String(policy).trim().toLowerCase() === 'open' ? 'everyone' : 'owners',
      gatewayOpen: truthy(pick('ZALO_ALLOW_ALL_USERS')) || truthy(pick('GATEWAY_ALLOW_ALL_USERS')),
    };
    key = next;
    return value;
  };
}

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
  // Mục `dm` (giai đoạn 5) phải sống qua mọi lần lưu nhóm/mặc định.
  const dm = normalizeDm(raw.dm);
  return { version: 1, defaults: layer(raw.defaults), groups, ...(dm ? { dm } : {}) };
}

/**
 * Kiểm thân PUT /api/permissions/dm: `{ who, features: 8 nút, people: [{ uid, name?, features: 8 nút | null }] }`.
 * `features: null` ở một người = theo nút chung. UID trùng giữ mục đầu.
 */
export function parseDm(body) {
  if (!isObj(body) || !DM_WHO.includes(body.who)) throw new InvalidPermissions('Chưa chọn ai được nhắn riêng với bot — tải lại trang rồi thử lại.');
  const full = (f) => isObj(f) && !Object.keys(f).some((k) => !DM_FEATURE_KEYS.includes(k)) && DM_FEATURE_KEYS.every((k) => typeof f[k] === 'boolean');
  const pick8 = (f) => Object.fromEntries(DM_FEATURE_KEYS.map((k) => [k, f[k]]));
  if (!full(body.features)) throw new InvalidPermissions('Danh sách tính năng không hợp lệ — tải lại trang rồi thử lại.');
  if (!Array.isArray(body.people)) throw new InvalidPermissions('Danh sách người không hợp lệ — tải lại trang rồi thử lại.');
  if (body.people.length > MAX_DM_PEOPLE) throw new InvalidPermissions(`Danh sách tối đa ${MAX_DM_PEOPLE} người — bỏ bớt rồi lưu lại.`);
  const seen = new Set();
  const people = [];
  for (const p of body.people) {
    const uid = String(isObj(p) ? p.uid ?? '' : '').trim();
    if (!ZALO_UID.test(uid)) {
      throw new InvalidPermissions(`"${uid.slice(0, 30)}" không phải UID Zalo — UID là dãy 15–22 chữ số; nhờ người đó nhắn /sethome cho bot để biết.`);
    }
    if (p.features != null && !full(p.features)) throw new InvalidPermissions('Tính năng riêng của một người không hợp lệ — tải lại trang rồi thử lại.');
    if (seen.has(uid)) continue;
    seen.add(uid);
    const name = typeof p.name === 'string' ? p.name.replace(/\s+/g, ' ').trim().slice(0, MAX_PERSON_NAME) : '';
    people.push({ uid, name, features: p.features == null ? null : pick8(p.features) });
  }
  return { who: body.who, features: pick8(body.features), people };
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
 * @param {{ file: string, globalReplyOnlyTagged?: boolean | (() => boolean) }} opts
 *   globalReplyOnlyTagged — cờ ZALO_GROUP_REPLY_ONLY_TAGGED bot đang dùng (xem makeGlobalReplyOnlyTagged).
 *   Dùng để hiển thị khi tệp chưa ghi khoá này, và để ghi hạt giống `defaults.replyOnlyTagged` ở lần lưu đầu.
 */
export function createPermissionsStore({ file, globalReplyOnlyTagged = true, dmEnv = () => ({ legacyWho: 'owners', gatewayOpen: true }) }) {
  const globalFlag = () => (typeof globalReplyOnlyTagged === 'function' ? globalReplyOnlyTagged() : globalReplyOnlyTagged);
  const builtin = () => ({ active: true, replyOnlyTagged: globalFlag(), features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) });
  const merge = (base, l) => ({
    active: l.active ?? base.active,
    replyOnlyTagged: l.replyOnlyTagged ?? base.replyOnlyTagged,
    features: { ...base.features, ...(l.features || {}) },
  });

  /** `{ data, exists, corrupt }` — tệp hỏng thì data rỗng (bot cũng đang dùng mặc định), không đổi tên tệp. */
  function read() {
    if (!existsSync(file)) return { data: { version: 1, defaults: {}, groups: {} }, exists: false, corrupt: false };
    try {
      // Sửa tay bằng Notepad có thể để lại BOM; plugin đọc bằng utf-8-sig nên dashboard cũng bỏ BOM.
      return { data: normalize(JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))), exists: true, corrupt: false };
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

  /**
   * Lần lưu đầu tiên khi `defaults` chưa có cờ tag: ghi cờ thật của bot vào `defaults` một lần (hạt giống),
   * để từ đó cờ tag được so khác biệt như mọi khoá khác. Bản cũ từng ghi cờ tag vào từng nhóm — mục nhóm
   * nào ghi đúng bằng giá trị mặc định mới thì bỏ khoá đó (không đổi hành vi); mục chỉ còn tên thì xoá.
   * `next` = giá trị cờ tag của `defaults` sau lần lưu này (mặc định: cờ thật của bot).
   */
  function seedReplyOnlyTagged(data, next = globalFlag()) {
    if (data.defaults.replyOnlyTagged !== undefined) return;
    data.defaults.replyOnlyTagged = next;
    for (const [id, g] of Object.entries(data.groups)) {
      if (g.replyOnlyTagged !== next) continue;
      const { replyOnlyTagged: _drop, ...rest } = g;
      if (Object.keys(rest).some((k) => k !== 'name')) data.groups[id] = rest;
      else delete data.groups[id];
    }
  }

  /** Mục nhắn riêng đã gộp: chưa có trong tệp → `who` theo ZALO_DM_POLICY (`explicit: false`), mọi nút bật. */
  const dmView = (dm) => {
    const env = dmEnv();
    const features = { ...Object.fromEntries(DM_FEATURE_KEYS.map((k) => [k, true])), ...(dm?.features || {}) };
    const people = Object.entries(dm?.people || {}).map(([uid, p]) => ({
      uid, name: p.name || '', custom: Object.keys(p.features || {}).length > 0, features: { ...features, ...(p.features || {}) },
    }));
    return { who: dm?.who || env.legacyWho, explicit: Boolean(dm?.who), gatewayOpen: env.gatewayOpen, features, people };
  };

  const view = ({ data, exists, corrupt }) => {
    const defaults = merge(builtin(), data.defaults);
    const groups = Object.fromEntries(Object.entries(data.groups).map(([id, g]) => [id, { name: g.name || '', custom: true, ...merge(defaults, g) }]));
    return { exists, corrupt, defaults, groups, dm: dmView(data.dm) };
  };

  return {
    /** Trạng thái đã gộp cho giao diện: `{ exists, corrupt, defaults, groups: { id: { name, custom, active, replyOnlyTagged, features } } }`. */
    get() { return view(read()); },
    /** Lưu mặc định: ghi đủ mọi khoá (người dùng đã chọn từng nút). */
    setDefaults(settings) {
      const { data } = read();
      seedReplyOnlyTagged(data, settings.replyOnlyTagged);
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
      const prevName = data.groups[groupId]?.name;
      seedReplyOnlyTagged(data);
      const defaults = merge(builtin(), data.defaults);
      const entry = {};
      for (const k of SWITCHES) if (settings[k] !== defaults[k]) entry[k] = settings[k];
      const features = Object.fromEntries(FEATURE_KEYS.filter((k) => settings.features[k] !== defaults.features[k]).map((k) => [k, settings.features[k]]));
      if (Object.keys(features).length) entry.features = features;
      const changed = [...SWITCHES.filter((k) => settings[k] !== defaults[k]), ...Object.keys(features)];
      const cleanName = String(name || prevName || '').trim().slice(0, MAX_NAME);
      if (Object.keys(entry).length && !data.groups[groupId] && Object.keys(data.groups).length >= MAX_GROUPS) {
        throw new InvalidPermissions(`Đã có ${MAX_GROUPS} nhóm được chỉnh riêng, chưa thêm được nhóm nữa — đưa bớt nhóm về mặc định rồi thử lại.`);
      }
      if (Object.keys(entry).length) data.groups[groupId] = cleanName ? { name: cleanName, ...entry } : entry;
      else delete data.groups[groupId];
      write(data);
      return { state: view({ data, exists: true, corrupt: false }), changed };
    },
    /**
     * Lưu mục nhắn riêng (đã qua parseDm): `who` + đủ 8 nút chung; mỗi người chỉ ghi nút khác nút chung.
     * Tệp vẫn là phiên bản 1 — plugin/dashboard v1.21–1.22 bỏ qua khoá `dm` khi đọc.
     */
    setDm(settings) {
      const { data } = read();
      const people = {};
      for (const p of settings.people) {
        const diff = p.features ? Object.fromEntries(DM_FEATURE_KEYS.filter((k) => p.features[k] !== settings.features[k]).map((k) => [k, p.features[k]])) : {};
        people[p.uid] = { ...(p.name ? { name: p.name } : {}), ...(Object.keys(diff).length ? { features: diff } : {}) };
      }
      data.dm = { who: settings.who, features: { ...settings.features }, people };
      write(data);
      return view({ data, exists: true, corrupt: false });
    },
  };
}
