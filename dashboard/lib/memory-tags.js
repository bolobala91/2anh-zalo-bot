/**
 * Thẻ phân loại bộ nhớ trợ lý (Trí nhớ › Bộ nhớ của trợ lý) — cùng định dạng với plugin zalo_tools/memory_tags.py.
 * Thẻ nằm đầu mục: "[Dịch vụ & giá] Gói VIP 1 triệu." Danh sách loại: `<HERMES_HOME>/zalo/memory-tags.json`.
 * "Sắp xếp lại bằng AI" đi qua hàng đợi tệp `<HERMES_HOME>/zalo/memory-organize/` (plugin giữ khoá AI và trần lượt):
 * dashboard ghi yêu cầu, plugin trả đề xuất trước/sau, chủ bot duyệt thì dashboard mới ghi. Mục bot tự tách/gắn thẻ
 * được plugin ghi vào `log.json` để hoàn tác.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJsonAtomic } from './json-store.js';

export const COLORS = ['blue', 'indigo', 'green', 'teal', 'pink', 'orange', 'purple', 'red', 'gray'];
export const DEFAULT_TAGS = [
  { label: 'Về chủ nhân', color: 'blue' },
  { label: 'Công việc & vai trò', color: 'indigo' },
  { label: 'Dịch vụ & giá', color: 'green' },
  { label: 'Link & kênh', color: 'teal' },
  { label: 'Người quen', color: 'pink' },
  { label: 'Cách làm việc', color: 'orange' },
  { label: 'Khác', color: 'gray' },
];
export const FALLBACK_TAG = 'Khác';
export const MAX_TAGS = 20;
const TAG_RE = /^\[([^[\]\n]{1,30})\]\s+/;
const LABEL_OK = /^[^[\]\n§]{1,30}$/;
export const REQUEST_ID = /^[0-9a-f]{16}$/;
export const PENDING_TIMEOUT_MS = 4 * 60_000;
const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const norm = (s) => String(s ?? '').split(/\s+/).filter(Boolean).join(' ');

/** "[Loại] nội dung" → { tag, text }; không có thẻ → tag null. */
export function splitTag(entry) {
  const m = TAG_RE.exec(String(entry ?? ''));
  return m ? { tag: m[1].trim(), text: entry.slice(m[0].length) } : { tag: null, text: String(entry ?? '') };
}
export const withTag = (tag, text) => (tag ? `[${tag}] ${String(text).trim()}` : String(text).trim());

/** Chuẩn hoá danh sách loại (giống load_tags của plugin): bỏ trùng/sai, luôn có "Khác". `strict` → ném 400. */
export function normalizeTags(raw, { strict = false } = {}) {
  const out = [];
  for (const t of Array.isArray(raw) ? raw : DEFAULT_TAGS) {
    const label = norm(t?.label);
    if (!LABEL_OK.test(label)) { if (strict) throw err(400, 'Tên loại 1–30 ký tự, không có dấu [ ] hay §.'); continue; }
    if (out.some((x) => x.label === label)) { if (strict) throw err(400, `Loại "${label}" bị trùng.`); continue; }
    out.push({ label, color: COLORS.includes(t?.color) ? t.color : 'gray' });
  }
  if (strict && out.length > MAX_TAGS) throw err(400, `Tối đa ${MAX_TAGS} loại.`);
  if (!out.length) out.push(...DEFAULT_TAGS.map((t) => ({ ...t })));
  if (!out.some((t) => t.label === FALLBACK_TAG)) out.push({ label: FALLBACK_TAG, color: 'gray' });
  return out.slice(0, MAX_TAGS);
}

