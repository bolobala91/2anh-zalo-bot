// Trí nhớ › Bộ nhớ của trợ lý (chỉ Quản trị): mỗi mục một ý, có THẺ LOẠI "[Loại] …" — lọc theo loại, chọn loại khi
// thêm/sửa (hoặc để AI tự phân loại), "Sắp xếp lại bằng AI" (xem trước rồi mới ghi), lịch sử bot tự tách + Hoàn tác.
import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { Dialog, html, fmtTime, Icon, Live, Spinner } from '../ui.js';
import { BulkBar, flip } from './multi-pick.js';

export const TAG_COLORS = ['blue', 'indigo', 'green', 'teal', 'pink', 'orange', 'purple', 'red', 'gray'];
export const COLOR_LABELS = { blue: 'Xanh dương', indigo: 'Chàm', green: 'Xanh lá', teal: 'Xanh ngọc', pink: 'Hồng', orange: 'Cam', purple: 'Tím', red: 'Đỏ', gray: 'Xám' };
const TAG_RE = /^\[([^[\]\n]{1,30})\]\s+/;
const POLL_MS = 2000;
const POLL_MAX = 120;

/** "[Loại] nội dung" → { tag, text } (giống lib/memory-tags.js). */
export function splitTag(entry) {
  const m = TAG_RE.exec(String(entry ?? ''));
  return m ? { tag: m[1].trim(), text: entry.slice(m[0].length) } : { tag: null, text: String(entry ?? '') };
}

/** "1.234/2.200 ký tự (56 %)" cho thanh dung lượng bộ nhớ. */
export function usageText(used, limit) {
  const n = new Intl.NumberFormat('vi-VN');
  return `${n.format(used)}/${n.format(limit)} ký tự (${limit ? Math.min(100, Math.round((used / limit) * 100)) : 0} %)`;
}

/** Đếm mục theo loại (null = chưa phân loại). */
export function tagCounts(entries) {
  const out = new Map();
  for (const e of entries) { const { tag } = splitTag(e); out.set(tag, (out.get(tag) || 0) + 1); }
  return out;
}

/** Các mục đã tích (theo chỉ số) → `[{ index, old }]` gửi lên máy chủ để kiểm từng mục còn nguyên. */
export function pickedEntries(entries, picked) {
  return entries.flatMap((old, index) => (picked.has(index) ? [{ index, old }] : []));
}

const colorOf = (tags, tag) => tags.find((t) => t.label === tag)?.color || 'gray';
function TagBadge({ tags, tag }) {
  return tag ? html`<span class=${`mtag mtag-${colorOf(tags, tag)}`}>${tag}</span>` : html`<span class="mtag mtag-none">Chưa phân loại</span>`;
}

function EntryDialog({ target, label, entry, tags, onSaved, onClose }) {
  const parts = splitTag(entry?.text || '');
  const [text, setText] = useState(parts.text);
  const [tag, setTag] = useState(entry ? (parts.tag || '') : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const known = !parts.tag || tags.some((t) => t.label === parts.tag);
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = entry ? await api(`/api/admin/agent-memory/${target}/${entry.index}`, { method: 'PUT', body: { old: entry.text, text, tag } })
        : await api(`/api/admin/agent-memory/${target}`, { method: 'POST', body: { text, tag } });
      onSaved(r, `${entry ? 'Đã lưu' : 'Đã thêm'}${r.autoTagging ? ' — AI đang phân loại, vài giây nữa danh sách tự cập nhật.' : '.'}`);
    } catch (err) { setError(err.message); setBusy(false); }
  }
  async function remove() {
    if (!confirm('Xoá điều này khỏi bộ nhớ của trợ lý?')) return;
    setBusy(true); setError('');
    try { onSaved(await api(`/api/admin/agent-memory/${target}/${entry.index}`, { method: 'DELETE', body: { old: entry.text } }), 'Đã xoá.'); } catch (err) { setError(err.message); setBusy(false); }
  }
  const dirty = () => !busy && (text !== parts.text || tag !== (entry ? (parts.tag || '') : ''));
  return html`<${Dialog} title=${entry ? `Sửa — ${label}` : `Thêm vào ${label}`} onClose=${onClose} dirty=${dirty} wide>
    <form class="stack" onSubmit=${save}>
      <label class="field"><span>Loại</span>
        <select value=${tag} onChange=${(e) => setTag(e.currentTarget.value)}>
          <option value="">Tự phân loại (AI tách và gắn thẻ)</option>
          ${tags.map((t) => html`<option key=${t.label} value=${t.label}>${t.label}</option>`)}
          ${known ? null : html`<option value=${parts.tag}>${parts.tag} (loại đã xoá)</option>`}
        </select></label>
      <label class="field"><span>Điều trợ lý cần nhớ</span>
        <textarea rows="5" required value=${text} placeholder="Ví dụ: Gói tư vấn VIP giá 1 triệu, gồm cài đặt và hướng dẫn." onInput=${(e) => setText(e.currentTarget.value)}></textarea>
        <small class="muted">Mỗi mục một ý. Dặn nhiều chuyện một lúc thì chọn "Tự phân loại" — AI tách thành nhiều thẻ. Có hiệu lực ngay, ở mọi cuộc trò chuyện.</small></label>
      <${Live} error=${error} />
      <div class="dialog-actions">
        <button class="btn btn-primary" disabled=${busy || !text.trim()}>${busy ? 'Đang lưu…' : entry ? 'Lưu' : 'Thêm'}</button>
        ${entry ? html`<button type="button" class="btn btn-danger-outline" disabled=${busy} onClick=${remove}>Xoá</button>` : null}
      </div>
    </form>
  <//>`;
}

