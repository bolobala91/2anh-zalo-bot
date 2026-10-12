/**
 * Sổ người quen của bot (spec §18.5): `<HERMES_HOME>/zalo/people.json` do plugin ghi bằng công cụ
 * `zalo_remember_person` (people.py). Dashboard xem, sửa, xoá đúng định dạng đó:
 *   { "<uid>": { name, note, fields: {khoá: giá trị}, updated_at (giây), updated_by } }
 * Giới hạn khớp people.py (tên 80, ghi chú 400, 12 trường, khoá 40, giá trị 120). Plugin đọc tệp mỗi lần dùng
 * nên sửa là có hiệu lực ngay. Ghi: giữ `.bak`, tệp tạm tên riêng (plugin dùng `people.json.tmp`), và từ chối
 * (409) nếu tệp đã đổi kể từ lúc đọc — bot vừa ghi thì không bị dashboard đè mất.
 */
import { copyFileSync, chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import { writeFileAtomic } from './json-store.js';
import { ZALO_UID } from './users.js';

export const LIMITS = { name: 80, note: 400, fields: 12, key: 40, value: 120 };
/**
 * Nơi bot được dùng một mục chủ bot sửa trên dashboard: `all` = mọi nhóm và tin nhắn riêng (nơi dùng `"*"`),
 * `dm` = chỉ khi chính người đó nhắn riêng, `keep` = như cũ (nơi bot đã nghe — chỉ khi mục không đổi nội dung).
 */
export const USES = ['all', 'dm', 'keep'];
const useOf = (v) => (USES.includes(v) ? v : 'keep');

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
// eslint-disable-next-line no-control-regex
const clean = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/** Thân PUT: `{ name, note, fields: [{ key, value }] }` → hồ sơ đã kiểm hoặc lỗi 400 có bước tiếp theo. */
export function parsePerson(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (!b) throw err(400, 'Hồ sơ không hợp lệ — tải lại trang rồi thử lại.');
  const name = clean(b.name);
  const note = clean(b.note);
  if ([...name].length > LIMITS.name) throw err(400, `Tên tối đa ${LIMITS.name} ký tự — rút gọn rồi lưu.`);
  if ([...note].length > LIMITS.note) throw err(400, `Ghi chú tối đa ${LIMITS.note} ký tự — rút gọn rồi lưu.`);
  const list = Array.isArray(b.fields) ? b.fields : [];
  if (list.length > LIMITS.fields) throw err(400, `Tối đa ${LIMITS.fields} thông tin thêm — bỏ bớt rồi lưu.`);
  const fields = {};
  const uses = {};
  for (const f of list) {
    const key = clean(f?.key);
    const value = clean(f?.value);
    if (!key && !value) continue;
    if (!key) throw err(400, 'Có thông tin thêm chưa đặt tên mục — điền tên mục hoặc xoá dòng đó.');
    if ([...key].length > LIMITS.key || [...value].length > LIMITS.value) {
      throw err(400, `Tên mục tối đa ${LIMITS.key} ký tự, nội dung tối đa ${LIMITS.value} ký tự — rút gọn rồi lưu.`);
    }
    fields[key] = value;
    uses[key] = useOf(f?.use);
  }
  if (!name && !note && !Object.keys(fields).length) throw err(400, 'Hồ sơ trống — điền ít nhất tên hoặc ghi chú, hoặc bấm Xoá hồ sơ.');
  return { name, note, fields, uses, noteUse: useOf(b.noteUse) };
}

const stampOf = (file) => { try { const s = statSync(file); return `${s.mtimeMs}:${s.size}`; } catch { return 'none'; } };

/**
 * Nơi bot được dùng một mục hồ sơ (Sổ người quen theo nơi ghi — plugin people.py): ["g:<nhóm>", "u:<uid>"]; rỗng = mục
 * cũ/sửa trên dashboard → chỉ khi nhắn riêng với chính người đó. `key` null = ghi chú.
 */
function placesOf(p, key) {
  const sc = p?.scopes && typeof p.scopes === 'object' ? p.scopes : {};
  const list = key === null ? sc.note : (sc.fields && typeof sc.fields === 'object' ? sc.fields[key] : null);
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && (x === '*' || /^[gu]:\d{1,32}$/.test(x))) : [];
}

