/**
 * Bộ nhớ của trợ lý Hermes (spec §18.5, chỉ Quản trị): `<HERMES_HOME>/memories/MEMORY.md` (ghi chú của trợ lý) và
 * `USER.md` (hồ sơ chủ nhân). Định dạng của Hermes (`tools/memory_tool.py`): các mục nối bằng "\n§\n", mỗi tệp có
 * trần ký tự `memory.memory_char_limit` (2200) / `memory.user_char_limit` (1375) trong config.yaml.
 * Hermes đọc lại tệp dưới khoá riêng trước mỗi lần ghi, nên dashboard ghi đúng định dạng (nối lại bằng "\n§\n") là
 * không làm hỏng; vẫn từ chối (409) khi tệp đã đổi kể từ lúc đọc hoặc mục không còn như người dùng thấy.
 * Trợ lý chụp bộ nhớ vào lời nhắc hệ thống khi mở phiên — sửa ở đây có hiệu lực từ phiên mới.
 */
import { chmodSync, copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { writeFileAtomic } from './json-store.js';

/** Đếm theo ký tự Unicode (code point) như `len()` của Python bên Hermes, không theo UTF-16. */
const chars = (s) => [...s].length;

export const DELIMITER = '\n§\n';
/** Trần số mục mỗi lần xoá/gắn thẻ hàng loạt. */
export const MAX_BULK = 500;
export const TARGETS = {
  memory: { file: 'MEMORY.md', key: 'memory_char_limit', fallback: 2200, label: 'Ghi chú của trợ lý' },
  user: { file: 'USER.md', key: 'user_char_limit', fallback: 1375, label: 'Hồ sơ chủ nhân' },
};

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const stampOf = (f) => { try { const s = statSync(f); return `${s.mtimeMs}:${s.size}`; } catch { return 'none'; } };

/** Như `MemoryStore._parse_entries`: tách theo "\n§\n", bỏ khoảng trắng hai đầu, bỏ mục rỗng. */
export function parseEntries(raw) {
  const text = String(raw ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!text.trim()) return [];
  return text.split(DELIMITER).map((e) => e.trim()).filter(Boolean);
}

export function createHermesMemory({ hermesHome, configFile }) {
  const dir = join(hermesHome, 'memories');
  function limit(target) {
    const t = TARGETS[target];
    try {
      const n = YAML.parse(readFileSync(configFile, 'utf8'))?.memory?.[t.key];
      if (Number.isInteger(n) && n > 0) return n;
    } catch { /* không có config: dùng mặc định của Hermes */ }
    return t.fallback;
  }
  function load(target) {
    const t = Object.hasOwn(TARGETS, target) ? TARGETS[target] : null;
    if (!t) throw err(400, 'Không có mục bộ nhớ này — tải lại trang.');
    const file = join(dir, t.file);
    const stamp = stampOf(file);
    const entries = existsSync(file) ? parseEntries(readFileSync(file, 'utf8')) : [];
    return { file, stamp, entries };
  }
  function save(target, file, stamp, entries, { allowOver = false } = {}) {
    if (stampOf(file) !== stamp) throw err(409, 'Trợ lý vừa cập nhật bộ nhớ — tải lại trang rồi sửa lại.');
    const content = entries.join(DELIMITER);
    // Xoá luôn được, kể cả khi tệp đã vượt trần (do bot/Hermes ghi) — nếu không người dùng không dọn được.
    if (!allowOver && chars(content) > limit(target)) throw err(400, `Bộ nhớ sẽ vượt ${limit(target)} ký tự — rút gọn hoặc xoá bớt mục khác.`);
    if (existsSync(file)) {
      copyFileSync(file, `${file}.bak`);
      try { chmodSync(`${file}.bak`, 0o600); } catch { /* Windows */ }
    }
    writeFileAtomic(file, content, { tmpName: `${TARGETS[target].file}.dashboard-tmp` });
  }
  function checkEntry(entries, index, old) {
    if (!Number.isInteger(index) || index < 0 || index >= entries.length || entries[index] !== String(old ?? '')) {
      throw err(409, 'Mục này đã đổi hoặc không còn — tải lại trang rồi thử lại.');
    }
  }
  /** Kiểm từng mục đã chọn còn đúng như người dùng thấy, không trùng; trả Set chỉ số. */
  function checkPicks(entries, picks) {
    if (!Array.isArray(picks) || !picks.length) throw err(400, 'Chưa chọn mục nào.');
    if (picks.length > MAX_BULK) throw err(400, `Tối đa ${MAX_BULK} mục mỗi lần.`);
    const idx = new Set();
    for (const p of picks) {
      checkEntry(entries, p?.index, p?.old);
      if (idx.has(p.index)) throw err(400, 'Danh sách chọn bị trùng — tải lại trang.');
      idx.add(p.index);
    }
    return idx;
  }
  return {
    view() {
      return Object.fromEntries(Object.entries(TARGETS).map(([target, t]) => {
        const { entries } = load(target);
        return [target, { label: t.label, entries, used: chars(entries.join(DELIMITER)), limit: limit(target) }];
      }));
    },
    replace(target, index, old, text) {
      const next = String(text ?? '').replace(/\r\n/g, '\n').trim();
      if (!next) throw err(400, 'Nội dung trống — nhập nội dung hoặc bấm Xoá mục.');
      if (next.includes(DELIMITER) || /^§$/m.test(next)) throw err(400, 'Nội dung không được có dòng chỉ gồm dấu § — bỏ dòng đó rồi lưu.');
      const { file, stamp, entries } = load(target);
      checkEntry(entries, index, old);
      entries[index] = next;
      save(target, file, stamp, entries);
    },
    /** Thêm một mục mới (cuối danh sách), cùng luật như sửa. */
    add(target, text) {
      const next = String(text ?? '').replace(/\r\n/g, '\n').trim();
      if (!next) throw err(400, 'Nội dung trống — gõ điều trợ lý cần nhớ.');
      if (next.includes(DELIMITER) || /^§$/m.test(next)) throw err(400, 'Nội dung không được có dòng chỉ gồm dấu § — bỏ dòng đó rồi lưu.');
      const { file, stamp, entries } = load(target);
      if (entries.includes(next)) throw err(409, 'Trợ lý đã nhớ đúng điều này rồi.');
      save(target, file, stamp, [...entries, next]);
    },
    /** Danh sách mục hiện tại của một tệp. */
    entries(target) { return load(target).entries; },
    /** Thay cả danh sách — chỉ khi danh sách hiện tại đúng bằng `expected` (người dùng đã xem bản đó), không thì 409. */
    setEntries(target, expected, next, { allowOver = false } = {}) {
      const { file, stamp, entries } = load(target);
      if (JSON.stringify(entries) !== JSON.stringify(expected)) throw err(409, 'Bộ nhớ vừa đổi — tải lại trang rồi thử lại.');
      const clean = next.map((e) => String(e ?? '').replace(/\r\n/g, '\n').trim()).filter(Boolean);
      if (clean.some((e) => e.includes(DELIMITER) || /^§$/m.test(e))) throw err(400, 'Nội dung không được có dòng chỉ gồm dấu §.');
      save(target, file, stamp, clean, { allowOver });
    },
    remove(target, index, old) {
      const { file, stamp, entries } = load(target);
      checkEntry(entries, index, old);
      entries.splice(index, 1);
      save(target, file, stamp, entries, { allowOver: true });
    },
    /** Xoá nhiều mục `[{ index, old }]` trong MỘT lần đọc–ghi; một mục lệch → 409, không xoá gì. */
    removeMany(target, picks) {
      const { file, stamp, entries } = load(target);
      const drop = checkPicks(entries, picks);
      save(target, file, stamp, entries.filter((_, i) => !drop.has(i)), { allowOver: true });
      return drop.size;
    },
    /** Sửa nhiều mục bằng `edit(old) → mới` trong MỘT lần ghi (gắn cùng một thẻ…); một mục lệch → 409. */
    editMany(target, picks, edit) {
      const { file, stamp, entries } = load(target);
      const idx = checkPicks(entries, picks);
      const next = entries.map((e, i) => (idx.has(i) ? String(edit(e) ?? '').replace(/\r\n/g, '\n').trim() : e));
      if (next.some((e, i) => idx.has(i) && (!e || e.includes(DELIMITER) || /^§$/m.test(e)))) throw err(400, 'Nội dung không được có dòng chỉ gồm dấu §.');
      save(target, file, stamp, next);
      return idx.size;
    },
  };
}
