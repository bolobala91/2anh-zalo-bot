/**
 * Phong cách trả lời (Cấu hình › Phong cách trả lời) — CÀI ĐẶT, không phải trí nhớ của bot.
 * Tệp `<HERMES_HOME>/zalo/reply-style.json`; plugin hermes-plugin/zalo_tools/reply_style.py đọc lại khi đổi và
 * đính tóm tắt vào mỗi lượt, nên sửa là có hiệu lực ngay. Hai bên phải khớp giới hạn dưới đây.
 */
import { readJson, writeJsonAtomic } from './json-store.js';

export const COLORS = ['red', 'green', 'orange', 'yellow'];
export const CHOICES = {
  tone: ['friendly', 'playful', 'formal'],
  length: ['short', 'medium', 'detailed'],
  emoji: ['none', 'few', 'many'],
  color_level: ['none', 'few', 'normal'],
  file_name: ['name_time', 'name_date', 'name'],
};
export const TEXT_LIMITS = { self_name: 20, owner_name: 30, others_name: 30, extra: 500 };
export const DEFAULTS = Object.freeze({
  self_name: 'em', owner_name: 'anh/chị', others_name: 'anh/chị', tone: 'friendly', length: 'medium', emoji: 'few',
  colors: [...COLORS], color_level: 'normal', file_name: 'name_time', extra: '', auto_lookup: true,
});

const bad = (message) => Object.assign(new Error(message), { statusCode: 400 });
// eslint-disable-next-line no-control-regex
const clean = (v) => String(v ?? '').normalize('NFC').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();

/** Chuẩn hoá; `strict` → giá trị sai ném lỗi 400 (khi lưu), không thì về mặc định (khi đọc). */
export function normalizeStyle(raw, { strict = false } = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...DEFAULTS, colors: [...DEFAULTS.colors] };
  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    if (!(key in src)) continue;
    const text = clean(src[key]);
    if (strict && text.length > limit) throw bad(`Mục "${key}" dài quá ${limit} ký tự.`);
    const cut = text.slice(0, limit).trim();
    out[key] = cut || key === 'extra' ? cut : DEFAULTS[key];
  }
  for (const [key, allowed] of Object.entries(CHOICES)) {
    if (!(key in src)) continue;
    if (allowed.includes(src[key])) out[key] = src[key];
    else if (strict) throw bad(`Giá trị "${key}" không hợp lệ.`);
  }
  if ('auto_lookup' in src) {
    if (typeof src.auto_lookup === 'boolean') out.auto_lookup = src.auto_lookup;
    else if (strict) throw bad('Tự tra cứu chỉ nhận bật/tắt.');
  }
  if ('colors' in src) {
    const picked = Array.isArray(src.colors) ? src.colors : null;
    if (strict && (!picked || picked.some((c) => !COLORS.includes(c)))) throw bad('Màu chỉ gồm đỏ, xanh, cam, vàng.');
    out.colors = COLORS.filter((c) => (picked || []).includes(c));
  }
  return out;
}

export function createReplyStyle({ file }) {
  return {
    view: () => normalizeStyle(readJson(file, {})),
    save(values) {
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw bad('Thiếu cài đặt cần lưu.');
      const unknown = Object.keys(values).filter((k) => !(k in DEFAULTS));
      if (unknown.length) throw bad(`Không có cài đặt: ${unknown.join(', ')}.`);
      const before = normalizeStyle(readJson(file, {}));
      const next = normalizeStyle({ ...before, ...values }, { strict: true });
      writeJsonAtomic(file, next);
      return { before, after: next };
    },
  };
}
