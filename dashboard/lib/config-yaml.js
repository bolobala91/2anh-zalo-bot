/**
 * Sửa config.yaml của Hermes theo từng dòng (spec §18.6): như lệnh /model của plugin (model_command.py), không dump
 * lại cả tệp — giữ nguyên chú thích, thứ tự khoá, khối chữ nhiều dòng anh viết tay. Mỗi lần sửa:
 *   1. tìm đúng khoá theo đường dẫn (vd. ['platforms','zalo','extra','reply_only_tagged']) bằng thụt lề;
 *   2. thay cả vùng giá trị của khoá (một dòng, hoặc khối con/danh sách bên dưới) bằng MỘT dòng mới;
 *      khoá chưa có thì chèn vào cuối khối cha (khối cha phải có sẵn, trừ vài đường dẫn cho phép tạo khối cha cấp 1);
 *   3. phân tích lại cả tệp: kết quả phải BẰNG bản cũ với đúng các khoá đã sửa — khác một chút là từ chối, giữ tệp cũ.
 * Ghi: theo symlink, giữ quyền + chủ sở hữu, `.bak`, tệp tạm rồi đổi tên; tệp bị tiến trình khác (lệnh /model) ghi
 * chen giữa lúc đọc và lúc đổi tên → 409, giữ bản của tiến trình kia.
 */
import { chmodSync, chownSync, copyFileSync, existsSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import YAML from 'yaml';
import { writeFileAtomic } from './json-store.js';

const err = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
// Chuỗi để trần được: không bắt đầu bằng ký tự chỉ thị YAML (@ - : …), không kết thúc bằng ":".
const PLAIN = /^[A-Za-z0-9._/][A-Za-z0-9._/@:+-]*$/;
// Gồm cả các chuỗi YAML 1.1 mơ hồ (ngày, 0b/0o/0x, sáu mươi phân như 1:30, .inf/.nan): bộ đọc khác có thể hiểu thành số/ngày.
const RESERVED = /^(true|false|yes|no|on|off|null|~|[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?|0x[0-9a-f_]+|0b[01_]+|0o[0-7_]+|\d{4}-\d{2}-\d{2}.*|[-+]?\d[\d_]*(:[0-5]?\d)+(\.\d*)?|[-+]?\.inf|\.nan)$/i;
// Đường dẫn được phép TẠO khối cha cấp 1 khi config.yaml chưa có (vd. VPS chưa có mục `agent:`).
const CREATABLE_PARENT = new Set(['agent.reasoning_effort', 'image_gen.provider', 'video_gen.provider']);

/** Giá trị → chữ YAML một dòng: chuỗi thường để trần, còn lại JSON (hợp lệ trong YAML); mảng thành [..]. */
export function renderScalar(v) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) return `[${v.map((x) => renderScalar(x)).join(', ')}]`;
  if (typeof v === 'string') return PLAIN.test(v) && !v.endsWith(':') && !RESERVED.test(v) ? v : JSON.stringify(v);
  throw err('Giá trị không hợp lệ.');
}

const indentOf = (line) => line.length - line.trimStart().length;
const isBlank = (line) => !line.trim() || line.trimStart().startsWith('#');
const keyRe = (key) => new RegExp(`^(\\s*)(${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|"${key}"|'${key}'):(\\s|$)`);

/** Dòng cuối (không gồm) của vùng giá trị bắt đầu ở dòng `i` có thụt lề `ind`. */
function regionEnd(lines, i, ind) {
  let j = i + 1;
  for (; j < lines.length; j += 1) {
    const l = lines[j];
    if (isBlank(l)) continue;
    const n = indentOf(l);
    if (n > ind || (n === ind && l.trimStart().startsWith('- '))) continue;
    break;
  }
  while (j > i + 1 && isBlank(lines[j - 1])) j -= 1;   // không nuốt dòng trống/chú thích cuối khối
  return j;
}

/** Tìm khoá theo đường dẫn: `{ index, indent }` của dòng khoá, hoặc `{ parent }` khi chỉ thiếu khoá cuối. */
function locate(lines, path) {
  let from = 0; let to = lines.length; let parentIndent = -1; let parentIndex = -1;
  for (let depth = 0; depth < path.length; depth += 1) {
    let found = -1; let childIndent = null;
    for (let i = from; i < to; i += 1) {
      if (isBlank(lines[i])) continue;
      const n = indentOf(lines[i]);
      if (n <= parentIndent) break;
      if (childIndent === null) childIndent = n;
      if (n !== childIndent) continue;
      if (keyRe(path[depth]).test(lines[i])) { found = i; break; }
    }
    if (found === -1) {
      if (depth === path.length - 1 && parentIndex >= -1) return { missing: true, parentIndex, parentIndent, childIndent, end: to };
      return null;
    }
    if (depth === path.length - 1) return { index: found, indent: indentOf(lines[found]) };
    parentIndex = found; parentIndent = indentOf(lines[found]);
    from = found + 1; to = regionEnd(lines, found, parentIndent);
  }
  return null;
}

