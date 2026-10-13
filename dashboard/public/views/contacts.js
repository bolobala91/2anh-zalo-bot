// Liên hệ (spec §18.4): bạn bè của bot, người đã nhắn riêng, hồ sơ trong sổ người quen; lời mời kết bạn đang chờ.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Icon, Live, Notice, PageHead, Spinner } from '../ui.js';
import { BulkBar, flip, stillPicked } from './multi-pick.js';

/** Nghỉ giữa hai lần gọi Zalo khi xử lý hàng loạt, tránh bị Zalo chặn vì gọi dồn. */
export const BULK_DELAY_MS = 400;

export const KINDS = [
  { value: 'all', label: 'Tất cả' }, { value: 'friend', label: 'Bạn bè' },
  { value: 'dm', label: 'Đã nhắn riêng' }, { value: 'profile', label: 'Có hồ sơ' },
];

/** Nhãn nhỏ cạnh tên: vai trò và nguồn của người này. */
export function contactBadges(c) {
  return [c.owner && 'Chủ nhân', c.friend && 'Bạn bè', c.lastDmAt && 'Đã nhắn riêng', c.profile && 'Có hồ sơ'].filter(Boolean);
}

/**
 * Chạy `fn(item)` lần lượt từng mục, nghỉ `delay` ms giữa hai mục; `onProgress(i, total)` trước mỗi mục.
 * Trả `{ done: [item], failed: [{ item, error }] }` — một mục lỗi không dừng các mục sau.
 */
