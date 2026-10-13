// Chọn nhiều người cùng lúc: ô lọc tên + danh sách có ô tích + "Chọn tất cả (đang lọc)" + nút "Thêm N người".
// Chỉ hiện tên (và ghi chú như "đang ở thư mục X"), không hiện UID.
import { useState } from '../vendor/hooks.mjs';
import { html } from '../ui.js';
import { fold } from '../fold.js';

/** Lựa chọn khớp ô lọc (bỏ dấu, không phân biệt hoa thường). */
export function filterOptions(options, q) {
  const n = fold(String(q || '')).trim();
  return n ? options.filter((o) => fold(`${o.name || ''} ${o.note || ''}`).includes(n)) : options;
}

/** Bấm "Chọn tất cả": nếu mọi mục đang lọc đã chọn thì bỏ chọn chúng, không thì chọn hết. */
export function toggleAll(picked, shown) {
  const next = new Set(picked);
  const all = shown.length > 0 && shown.every((o) => next.has(o.uid));
  for (const o of shown) { if (all) next.delete(o.uid); else next.add(o.uid); }
  return next;
}

/**
 * Danh sách đang có (người trong thư mục…): cuộn được, lọc theo tên, tích chọn rồi bỏ hàng loạt.
 * `items`: [{ uid, name, note }] — `onRemove(uids)`.
 */
export function BulkList({ id, items, onRemove, label = 'Danh sách', unit = 'người', empty = 'Chưa có ai.', action = 'Bỏ' }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  if (!items.length) return html`<p class="muted small">${empty}</p>`;
  const shown = filterOptions(items, q);
  const have = new Set(items.map((o) => o.uid));
  const sel = [...picked].filter((u) => have.has(u));   // bỏ chọn người vừa bị gỡ
  const allOn = shown.length > 0 && shown.every((o) => picked.has(o.uid));
  const flip = (uid) => setPicked((cur) => { const next = new Set(cur); if (next.has(uid)) next.delete(uid); else next.add(uid); return next; });
  return html`<div class="multi-pick">
    <div class="multi-pick-bar">
      <label for=${`${id}-q`} class="sr-only">${label} — lọc theo tên</label>
      <input id=${`${id}-q`} type="search" placeholder=${`Lọc ${items.length} ${unit} theo tên`} value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      <button type="button" class="btn btn-ghost btn-sm" disabled=${!shown.length} onClick=${() => setPicked(toggleAll(picked, shown))}>
        ${allOn ? 'Bỏ chọn' : `Chọn tất cả${q.trim() ? ' (đang lọc)' : ''}`}</button>
    </div>
    <ul class="multi-pick-list" role="group" aria-label=${label}>
      ${shown.map((o) => html`<li key=${o.uid}><label class="multi-pick-item">
        <input type="checkbox" checked=${picked.has(o.uid)} onChange=${() => flip(o.uid)} />
        <span>${o.name || 'Chưa rõ tên'}${o.note ? html` <small class="muted">${o.note}</small>` : null}</span></label></li>`)}
      ${shown.length ? null : html`<li class="muted small">Không có ai khớp.</li>`}
    </ul>
    <button type="button" class="btn btn-danger-outline btn-sm" disabled=${!sel.length}
      onClick=${() => { onRemove(sel); setPicked(new Set()); }}>${sel.length ? `${action} ${sel.length} ${unit} đã chọn` : `Tích chọn để ${action.toLowerCase()} hàng loạt`}</button>
  </div>`;
}

export function MultiPick({ id, options, onAdd, label = 'Chọn người đã biết', unit = 'người' }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  if (!options.length) return null;
  const shown = filterOptions(options, q);
  const allOn = shown.length > 0 && shown.every((o) => picked.has(o.uid));
  const flip = (uid) => setPicked((cur) => { const next = new Set(cur); if (next.has(uid)) next.delete(uid); else next.add(uid); return next; });
  const add = () => { onAdd(options.filter((o) => picked.has(o.uid))); setPicked(new Set()); setQ(''); };
  return html`<div class="multi-pick">
    <div class="multi-pick-bar">
      <label for=${`${id}-q`} class="sr-only">${label} — lọc theo tên</label>
      <input id=${`${id}-q`} type="search" placeholder=${`${label} — gõ để lọc`} value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      <button type="button" class="btn btn-ghost btn-sm" disabled=${!shown.length} onClick=${() => setPicked(toggleAll(picked, shown))}>
        ${allOn ? 'Bỏ chọn' : `Chọn tất cả${q.trim() ? ' (đang lọc)' : ''}`}</button>
    </div>
    <ul class="multi-pick-list" role="group" aria-label=${label}>
      ${shown.map((o) => html`<li key=${o.uid}><label class="multi-pick-item">
        <input type="checkbox" checked=${picked.has(o.uid)} onChange=${() => flip(o.uid)} />
        <span>${o.name || 'Chưa rõ tên'}${o.note ? html` <small class="muted">${o.note}</small>` : null}</span></label></li>`)}
      ${shown.length ? null : html`<li class="muted small">Không có ai khớp.</li>`}
    </ul>
    <button type="button" class="btn btn-secondary btn-sm" disabled=${!picked.size} onClick=${add}>
      ${picked.size ? `Thêm ${picked.size} ${unit}` : `Tích chọn rồi bấm thêm`}</button>
  </div>`;
}