function TagsDialog({ tags, onSaved, onClose }) {
  const [rows, setRows] = useState(tags.map((t) => ({ ...t, from: t.label })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    const renames = Object.fromEntries(rows.filter((r) => r.from && r.from !== r.label.trim()).map((r) => [r.from, r.label.trim()]));
    try { onSaved(await api('/api/admin/agent-memory-tags', { method: 'PUT', body: { tags: rows.map(({ label, color }) => ({ label: label.trim(), color })), renames } }), 'Đã lưu loại thẻ.'); } catch (err) { setError(err.message); setBusy(false); }
  }
  return html`<${Dialog} title="Loại thẻ bộ nhớ" onClose=${onClose} dirty=${() => !busy && JSON.stringify(rows.map(({ label, color }) => ({ label, color }))) !== JSON.stringify(tags)} wide>
    <form class="stack" onSubmit=${save}>
      <p class="muted small">Đổi tên thì mọi mục đang mang loại đó đổi theo. Xoá loại thì các mục của nó chuyển về "Khác".</p>
      <ul class="mtag-edit">${rows.map((r, i) => html`<li key=${i}>
        <span class=${`mtag mtag-${r.color}`} aria-hidden="true">${r.label || '…'}</span>
        <label class="sr-only" for=${`mt-l-${i}`}>Tên loại</label>
        <input id=${`mt-l-${i}`} maxlength="30" value=${r.label} disabled=${r.from === 'Khác'} onInput=${(e) => set(i, { label: e.currentTarget.value })} />
        <label class="sr-only" for=${`mt-c-${i}`}>Màu</label>
        <select id=${`mt-c-${i}`} value=${r.color} onChange=${(e) => set(i, { color: e.currentTarget.value })}>
          ${TAG_COLORS.map((c) => html`<option key=${c} value=${c}>${COLOR_LABELS[c]}</option>`)}</select>
        <button type="button" class="tag-x" aria-label=${`Xoá loại ${r.label}`} disabled=${r.from === 'Khác'} onClick=${() => setRows(rows.filter((_, j) => j !== i))}><${Icon} name="close" size=${14} /></button>
      </li>`)}</ul>
      <button type="button" class="btn btn-secondary btn-sm" disabled=${rows.length >= 20} onClick=${() => setRows([...rows, { label: '', color: 'purple', from: '' }])}><${Icon} name="plus" size=${14} /> Thêm loại</button>
      <${Live} error=${error} />
      <div class="dialog-actions"><button class="btn btn-primary" disabled=${busy || rows.some((r) => !r.label.trim())}>${busy ? 'Đang lưu…' : 'Lưu'}</button></div>
    </form>
  <//>`;
}

function EntryList({ entries, tags }) {
  return html`<ul class="mem-list mem-list-plain">${entries.map((e, i) => { const p = splitTag(e); return html`<li key=${i} class="mem-line mem-line-static"><${TagBadge} tags=${tags} tag=${p.tag} /> ${p.text}</li>`; })}</ul>`;
}

/** Xin AI sắp xếp một tệp, chờ đề xuất, cho xem trước/sau rồi mới ghi. */
function OrganizeDialog({ target, label, tags, onSaved, onClose }) {
  const [state, setState] = useState({ phase: 'asking' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const { id } = await api(`/api/admin/agent-memory/${target}/organize`, { method: 'POST' });
        for (let i = 0; i < POLL_MAX && alive.current; i += 1) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          const r = await api(`/api/admin/agent-memory-organize/${id}`);
          if (r.status === 'done') { setState(r.result.ok ? { phase: 'review', id, result: r.result } : { phase: 'error', error: r.result.error }); return; }
          if (r.status === 'timeout') { setState({ phase: 'error', error: 'Trợ lý chưa trả lời — kiểm tra trợ lý có đang chạy không rồi thử lại.' }); return; }
        }
      } catch (err) { if (alive.current) setState({ phase: 'error', error: err.message }); }
    })();
    return () => { alive.current = false; };
  }, []);
  async function apply() {
    setState({ ...state, busy: true, error: '' });
    try { onSaved(await api(`/api/admin/agent-memory-organize/${state.id}/apply`, { method: 'POST' }), 'Đã áp dụng bản AI sắp xếp.'); } catch (err) { setState({ ...state, busy: false, error: err.message }); }
  }
  const r = state.result;
  const same = r && JSON.stringify(r.before) === JSON.stringify(r.after);
  return html`<${Dialog} title=${`Sắp xếp lại bằng AI — ${label}`} onClose=${onClose} wide>
    ${state.phase === 'asking' ? html`<p class="muted"><${Spinner} /> AI đang đọc và tách bộ nhớ thành thẻ một ý… (thường 10–30 giây)</p>` : null}
    ${state.phase === 'error' ? html`<${Live} error=${state.error} />` : null}
    ${state.phase === 'review' ? html`<div class="stack">
      ${same ? html`<p>Bộ nhớ đã gọn — AI không đề xuất thay đổi nào.</p>` : html`
        <p class="muted small">${r.before.length} mục → <strong>${r.after.length} thẻ</strong>. Xem lại rồi bấm Áp dụng; chưa bấm thì chưa có gì thay đổi.</p>
        ${r.note ? html`<p class="notice notice-warn">${r.note}</p>` : null}
        ${r.overLimit ? html`<p class="notice notice-warn">Bản sắp xếp dài hơn dung lượng cho phép (${r.limit} ký tự) — xoá bớt mục rồi thử lại.</p>` : null}
        <div class="organize-cols">
          <div><h4>Hiện tại</h4><${EntryList} entries=${r.before} tags=${tags} /></div>
          <div><h4>Sau khi sắp xếp</h4><${EntryList} entries=${r.after} tags=${tags} /></div>
        </div>`}
      <${Live} error=${state.error} />
      <div class="dialog-actions">
        ${same ? null : html`<button class="btn btn-primary" disabled=${state.busy || r.overLimit} onClick=${apply}>${state.busy ? 'Đang ghi…' : 'Áp dụng'}</button>`}
        <button type="button" class="btn btn-secondary" onClick=${onClose}>Đóng</button>
      </div></div>` : null}
  <//>`;
}

