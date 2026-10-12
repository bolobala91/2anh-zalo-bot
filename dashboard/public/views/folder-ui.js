// Thư mục (nhóm + người) dùng chung cho Phân quyền Bot và Phiên chat: màu, nhãn, hàng lọc. Màu khớp FOLDER_COLORS
// của dashboard/lib/permissions.js.
import { html, Icon } from '../ui.js';

export const FOLDER_COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'teal', 'red', 'indigo', 'gray'];
export const FOLDER_COLOR_LABELS = { blue: 'Xanh dương', green: 'Xanh lá', orange: 'Cam', purple: 'Tím', pink: 'Hồng', teal: 'Xanh ngọc', red: 'Đỏ', indigo: 'Chàm', gray: 'Xám' };
export const NO_FOLDER = '__none';

/** Màu của thư mục (thiếu/lạ → xám). */
export const colorOf = (f) => (FOLDER_COLORS.includes(f?.color) ? f.color : 'gray');

/** `{ groups: Map(id → thư mục), people: Map(uid → thư mục) }` — thư mục đứng trước giữ (như máy chủ). */
export function folderIndex(folders) {
  const groups = new Map();
  const people = new Map();
  for (const f of folders || []) {
    for (const id of f.groups || []) if (!groups.has(id)) groups.set(id, f);
    for (const p of f.people || []) if (!people.has(p.uid)) people.set(p.uid, f);
  }
  return { groups, people };
}

/** Thư mục của một hội thoại: nhóm (threadType 1) theo id nhóm, nhắn riêng theo UID người. */
export const folderOfThread = (index, threadId, threadType) => (threadType === 1 ? index.groups : index.people).get(String(threadId)) || null;

export function FolderChip({ folder, small = true }) {
  if (!folder) return null;
  return html`<span class=${`fchip mtag-${colorOf(folder)}${small ? ' fchip-sm' : ''}`} title=${`Thư mục: ${folder.name}`}><span class=${`fdot fdot-${colorOf(folder)}`} aria-hidden="true"></span>${folder.name}</span>`;
}

/** Hàng lọc theo thư mục: Tất cả · từng thư mục (có số) · Chưa xếp. `of(item)` → thư mục của mục đó hoặc null. */
export function FolderFilter({ folders, items, of, value, onChange, label = 'Lọc theo thư mục' }) {
  if (!folders?.length) return null;
  const counts = new Map();
  let none = 0;
  for (const it of items || []) { const f = of(it); if (f) counts.set(f.id, (counts.get(f.id) || 0) + 1); else none += 1; }
  const chip = (key, text, color) => html`<button key=${key} type="button" class=${`btn btn-secondary btn-sm chip fchip-btn${color ? ` mtag-${color}` : ''}`} aria-pressed=${value === key ? 'true' : 'false'} onClick=${() => onChange(value === key ? 'all' : key)}>
    ${color ? html`<span class=${`fdot fdot-${color}`} aria-hidden="true"></span>` : null}${text}</button>`;
  return html`<div class="chips folder-filter" role="group" aria-label=${label}>
    ${chip('all', `Tất cả (${(items || []).length})`)}
    ${folders.map((f) => chip(f.id, `${f.name} (${counts.get(f.id) || 0})`, colorOf(f)))}
    ${none ? chip(NO_FOLDER, `Chưa xếp (${none})`) : null}
  </div>`;
}

/** Mục có khớp bộ lọc thư mục không. */
export const inFolderFilter = (value, folder) => value === 'all' || (value === NO_FOLDER ? !folder : folder?.id === value);

export function FolderColorPicker({ value, onChange, disabled }) {
  return html`<div class="chips folder-colors" role="radiogroup" aria-label="Màu thư mục">
    ${FOLDER_COLORS.map((c) => html`<button key=${c} type="button" role="radio" aria-checked=${value === c ? 'true' : 'false'} disabled=${disabled}
      class=${`color-swatch fdot-${c}${value === c ? ' on' : ''}`} title=${FOLDER_COLOR_LABELS[c]} aria-label=${FOLDER_COLOR_LABELS[c]} onClick=${() => onChange(c)}>
      ${value === c ? html`<${Icon} name="check" size=${14} />` : null}</button>`)}
  </div>`;
}