export function createPeopleStore({ file, now = Date.now }) {
  function load() {
    const stamp = stampOf(file);
    if (!existsSync(file)) return { data: {}, stamp };
    let data;
    try { data = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch {
      throw err(503, 'Sổ người quen đang hỏng nên chưa sửa được — báo người cài đặt kiểm tra tệp people.json.');
    }
    return { data: data && typeof data === 'object' && !Array.isArray(data) ? data : {}, stamp };
  }
  function save(data, stamp) {
    if (stampOf(file) !== stamp) throw err(409, 'Bot vừa cập nhật sổ người quen — tải lại trang rồi sửa lại.');
    if (existsSync(file)) {
      copyFileSync(file, `${file}.bak`);
      try { chmodSync(`${file}.bak`, 0o600); } catch { /* Windows */ }
    }
    writeFileAtomic(file, JSON.stringify(data, null, 2), { tmpName: 'people.json.dashboard-tmp' });
  }
  const view = (uid, p) => ({
    uid, name: clean(p?.name), note: clean(p?.note),
    fields: Object.entries(p?.fields && typeof p.fields === 'object' ? p.fields : {}).map(([key, value]) => ({ key: String(key), value: String(value ?? ''), places: placesOf(p, key) })),
    notePlaces: placesOf(p, null),
    updatedAt: Number.isFinite(p?.updated_at) ? p.updated_at * 1000 : null,
    updatedBy: String(p?.updated_by ?? ''),
  });
  /** Khách đã thấy hồ sơ ở mốc `expectedUpdatedAt` (null = chưa có); bot sửa sau đó thì mốc khác → 409. `undefined` = không kiểm. */
  function checkSeen(data, uid, expected) {
    if (expected === undefined) return;
    const stored = data[uid] && typeof data[uid] === 'object' ? view(uid, data[uid]).updatedAt : null;
    if ((expected ?? null) !== stored) throw err(409, 'Hồ sơ vừa được bot cập nhật — tải lại rồi sửa');
  }
  return {
    /** Mọi hồ sơ, mới sửa trước. Tệp hỏng → lỗi 503. */
    list() {
      const { data } = load();
      return Object.entries(data).filter(([, p]) => p && typeof p === 'object').map(([uid, p]) => view(uid, p))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    /** Thay cả hồ sơ của `uid` (tạo mới nếu chưa có). `by` = tên người dùng dashboard. */
    put(uid, person, by, { expectedUpdatedAt } = {}) {
      if (!ZALO_UID.test(String(uid))) throw err(400, 'UID Zalo không hợp lệ — chọn lại người trong danh sách.');
      const { data, stamp } = load();
      checkSeen(data, uid, expectedUpdatedAt);
      if (!data[uid] && Object.keys(data).length >= 5000) throw err(400, 'Sổ người quen đã đủ 5000 người — xoá bớt hồ sơ cũ trước.');
      const entry = { ...(data[uid] || {}) };
      // Nơi dùng từng mục (plugin, Sổ người quen theo nơi ghi) do chủ bot chọn: "Mọi nơi" → ["*"]; "Chỉ nhắn riêng" →
      // không ghi nơi; "Như cũ" → giữ nơi bot đã nghe, nhưng chỉ khi mục không đổi nội dung (không đẩy giá trị mới sang
      // nhóm cũ) — đổi nội dung mà vẫn "như cũ" thì như "Chỉ nhắn riêng".
      const oldFields = entry.fields && typeof entry.fields === 'object' ? entry.fields : {};
      const oldScopes = entry.scopes && typeof entry.scopes === 'object' ? entry.scopes : {};
      const oldFieldScopes = oldScopes.fields && typeof oldScopes.fields === 'object' ? oldScopes.fields : {};
      const placesFor = (use, same, old) => (use === 'all' ? ['*'] : use === 'keep' && same && Array.isArray(old) ? old : null);
      const scopes = { fields: {} };
      for (const [k, v] of Object.entries(person.fields)) {
        const same = Object.hasOwn(oldFields, k) && clean(String(oldFields[k])) === v;
        const places = placesFor(person.uses?.[k] ?? 'keep', same, oldFieldScopes[k]);
        if (places) scopes.fields[k] = places;
      }
      const notePlaces = person.note ? placesFor(person.noteUse ?? 'keep', person.note === clean(entry.note), oldScopes.note) : null;
      if (notePlaces) scopes.note = notePlaces;
      entry.scopes = scopes;
      for (const k of ['name', 'note']) { if (person[k]) entry[k] = person[k]; else delete entry[k]; }
      if (Object.keys(person.fields).length) entry.fields = person.fields; else delete entry.fields;
      entry.updated_at = Math.floor(now() / 1000);
      entry.updated_by = `dashboard:${by}`;
      data[uid] = entry;
      save(data, stamp);
      return view(uid, entry);
    },
    /** Xoá hồ sơ; trả false nếu không có. */
    remove(uid, { expectedUpdatedAt } = {}) {
      const { data, stamp } = load();
      if (!Object.hasOwn(data, uid)) return false;
      checkSeen(data, uid, expectedUpdatedAt);
      delete data[uid];
      save(data, stamp);
      return true;
    },
  };
}