function History({ tags, labels, onChanged }) {
  const [log, setLog] = useState(null);
  const [error, setError] = useState('');
  const load = () => api('/api/admin/agent-memory-organize-log').then((r) => setLog(r.log)).catch((e) => setError(e.message));
  async function undo(x) {
    if (!confirm('Hoàn tác lần sắp xếp này? Các thẻ tách ra sẽ gộp lại như trước.')) return;
    try { const r = await api(`/api/admin/agent-memory-organize-log/${x.id}/undo`, { method: 'POST' }); setLog(r.log); onChanged(r, 'Đã hoàn tác.'); } catch (e) { setError(e.message); }
  }
  return html`<details class="perm-box" onToggle=${(e) => { if (e.currentTarget.open && !log) load(); }}>
    <summary>Lịch sử tự sắp xếp</summary>
    <${Live} error=${error} />
    ${log && !log.length ? html`<p class="muted">Chưa có lần nào.</p>` : null}
    <ul class="row-list">${(log || []).map((x) => html`<li key=${x.id} class="row-item organize-log">
      <span class="row-main"><strong>${x.by === 'bot' ? 'Bot tự tách khi ghi nhớ' : `Áp dụng bởi ${x.by}`} · ${labels[x.target] || x.target}</strong>
        <small class="muted">${fmtTime(x.at)} · ${x.before.length} mục → ${x.after.length} thẻ</small>
        <${EntryList} entries=${x.after} tags=${tags} /></span>
      ${x.undone ? html`<span class="badge">Đã hoàn tác</span>` : html`<button type="button" class="btn btn-secondary btn-sm" onClick=${() => undo(x)}>Hoàn tác</button>`}
    </li>`)}</ul>
  </details>`;
}