export function createMemoryTags({ hermesHome, agentMemory, now = Date.now, newId = () => randomBytes(8).toString('hex') }) {
  const tagsFile = join(hermesHome, 'zalo', 'memory-tags.json');
  const dir = join(hermesHome, 'zalo', 'memory-organize');
  const reqDir = join(dir, 'requests');
  const resDir = join(dir, 'results');
  const logFile = join(dir, 'log.json');
  const age = (f) => { try { return now() - statSync(f).mtimeMs; } catch { return Infinity; } };
  const list = (d) => { try { return readdirSync(d); } catch { return []; } };
  const tags = () => normalizeTags(readJson(tagsFile, {})?.tags);
  const readLog = () => { const l = readJson(logFile, []); return Array.isArray(l) ? l : []; };

  return {
    tags,
    /** Lưu danh sách loại; `renames` { cũ: mới } đổi luôn thẻ trong cả hai tệp bộ nhớ. Loại bị xoá → mục về "Khác". */
    saveTags(next, renames = {}) {
      const clean = normalizeTags(next, { strict: true });
      const labels = new Set(clean.map((t) => t.label));
      const map = Object.fromEntries(Object.entries(renames || {}).map(([a, b]) => [norm(a), norm(b)]).filter(([a, b]) => a && labels.has(b)));
      for (const target of ['user', 'memory']) {
        const before = agentMemory.entries(target);
        const after = before.map((e) => {
          const { tag, text } = splitTag(e);
          if (!tag) return e;
          const to = map[tag] || tag;
          return withTag(labels.has(to) ? to : FALLBACK_TAG, text);
        });
        if (JSON.stringify(after) !== JSON.stringify(before)) agentMemory.setEntries(target, before, after, { allowOver: true });
      }
      writeJsonAtomic(tagsFile, { version: 1, tags: clean });
      return clean;
    },
    /** Xin AI sắp xếp: mode "propose" (xem trước, chưa ghi) hoặc "auto" (mục chưa có thẻ, plugin ghi luôn). */
    request(target, mode, by) {
      for (const f of list(reqDir)) if (f.endsWith('.json') && age(join(reqDir, f)) > PENDING_TIMEOUT_MS) rmSync(join(reqDir, f), { force: true });
      if (mode === 'propose' && list(reqDir).some((f) => {
        try { return JSON.parse(readFileSync(join(reqDir, f), 'utf8')).mode === 'propose' && age(join(reqDir, f)) <= PENDING_TIMEOUT_MS; } catch { return false; }
      })) throw err(409, 'Đang sắp xếp — đợi xong rồi bấm lại.');
      const id = newId();
      writeJsonAtomic(join(reqDir, `${id}.json`), { v: 1, id, target, mode, by: String(by).slice(0, 40), createdAt: now() });
      return id;
    },
    result(id) {
      if (!REQUEST_ID.test(String(id))) throw err(400, 'Mã yêu cầu không hợp lệ — bấm lại.');
      const res = join(resDir, `${id}.json`);
      if (existsSync(res)) {
        try { return { status: 'done', result: JSON.parse(readFileSync(res, 'utf8')) }; } catch { return { status: 'done', result: { ok: false, error: 'Kết quả hỏng — bấm lại.' } }; }
      }
      const req = [join(reqDir, `${id}.json`), join(reqDir, `${id}.json.claimed`)].find((f) => existsSync(f));
      if (req) return age(req) > PENDING_TIMEOUT_MS ? { status: 'timeout' } : { status: 'pending' };
      throw err(404, 'Không thấy yêu cầu này — bấm lại.');
    },
    /** Ghi đề xuất đã duyệt — chỉ khi bộ nhớ vẫn đúng như lúc AI đọc. */
    apply(id) {
      const { status, result } = this.result(id);
      if (status !== 'done' || !result?.ok || result.mode !== 'propose') throw err(400, 'Đề xuất chưa sẵn sàng — bấm Sắp xếp lại.');
      if (result.overLimit) throw err(400, 'Bản sắp xếp vượt dung lượng bộ nhớ — xoá bớt mục rồi thử lại.');
      agentMemory.setEntries(result.target, result.before, result.after);
      const entry = { id, at: now(), target: result.target, by: 'dashboard',
        before: result.before.filter((e) => !result.after.includes(e)), after: result.after.filter((e) => !result.before.includes(e)) };
      writeJsonAtomic(logFile, [...readLog(), entry].slice(-30));
      return result.target;
    },
    /** Lịch sử tự sắp xếp, mới nhất trước. */
    log() { return readLog().slice().reverse().map((x) => ({ id: x.id, at: x.at, target: x.target, by: x.by, before: x.before || [], after: x.after || [], undone: Boolean(x.undone) })); },
    /** Hoàn tác một lần sắp xếp: mục "sau" còn nguyên thì thay lại bằng mục "trước" (ở chỗ mục đầu tiên). */
    undo(id) {
      const all = readLog();
      const x = all.find((r) => r.id === id);
      if (!x || x.undone) throw err(404, 'Không còn mục này để hoàn tác — tải lại trang.');
      const current = agentMemory.entries(x.target);
      const after = x.after || [];
      if (!after.every((e) => current.includes(e))) throw err(409, 'Các thẻ này đã bị sửa sau đó — sửa tay trong danh sách.');
      const at = Math.min(...after.map((e) => current.indexOf(e)).filter((i) => i >= 0), current.length);
      const kept = current.filter((e) => !after.includes(e));
      const next = [...kept.slice(0, at), ...(x.before || []), ...kept.slice(at)];
      agentMemory.setEntries(x.target, current, next, { allowOver: true });
      x.undone = true;
      writeJsonAtomic(logFile, all);
      return x.target;
    },
  };
}