/** Bản sao sâu KHÔNG chia sẻ nút (bí danh YAML `*a` trả cùng một object — structuredClone giữ nguyên sự chia sẻ đó). */
const plain = (v) => (Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);

function setIn(obj, path, value) {
  let o = obj;
  for (const k of path.slice(0, -1)) {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[path.at(-1)] = value;
}

/** Áp `edits` = [{ path: string[], value }] vào chữ YAML; trả chữ mới hoặc ném lỗi 400 (không bao giờ trả chữ sai). */
export function applyYamlEdits(text, edits) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let before;
  try { before = YAML.parse(text) ?? {}; } catch { throw err('config.yaml đang lỗi cú pháp — sửa tay trước rồi thử lại.'); }
  const expected = plain(before);
  for (const { path, value } of edits) {
    const at = locate(lines, path);
    const key = path.at(-1);
    if (!at && path.length === 2 && CREATABLE_PARENT.has(path.join('.')) && locate(lines, [path[0]])?.missing) {
      const at0 = lines.length && lines.at(-1) === '' ? lines.length - 1 : lines.length;
      lines.splice(at0, 0, `${path[0]}:`, `  ${key}: ${renderScalar(value)}`);
      setIn(expected, path, value);
      continue;
    }
    if (!at) throw err(`Không tìm thấy mục ${path.slice(0, -1).join('.')} trong config.yaml — báo người cài đặt.`);
    if (at.missing) {
      if (at.parentIndex < 0 && path.length > 1) throw err(`Không tìm thấy mục ${path.slice(0, -1).join('.')} trong config.yaml.`);
      const ind = at.childIndent ?? (at.parentIndent + 2);
      lines.splice(at.end, 0, `${' '.repeat(Math.max(0, ind))}${key}: ${renderScalar(value)}`);
    } else {
      const end = regionEnd(lines, at.index, at.indent);
      const m = /^(\s*\S[^:]*:)\s*(.*?)(\s+#.*)?$/.exec(lines[at.index]);
      const keepComment = end === at.index + 1 && m?.[3] ? m[3] : '';
      lines.splice(at.index, end - at.index, `${' '.repeat(at.indent)}${lines[at.index].trimStart().split(':')[0]}: ${renderScalar(value)}${keepComment}`);
    }
    setIn(expected, path, value);
  }
  const out = lines.join(eol);
  let after;
  try { after = YAML.parse(out); } catch { throw err('Sửa config.yaml sẽ làm hỏng cú pháp — đã giữ nguyên tệp. Báo người cài đặt.'); }
  if (!isDeepStrictEqual(after, expected)) throw err('Sửa config.yaml không ra đúng giá trị — đã giữ nguyên tệp. Báo người cài đặt.');
  return out;
}

/**
 * Đọc → sửa → ghi nguyên tử config.yaml (có `.bak`). Không đổi gì thì không ghi. Trả true nếu đã ghi.
 * `afterRead` chỉ dùng trong test (mô phỏng tiến trình khác ghi chen).
 */
export function editConfigYaml(link, edits, { afterRead } = {}) {
  let file = link;
  try { file = realpathSync(link); } catch { /* chưa có tệp */ }
  if (!existsSync(file)) throw err('Không có config.yaml của trợ lý — báo người cài đặt.');
  const raw = readFileSync(file, 'utf8');
  afterRead?.();
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  const next = applyYamlEdits(raw.slice(bom.length), edits);
  if (next === raw.slice(bom.length)) return false;
  const changed = () => { try { return readFileSync(file, 'utf8') !== raw; } catch { return true; } };
  const conflict = () => err('Trợ lý vừa sửa config.yaml (vd. lệnh /model) — tải lại trang rồi thử lại.', 409);
  if (changed()) throw conflict();
  copyFileSync(file, `${file}.bak`);
  try { chmodSync(`${file}.bak`, 0o600); } catch { /* Windows */ }
  const st = statSync(file);
  writeFileAtomic(file, bom + next, {
    mode: st.mode & 0o777, tmpName: '.config.dashboard.tmp',
    afterWrite: (tmp) => {
      try { chownSync(tmp, st.uid, st.gid); } catch { /* Windows / không đủ quyền */ }
      // Kiểm lần cuối ngay trước khi đổi tên: khe hở còn lại chỉ là một lần rename.
      if (changed()) { rmSync(tmp, { force: true }); throw conflict(); }
    },
  });
  return true;
}

/** Đọc config.yaml đã phân tích (lỗi → {}). */
export function readConfigYaml(file) {
  try { return YAML.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) ?? {}; } catch { return {}; }
}