/** Thanh "Chọn nhiều" của một tệp: Gắn thẻ / Xoá N mục đã tích. */
function BulkMem({ target, entries, shown, picked, onPick, tags, onSaved, onError }) {
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  // Chỉ mục đang hiện (theo bộ lọc loại) — mục đã tích mà đang bị lọc ẩn không bị xoá/gắn thẻ nhầm.
  const visible = new Set(shown.map((o) => o.uid));
  const items = pickedEntries(entries, new Set([...picked].filter((i) => visible.has(i))));
  async function run(path, body, done) {
    setBusy(true);
    try { const r = await api(`/api/admin/agent-memory/${target}/${path}`, { method: 'POST', body }); onPick(new Set()); onSaved(r, done(r.count)); } catch (e) { onError(e.message); } finally { setBusy(false); }
  }
  const remove = () => { if (confirm(`Xoá ${items.length} mục? Không hoàn tác được.`)) run('bulk-delete', { items }, (n) => `Đã xoá ${n} mục.`); };
  return html`<${BulkBar} shown=${shown} picked=${picked} onPick=${onPick} unit="mục">
    ${tags.length ? html`<label class="sr-only" for=${`bulk-tag-${target}`}>Loại cần gắn</label>
      <select id=${`bulk-tag-${target}`} class="bulk-select" value=${tag} onChange=${(e) => setTag(e.currentTarget.value)}>
        <option value="">Chọn loại…</option>
        ${tags.map((t) => html`<option key=${t.label} value=${t.label}>${t.label}</option>`)}</select>
      <button type="button" class="btn btn-secondary btn-sm" disabled=${busy || !tag}
        onClick=${() => run('bulk-tag', { items, tag }, (n) => `Đã gắn loại "${tag}" cho ${n} mục.`)}>Gắn thẻ</button>` : null}
    <button type="button" class="btn btn-danger-outline btn-sm" disabled=${busy} onClick=${remove}>Xoá ${items.length} mục</button>
  <//>`;
}

