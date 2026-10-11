/**
 * Từ khoá CHỦ NHÂN gọi bot trong nhóm không cần tag (plugin: hermes-plugin/zalo/call_words.py — hai bên phải khớp).
 * Tệp `<HERMES_HOME>/zalo/call-words.json`: { version: 1, owner: [{ text, at: 'start' | 'any' }] }.
 * Chưa có tệp → plugin dùng mặc định dựng từ tên bot; dashboard hiện đúng danh sách đó (defaultWords).
 */
import { existsSync, rmSync } from 'node:fs';
import { readJson, writeJsonAtomic } from './json-store.js';

export const MAX_WORDS = 50;
export const MAX_LEN = 40;
const PATTERNS = ['{} ơi', '{} oi', 'chào {}', 'chao {}', '{} đâu', '{} dau', 'nhờ {}', 'nho {}'];
const bad = (message) => Object.assign(new Error(message), { statusCode: 400 });
const norm = (t) => String(t ?? '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');

/** Mặc định theo tên bot (giống default_words của plugin). */
export function defaultWords(displayName) {
  const name = norm(displayName);
  if (!name) return [];
  const names = [name];
  if (name.includes(' ')) { const short = name.split(' ').pop(); if (short.length >= 2) names.push(short); }
  const out = [];
  for (const n of names) {
    out.push({ text: n, at: 'start' });
    for (const p of PATTERNS) out.push({ text: p.replace('{}', n), at: 'any' });
  }
  const seen = new Set();
  return out.filter((w) => { const k = `${w.at}\u0000${w.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Kiểm + chuẩn hoá danh sách gửi lên. */
export function parseWords(list) {
  if (!Array.isArray(list) || list.length > MAX_WORDS) throw bad(`Tối đa ${MAX_WORDS} từ khoá.`);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const text = norm(item?.text);
    const at = item?.at === 'start' ? 'start' : item?.at === 'any' ? 'any' : null;
    if (!at) throw bad('Kiểu từ khoá không hợp lệ.');
    if (!text || text.length > MAX_LEN || /[\u0000-\u001f\u007f]/.test(text)) throw bad(`Từ khoá phải từ 1 đến ${MAX_LEN} ký tự.`);
    const k = `${at}\u0000${text}`;
    if (!seen.has(k)) { seen.add(k); out.push({ text, at }); }
  }
  return out;
}

export function createCallWords({ file }) {
  return {
    /** { words, custom } — custom = đang dùng danh sách đã sửa trên dashboard. */
    view(displayName) {
      const saved = existsSync(file) ? readJson(file, null) : null;
      const custom = Boolean(saved && Array.isArray(saved.owner));
      let words = defaultWords(displayName);
      if (custom) { try { words = parseWords(saved.owner.slice(0, MAX_WORDS)); } catch { words = defaultWords(displayName); } }
      return { words, custom, defaults: defaultWords(displayName) };
    },
    save(list) {
      const words = parseWords(list);
      writeJsonAtomic(file, { version: 1, owner: words });
      return words;
    },
    reset() { rmSync(file, { force: true }); },
  };
}
