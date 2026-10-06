// Gấp chữ để tìm không phân biệt hoa thường và dấu tiếng Việt: "Hoà", "hòa", "HOA" → "hoa"; "Đoàn" → "doan".
// Dùng chung cho máy chủ (hàm SQLite zd_fold, dashboard/lib/store-reader.js) và giao diện — sửa một chỗ.

const MARKS = /[̀-ͯ]/g;

export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(MARKS, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

/**
 * Gấp từng ký tự của chữ gốc, kèm bảng vị trí: starts[k] = vị trí trong chữ gốc của ký tự gấp thứ k.
 * Nhờ đó đoạn trùng trên chữ đã gấp được đặt lại đúng chỗ trên chữ gốc dù độ dài hai bên khác nhau.
 */
export function foldWithMap(s) {
  const src = String(s ?? '');
  let folded = '';
  const starts = [];
  let i = 0;
  for (const ch of src) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k += 1) starts.push(i);
    folded += f;
    i += ch.length;
  }
  return { folded, starts };
}

/** Tách chữ thành đoạn [{ text, hit }] theo từ khoá đã gấp — để bọc <mark> qua htm, không bao giờ dựng HTML. */
export function markMatches(text, q) {
  const s = String(text ?? '');
  const needle = fold(q).trim();
  if (!needle) return [{ text: s, hit: false }];
  const { folded, starts } = foldWithMap(s);
  // Điểm cuối = đầu ký tự gấp kế tiếp, nên dấu rời (tổ hợp) đi sau chữ cuối vẫn nằm trong đoạn tô.
  const at = (k) => (k < starts.length ? starts[k] : s.length);
  const out = [];
  let i = 0; // vị trí trong chữ gốc
  for (let j = folded.indexOf(needle); j !== -1; j = folded.indexOf(needle, j + needle.length)) {
    const from = at(j); const to = at(j + needle.length);
    if (from < i) continue;
    if (from > i) out.push({ text: s.slice(i, from), hit: false });
    out.push({ text: s.slice(from, to), hit: true });
    i = to;
  }
  if (i < s.length || !out.length) out.push({ text: s.slice(i), hit: false });
  return out;
}

/** Vị trí (trong chữ gốc) chỗ trùng đầu tiên, không có thì -1. */
export function indexOfFolded(text, q) {
  const needle = fold(q).trim();
  if (!needle) return -1;
  const { folded, starts } = foldWithMap(text);
  const j = folded.indexOf(needle);
  return j === -1 ? -1 : starts[j];
}