export function AgentMemory() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [open, setOpen] = useState(null); // { kind: 'entry'|'tags'|'organize', target?, entry? }
  const [filter, setFilter] = useState('all');
  // Chế độ "Chọn nhiều" theo từng tệp: { user?: Set chỉ số, memory?: Set } — không có khoá = tắt.
  const [bulk, setBulk] = useState({});
  const refresh = () => api('/api/admin/agent-memory').then(setData).catch((e) => setError(e.message));
  useEffect(() => { refresh(); }, []);
  const saved = (r, text) => {
    setData(r); setOpen(null); setOk(text); setError('');
    setBulk((b) => Object.fromEntries(Object.keys(b).map((k) => [k, new Set()])));
    if (r.autoTagging) { setTimeout(refresh, 8000); setTimeout(refresh, 20000); }
  };
  const tags = data?.tags || [];
  const all = data ? [...data.user.entries, ...data.memory.entries] : [];
  const counts = tagCounts(all);
  const shown = (e) => filter === 'all' || (filter === 'none' ? !splitTag(e).tag : splitTag(e).tag === filter);
  const labels = data ? { user: data.user.label, memory: data.memory.label } : {};
  return html`<section class="card">
    <div class="toolbar"><h2>Bộ nhớ của trợ lý <span class="badge">Quản trị</span></h2>
      ${data?.tags ? html`<button type="button" class="btn btn-secondary btn-sm" onClick=${() => setOpen({ kind: 'tags' })}><${Icon} name="settings" size=${14} /> Loại thẻ</button>` : null}</div>
    <p class="muted small">Những thông tin trợ lý luôn nhớ ở mọi cuộc trò chuyện — mỗi thẻ một ý. Bấm một thẻ để sửa hoặc xoá. Bot tự ghi nhớ thì AI tự tách và gắn loại.</p>
    <${Live} error=${error} ok=${ok} />
    ${!data && !error ? html`<${Spinner} />` : null}
    ${data?.tags && all.length ? html`<div class="chips mtag-filter" role="group" aria-label="Lọc theo loại">
      <button type="button" class="chip" aria-pressed=${filter === 'all'} onClick=${() => setFilter('all')}>Tất cả (${all.length})</button>
      ${tags.filter((t) => counts.get(t.label)).map((t) => html`<button key=${t.label} type="button" class=${`chip mtag-chip mtag-${t.color}`} aria-pressed=${filter === t.label} onClick=${() => setFilter(t.label)}>${t.label} (${counts.get(t.label)})</button>`)}
      ${counts.get(null) ? html`<button type="button" class="chip" aria-pressed=${filter === 'none'} onClick=${() => setFilter('none')}>Chưa phân loại (${counts.get(null)})</button>` : null}
    </div>` : null}
    ${data ? ['user', 'memory'].map((t) => html`<div key=${t} class="mem-block">
      <div class="toolbar"><h3>${data[t].label} <small class="muted">${usageText(data[t].used, data[t].limit)}</small></h3>
        <span class="toolbar-actions">
          ${data[t].entries.length > 1 ? html`<button type="button" class="btn btn-ghost btn-sm" aria-pressed=${bulk[t] ? 'true' : 'false'}
            onClick=${() => setBulk((b) => { const { [t]: on, ...rest } = b; return on ? rest : { ...b, [t]: new Set() }; })}>${bulk[t] ? 'Xong' : 'Chọn nhiều'}</button>` : null}
          ${data.tags && data[t].entries.length ? html`<button type="button" class="btn btn-secondary btn-sm" onClick=${() => setOpen({ kind: 'organize', target: t })}><${Icon} name="brain" size=${14} /> Sắp xếp lại bằng AI</button>` : null}
          <button type="button" class="btn btn-secondary btn-sm" onClick=${() => setOpen({ kind: 'entry', target: t, entry: null })}><${Icon} name="plus" size=${14} /> Thêm điều cần nhớ</button></span></div>
      <progress class="mem-usage" max=${data[t].limit} value=${Math.min(data[t].used, data[t].limit)} aria-label=${`Dung lượng ${data[t].label}`}></progress>
      ${data[t].entries.length ? null : html`<p class="muted">Chưa có điều nào.</p>`}
      ${bulk[t] ? html`<${BulkMem} target=${t} entries=${data[t].entries} tags=${data.tags || []} picked=${bulk[t]}
        shown=${data[t].entries.flatMap((text, i) => (shown(text) ? [{ uid: i }] : []))}
        onPick=${(p) => setBulk((b) => ({ ...b, [t]: p }))} onSaved=${saved} onError=${(m) => { setError(m); setOk(''); }} />` : null}
      <ul class="mem-list">${data[t].entries.map((text, i) => (shown(text) ? html`<li key=${`${t}-${i}-${text.length}`} class=${bulk[t] ? 'mem-pick' : null}>
        ${bulk[t] ? html`<input type="checkbox" class="bulk-check" checked=${bulk[t].has(i)} aria-label=${`Chọn mục ${i + 1}`}
          onChange=${() => setBulk((b) => ({ ...b, [t]: flip(b[t], i) }))} />` : null}
        <button type="button" class="mem-line" onClick=${() => setOpen({ kind: 'entry', target: t, entry: { index: i, text } })}>
          ${data.tags ? html`<${TagBadge} tags=${tags} tag=${splitTag(text).tag} /> ` : null}${data.tags ? splitTag(text).text : text}</button></li>` : null))}</ul>
    </div>`) : null}
    ${data?.tags ? html`<${History} tags=${tags} labels=${labels} onChanged=${saved} />` : null}
    ${open?.kind === 'entry' ? html`<${EntryDialog} target=${open.target} label=${data[open.target].label} entry=${open.entry} tags=${tags} onSaved=${saved} onClose=${() => setOpen(null)} />` : null}
    ${open?.kind === 'tags' ? html`<${TagsDialog} tags=${tags} onSaved=${saved} onClose=${() => setOpen(null)} />` : null}
    ${open?.kind === 'organize' ? html`<${OrganizeDialog} target=${open.target} label=${data[open.target].label} tags=${tags} onSaved=${saved} onClose=${() => setOpen(null)} />` : null}
  </section>`;
}
