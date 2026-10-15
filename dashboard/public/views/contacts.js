// Liên hệ (spec §18.4): bạn bè của bot, người đã nhắn riêng, hồ sơ trong sổ người quen; lời mời kết bạn đang chờ.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Icon, Live, Notice, PageHead, Spinner } from '../ui.js';
import { BulkBar, flip, stillPicked } from './multi-pick.js';
import { FolderChip, folderIndex } from './folder-ui.js';

const FOLDER_KEY = 'zd:friend-folder';
export const lastFolder = () => { try { return localStorage.getItem(FOLDER_KEY) || ''; } catch { return ''; } };
export const rememberFolder = (id) => { try { localStorage.setItem(FOLDER_KEY, id); } catch { /* chế độ riêng tư */ } };

/** Thêm người vào một thư mục của Phân quyền Bot (người đang ở thư mục khác được chuyển sang). */
export const addToFolder = (fid, people) => api(`/api/permissions/folders/${encodeURIComponent(fid)}/people/add`, {
  method: 'POST', body: { people: people.map((p) => (p.name ? { uid: p.uid, name: p.name } : { uid: p.uid })) },
});

/** Ô chọn thư mục ("Không xếp" = để như cũ). */
export function FolderSelect({ id, folders, value, onChange, label, emptyLabel = 'Không xếp vào thư mục' }) {
  return html`<label class="folder-select" for=${id}><span class="small muted">${label}</span>
    <select id=${id} value=${value} onChange=${(e) => onChange(e.currentTarget.value)}>
      <option value="">${emptyLabel}</option>
      ${folders.map((f) => html`<option key=${f.id} value=${f.id}>${f.name}</option>`)}
    </select></label>`;
}

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