export async function runSequential(items, fn, { delay = BULK_DELAY_MS, onProgress = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const done = [];
  const failed = [];
  for (const [i, item] of items.entries()) {
    if (i) await sleep(delay);
    onProgress(i + 1, items.length);
    try { await fn(item); done.push(item); } catch (err) { failed.push({ item, error: err?.message || String(err) }); }
  }
  return { done, failed };
}

/** Câu tóm tắt sau khi xử lý hàng loạt: số đã xong + tên những lời mời chưa xử lý được. */
export function bulkSummary({ done, failed }, accept) {
  const ok = done.length ? `${accept ? 'Đã đồng ý' : 'Đã từ chối'} ${done.length} lời mời.` : '';
  const bad = failed.length ? `${failed.length} lời mời chưa xử lý được: ${failed.map((f) => `${f.item.name || 'Chưa rõ tên'} (${f.error})`).join('; ')}` : '';
  return { ok, error: bad };
}

function Requests({ onChanged }) {
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [progress, setProgress] = useState('');
  const load = () => api('/api/contacts/requests').then((r) => setList(r.requests)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { load(); }, []);
  async function answer(r, accept) {
    if (!accept && !confirm(`Từ chối lời mời kết bạn của ${r.name || 'người này'}?`)) return;
    setBusy(r.uid); setMsg({});
    try {
      await api(`/api/contacts/requests/${r.uid}`, { method: 'POST', body: { accept } });
      setMsg({ ok: accept ? `Đã đồng ý kết bạn với ${r.name || 'người này'}.` : `Đã từ chối lời mời của ${r.name || 'người này'}.` });
      await load(); onChanged();
    } catch (e) { setMsg({ error: e.message }); } finally { setBusy(''); }
  }
  async function answerMany(accept) {
    const items = (list || []).filter((r) => picked.has(r.uid));
    if (!items.length || (!accept && !confirm(`Từ chối ${items.length} lời mời kết bạn đã chọn?`))) return;
    setBusy('bulk'); setMsg({});
    const res = await runSequential(items, (r) => api(`/api/contacts/requests/${r.uid}`, { method: 'POST', body: { accept } }),
      { onProgress: (i, n) => setProgress(`Đang xử lý ${i}/${n}…`) });
    setProgress(''); setPicked(new Set());
    setMsg(bulkSummary(res, accept));
    try { await load(); if (res.done.length) onChanged(); } finally { setBusy(''); }
  }
  if (!list && !msg.error) return null;
  const sel = stillPicked(picked, list || []);
  return html`<section class="card">
    <h2>Lời mời kết bạn đang chờ ${list ? html`<span class="badge">${list.length}</span>` : null}</h2>
    <p class="muted small">Đồng ý thì người đó thành bạn của bot. Họ có nhắn riêng được với bot hay không vẫn theo mục Nhắn riêng ở Phân quyền Bot.</p>
    <${Live} error=${msg.error} ok=${msg.ok} />
    ${progress ? html`<p class="small bulk-progress" aria-live="polite">${progress}</p>` : null}
    ${list && !list.length ? html`<p class="muted">Không có lời mời nào.</p>` : null}
    ${list && list.length > 1 ? html`<${BulkBar} shown=${list} picked=${new Set(sel)} onPick=${setPicked} unit="lời mời">
      <button type="button" class="btn btn-primary btn-sm" disabled=${busy !== ''} onClick=${() => answerMany(true)}>Đồng ý đã chọn</button>
      <button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => answerMany(false)}>Từ chối đã chọn</button>
    <//>` : null}
    <ul class="row-list">
      ${(list || []).map((r) => html`<li key=${r.uid} class="row-item">
        ${list.length > 1 ? html`<input type="checkbox" class="bulk-check" checked=${picked.has(r.uid)} disabled=${busy !== ''}
          aria-label=${`Chọn ${r.name || 'người này'}`} onChange=${() => setPicked(flip(picked, r.uid))} />` : null}
        <span class="avatar avatar-sm" aria-hidden="true">${(r.name || '?').slice(0, 1).toUpperCase()}</span>
        <span class="row-main"><strong>${r.name || 'Chưa rõ tên'}</strong>
          <small class="muted">${r.message ? `“${r.message}” · ` : ''}${r.at ? fmtTime(r.at) : ''}</small></span>
        <button class="btn btn-primary btn-sm" disabled=${busy !== ''} onClick=${() => answer(r, true)}>Đồng ý</button>
        <button class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => answer(r, false)}>Từ chối</button>
      </li>`)}
    </ul>
  </section>`;
}

export function Contacts() {
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = (fresh = false) => {
    const params = new URLSearchParams({ kind, q, ...(fresh ? { fresh: '1' } : {}) });
    return api(`/api/contacts?${params}`).then((r) => { setData(r); setError(''); }).catch((e) => setError(e.message));
  };
  useEffect(() => { const id = setTimeout(load, 250); return () => clearTimeout(id); }, [kind, q]);

  const errs = Object.values(data?.errors || {});
  return html`<${PageHead} title="Liên hệ" sub="Bạn bè của bot, người đã nhắn riêng và người có hồ sơ trong sổ người quen." />
    <${Requests} onChanged=${() => load(true)} />
    <section class="card">
      <div class="toolbar">
        <div class="chips" role="group" aria-label="Lọc liên hệ">
          ${KINDS.map((k) => html`<button key=${k.value} type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${kind === k.value ? 'true' : 'false'}
            onClick=${() => setKind(k.value)}>${k.label}${data && k.value !== 'all' ? ` (${data.counts[k.value]})` : ''}</button>`)}
        </div>
        <label class="sr-only" for="contact-q">Tìm liên hệ</label>
        <input id="contact-q" type="search" placeholder="Tìm theo tên, ghi chú…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => load(true)}><${Icon} name="refresh" size=${16} /> Tải lại</button>
      </div>
      <${Live} error=${error} />
      ${errs.map((e) => html`<${Notice} kind="warn">${e}<//>`)}
      ${!data && !error ? html`<${Spinner} />` : null}
      ${data && !data.contacts.length ? html`<p class="muted">Không có ai khớp.</p>` : null}
      <ul class="row-list">
        ${(data?.contacts || []).map((c) => html`<li key=${c.uid} class="row-item">
          <span class="avatar avatar-sm" aria-hidden="true">${(c.name || '?').slice(0, 1).toUpperCase()}</span>
          <span class="row-main"><strong>${c.name || 'Chưa rõ tên'}</strong>
            ${c.profile?.note ? html`<small class="muted">${c.profile.note}</small>` : null}</span>
          <span class="row-tags">${contactBadges(c).map((b) => html`<span key=${b} class="badge">${b}</span>`)}</span>
          ${c.lastDmAt ? html`<small class="muted">${fmtTime(c.lastDmAt)}</small>` : null}
        </li>`)}
      </ul>
      ${data?.truncated ? html`<p class="muted small">Chỉ hiện 1000 người đầu — gõ để tìm cụ thể hơn.</p>` : null}
    </section>`;
}
