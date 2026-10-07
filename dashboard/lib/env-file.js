// Đọc/sửa .env của Hermes (spec §11.5): chỉ khoá trong danh sách cho phép, chỉ sửa dòng của khoá đó,
// giữ bản trước ở .env.bak, ghi tệp tạm rồi đổi tên. Không bao giờ trả về giá trị của khoá khác.
import { chmodSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { writeFileAtomic } from './json-store.js';

export const EDITABLE_KEYS = new Set(['ZALO_ALLOWED_USERS']);

function allowed(key) {
  if (!EDITABLE_KEYS.has(key)) throw new Error(`env-file: khoá ${key} không nằm trong danh sách được phép`);
}

const lineOf = (key) => new RegExp(`^(\\s*(?:export\\s+)?)${key}\\s*=.*$`);

/** Giá trị của `key` như Hermes/Node đọc (dòng sau cùng thắng), hoặc null khi tệp/khoá không có. */
export function readEnvKey(file, key) {
  allowed(key);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const mine = text.split(/\r?\n/).filter((l) => lineOf(key).test(l)).join('\n');
  if (!mine) return null;
  try { return parseEnv(mine)[key] ?? null; } catch { return null; }
}

/**
 * Đặt `key=value`: thay mọi dòng của khoá này (giữ "export " và kiểu xuống dòng của tệp), không có thì thêm cuối tệp.
 * `value` chỉ được chứa chữ số và dấu phẩy — không bao giờ chèn được dòng hay khoá khác.
 */
export function writeEnvKey(file, key, value) {
  allowed(key);
  if (!/^[0-9,]*$/.test(value)) throw new Error('env-file: giá trị chỉ được gồm chữ số và dấu phẩy');
  const exists = existsSync(file);
  const raw = exists ? readFileSync(file, 'utf8') : '';
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  const text = raw.slice(bom.length);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  let found = false;
  const out = lines.map((l) => {
    const m = lineOf(key).exec(l);
    if (!m) return l;
    found = true;
    return `${m[1]}${key}=${value}`;
  });
  if (!found) {
    if (out.length && out[out.length - 1] === '') out.pop();
    out.push(`${key}=${value}`, '');
  }
  if (exists) {
    copyFileSync(file, `${file}.bak`);
    try { chmodSync(`${file}.bak`, 0o600); } catch { /* Windows */ }
  }
  writeFileAtomic(file, bom + out.join(eol));
}