function Requests({ onChanged, folders }) {
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [progress, setProgress] = useState('');
  const [folder, setFolderRaw] = useState(lastFolder);
  const setFolder = (v) => { setFolderRaw(v); rememberFolder(v); };
  const target = folders.find((f) => f.id === folder) || null; // thư mục đã bị xoá thì coi như "Không xếp"
  // Sau khi đồng ý: xếp vào thư mục đã chọn. Lỗi xếp không làm hỏng việc kết bạn đã xong — chỉ báo lại.
  async function file(people) {
    if (!target || !people.length) return '';
    try { await addToFolder(target.id, people); return ` Đã xếp vào thư mục ${target.name}.`; } catch (e) { return ` Chưa xếp được vào thư mục ${target.name}: ${e.message}`; }
  }
  const load = () => api('/api/contacts/requests').then((r) => setList(r.requests)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { load(); }, []);
  async function answer(r, accept) {
    if (!accept && !confirm(`Từ chối lời mời kết bạn của ${r.name || 'người này'}?`)) return;
    setBusy(r.uid); setMsg({});
    try {
      await api(`/api/contacts/requests/${r.uid}`, { method: 'POST', body: { accept } });
      const filed = accept ? await file([r]) : '';
      setMsg({ ok: accept ? `Đã đồng ý kết bạn với ${r.name || 'người này'}.${filed}` : `Đã từ chối lời mời của ${r.name || 'người này'}.` });
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
    const sum = bulkSummary(res, accept);
    const filed = accept ? await file(res.done) : '';
    setMsg({ ...sum, ok: sum.ok ? sum.ok + filed : sum.ok });
    try { await load(); if (res.done.length) onChanged(); } finally { setBusy(''); }
  }
  if (!list && !msg.error) return null;
  const sel = stillPicked(picked, list || []);
  return html`<section class="card">
    <h2>Lời mời kết bạn đang chờ ${list ? html`<span class="badge">${list.length}</span>` : null}</h2>
    <p class="muted small">Đồng ý thì người đó thành bạn của bot. Chọn thư mục bên dưới để xếp luôn người được đồng ý vào thư mục đó — họ nhắn riêng với bot và dùng đúng quyền của thư mục, không phải vào Phân quyền Bot nữa.</p>
    ${folders.length ? html`<${FolderSelect} id="req-folder" folders=${folders} value=${target ? folder : ''} onChange=${setFolder} label="Xếp người được đồng ý vào" />` : null}
    <${Live} error=${msg.error} ok=${msg.ok} />
    ${progress ? html`<p class="small bulk-progress" aria-live="polite">${progress}</p>` : null}
    ${list && !list.length ? html`<p class="muted">Không có lời mời nào.</p>` : null}
    ${list && list.length > 1 ? html`<${BulkBar} shown=${list} picked=${new Set(sel)} onPick=${setPicked} unit="lời mời">
      <button type="button" class="btn btn-primary btn-sm" disabled=${busy !== ''} onClick=${() => answerMany(true)}>Đồng ý đã chọn${target ? ` → ${target.name}` : ''}</button>
      <button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => answerMany(false)}>Từ chối đã chọn</button>
    <//>` : null}
    <ul class="row-list">
      ${(list || []).map((r) => html`<li key=${r.uid} class="row-item">
        ${list.length > 1 ? html`<input type="checkbox" class="bulk-check" checked=${picked.has(r.uid)} disabled=${busy !== ''}
          aria-label=${`Chọn ${r.name || 'người này'}`} onChange=${() => setPicked(flip(picked, r.uid))} />` : null}
        <span class="avatar avatar-sm" aria-hidden="true">${(r.name || '?').slice(0, 1).toUpperCase()}</span>
        <span class="row-main"><strong>${r.name || 'Chưa rõ tên'}</strong>
          <small class="muted">${r.message ? `“${r.message}” · ` : ''}${r.at ? fmtTime(r.at) : ''}</small></span>
        <button class="btn btn-primary btn-sm" disabled=${busy !== ''} onClick=${() => answer(r, true)} title=${target ? `Đồng ý và xếp vào thư mục ${target.name}` : 'Đồng ý kết bạn'}>Đồng ý${target ? ` → ${target.name}` : ''}</button>
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
  const [folders, setFolders] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [moveTo, setMoveTo] = useState(lastFolder);
  const [moveMsg, setMoveMsg] = useState({});
  const [moving, setMoving] = useState(false);
  const loadFolders = () => api('/api/permissions').then((r) => setFolders(r.folders || []), () => {});
  useEffect(() => { loadFolders(); }, []);
  const index = folderIndex(folders);
  async function move() {
    const target = folders.find((f) => f.id === moveTo);
    const people = (data?.contacts || []).filter((c) => picked.has(c.uid));
    if (!target || !people.length) return;
    setMoving(true); setMoveMsg({});
    try {
      await addToFolder(target.id, people);
      rememberFolder(target.id);
      setMoveMsg({ ok: `Đã chuyển ${people.length} người vào thư mục ${target.name}.` });
      setPicked(new Set()); await loadFolders();
    } catch (e) { setMoveMsg({ error: e.message }); } finally { setMoving(false); }
  }
  const load = (fresh = false) => {
    const params = new URLSearchParams({ kind, q, ...(fresh ? { fresh: '1' } : {}) });
    return api(`/api/contacts?${params}`).then((r) => { setData(r); setError(''); }).catch((e) => setError(e.message));
  };
  useEffect(() => { const id = setTimeout(load, 250); return () => clearTimeout(id); }, [kind, q]);

  const errs = Object.values(data?.errors || {});
  return html`<${PageHead} title="Liên hệ" sub="Bạn bè của bot, người đã nhắn riêng và người có hồ sơ trong sổ người quen." />
    <${Requests} folders=${folders} onChanged=${() => { load(true); loadFolders(); }} />
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
      <${Live} error=${moveMsg.error} ok=${moveMsg.ok} />
      ${data?.contacts?.length && folders.length ? html`<${BulkBar} shown=${data.contacts} picked=${new Set(stillPicked(picked, data.contacts))} onPick=${setPicked} unit="người">
        <${FolderSelect} id="move-folder" folders=${folders} value=${folders.some((f) => f.id === moveTo) ? moveTo : ''} onChange=${setMoveTo} label="Chuyển vào" emptyLabel="Chọn thư mục…" />
        <button type="button" class="btn btn-primary btn-sm" disabled=${moving || !folders.some((f) => f.id === moveTo)} onClick=${move}>${moving ? 'Đang chuyển…' : 'Chuyển'}</button>
      <//>` : null}
      <ul class="row-list">
        ${(data?.contacts || []).map((c) => html`<li key=${c.uid} class="row-item">
          ${folders.length ? html`<input type="checkbox" class="bulk-check" checked=${picked.has(c.uid)} disabled=${moving}
            aria-label=${`Chọn ${c.name || 'người này'}`} onChange=${() => setPicked(flip(picked, c.uid))} />` : null}
          <span class="avatar avatar-sm" aria-hidden="true">${(c.name || '?').slice(0, 1).toUpperCase()}</span>
          <span class="row-main"><strong>${c.name || 'Chưa rõ tên'}</strong>
            ${c.profile?.note ? html`<small class="muted">${c.profile.note}</small>` : null}</span>
          <span class="row-tags">${index.people.get(c.uid) ? html`<${FolderChip} folder=${index.people.get(c.uid)} />` : null}${contactBadges(c).map((b) => html`<span key=${b} class="badge">${b}</span>`)}</span>
          ${c.lastDmAt ? html`<small class="muted">${fmtTime(c.lastDmAt)}</small>` : null}
        </li>`)}
      </ul>
      ${data?.truncated ? html`<p class="muted small">Chỉ hiện 1000 người đầu — gõ để tìm cụ thể hơn.</p>` : null}
    </section>`;
}
