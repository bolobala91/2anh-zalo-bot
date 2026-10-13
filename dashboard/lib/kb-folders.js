/**
 * Thư mục của "Tài liệu tự tạo" (kho tri thức): chỉ là siêu dữ liệu của dashboard — tệp vẫn nằm phẳng trong
 * thư mục tải lên, bot đọc như cũ. Tệp JSON: `{ version: 1, folders: [{ id, name, color }], files: { "<rel>": "<id>" } }`.
 * `file` null → giữ trong bộ nhớ (dùng cho kiểm thử).
 */
import { randomBytes } from 'node:crypto';
import { readJson, writeJsonAtomic } from './json-store.js';
import { FOLDER_COLORS, FOLDER_ID, MAX_FOLDERS } from './permissions.js';

export const MAX_KB_FOLDER_NAME = 60;
const EMPTY = { version: 1, folders: [], files: {} };
const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const tidy = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** Đọc lỏng: bỏ thư mục sai/trùng/quá trần, bỏ gán vào thư mục không có. */
export function normalizeKbFolders(raw) {
  const folders = [];
  const ids = new Set();
  for (const f of Array.isArray(raw?.folders) ? raw.folders : []) {
    const id = String(f?.id ?? '');
    const name = tidy(f?.name).slice(0, MAX_KB_FOLDER_NAME);
    if (!FOLDER_ID.test(id) || ids.has(id) || !name || folders.length >= MAX_FOLDERS) continue;
    ids.add(id);
    folders.push({ id, name, color: FOLDER_COLORS.includes(f.color) ? f.color : 'gray' });
  }
  const files = {};
  if (isObj(raw?.files)) for (const [rel, id] of Object.entries(raw.files)) if (rel && ids.has(id)) files[rel] = id;
  return { version: 1, folders, files };
}

export function createKbFolders({ file = null } = {}) {
  let mem = structuredClone(EMPTY);
  const read = () => normalizeKbFolders(file ? readJson(file, EMPTY) : mem);
  const write = (d) => { if (file) writeJsonAtomic(file, d); else mem = structuredClone(d); };
  const find = (d, id) => {
    const f = d.folders.find((x) => x.id === String(id ?? ''));
    if (!f) throw err(400, 'Không thấy thư mục này — tải lại trang rồi thử lại.');
    return f;
  };
  function cleanName(d, raw, selfId = null) {
    const name = tidy(raw);
    if (!name) throw err(400, 'Đặt tên cho thư mục.');
    if (name.length > MAX_KB_FOLDER_NAME) throw err(400, `Tên thư mục tối đa ${MAX_KB_FOLDER_NAME} ký tự.`);
    const low = name.toLocaleLowerCase('vi');
    if (d.folders.some((f) => f.id !== selfId && f.name.toLocaleLowerCase('vi') === low)) throw err(409, 'Đã có thư mục trùng tên — chọn tên khác.');
    return name;
  }
  function cleanColor(c) {
    if (!FOLDER_COLORS.includes(c)) throw err(400, 'Màu không hợp lệ — chọn lại trong bảng màu.');
    return c;
  }
  return {
    get: read,
    /** Kiểm thư mục có thật (null/undefined = "Chưa xếp"). Trả thư mục hoặc null. */
    check(id) { return id == null ? null : find(read(), id); },
    /**
     * Danh sách cho giao diện: thư mục + thư mục của từng tài liệu đang có. Gán trỏ tới tệp đã mất (trong thư mục
     * tải lên hiện tại, `prefix`) được dọn khỏi tệp; gán ở nơi khác (đổi nguồn) giữ nguyên để đổi lại không mất.
     */
    view(paths, prefix) {
      const d = read();
      const have = new Set(paths);
      const stale = Object.keys(d.files).filter((rel) => !have.has(rel) && prefix && rel.startsWith(`${prefix}/`) && !rel.slice(prefix.length + 1).includes('/'));
      if (stale.length) { for (const rel of stale) delete d.files[rel]; write(d); }
      return { folders: d.folders, folderOf: (rel) => d.files[rel] ?? null };
    },
    create({ name, color } = {}) {
      const d = read();
      if (d.folders.length >= MAX_FOLDERS) throw err(400, `Tối đa ${MAX_FOLDERS} thư mục — xoá bớt rồi tạo mới.`);
      const clean = cleanName(d, name);
      const used = new Set(d.folders.map((f) => f.color));
      const c = color == null ? (FOLDER_COLORS.find((x) => !used.has(x)) || FOLDER_COLORS[d.folders.length % FOLDER_COLORS.length]) : cleanColor(color);
      let id;
      do { id = randomBytes(5).toString('hex').slice(0, 8); } while (d.folders.some((f) => f.id === id));
      const folder = { id, name: clean, color: c };
      d.folders.push(folder);
      write(d);
      return folder;
    },
    /** Đổi tên và/hoặc màu. Trả `{ before, after }`. */
    update(id, { name, color } = {}) {
      const d = read();
      const f = find(d, id);
      const before = { ...f };
      if (name != null) f.name = cleanName(d, name, f.id);
      if (color != null) f.color = cleanColor(color);
      write(d);
      return { before, after: { ...f } };
    },
    /** Xoá thư mục: tài liệu bên trong về "Chưa xếp" (không xoá tệp). Trả thư mục đã xoá. */
    remove(id) {
      const d = read();
      const f = find(d, id);
      d.folders = d.folders.filter((x) => x !== f);
      for (const [rel, fid] of Object.entries(d.files)) if (fid === f.id) delete d.files[rel];
      write(d);
      return f;
    },
    /** Xếp các tài liệu (đường tương đối đã kiểm) vào thư mục `id`, hoặc "Chưa xếp" khi null. */
    assign(rels, id) {
      const d = read();
      const f = id == null ? null : find(d, id);
      for (const rel of rels) { if (f) d.files[rel] = f.id; else delete d.files[rel]; }
      write(d);
      return f;
    },
    /** Tài liệu đổi tên → chuyển gán theo. */
    rename(from, to) {
      const d = read();
      if (from === to || !(from in d.files)) return;
      d.files[to] = d.files[from];
      delete d.files[from];
      write(d);
    },
    /** Tài liệu bị xoá → bỏ gán. */
    drop(rels) {
      const d = read();
      const hit = rels.filter((rel) => rel in d.files);
      if (!hit.length) return;
      for (const rel of hit) delete d.files[rel];
      write(d);
    },
  };
}
