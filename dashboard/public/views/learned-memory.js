// Kho tri thức tự học (spec §19.6, Quản trị + Chủ bot; kho DM chủ nhân, chu kỳ rút và "Rút ngay" chỉ Quản trị):
// trợ lý tự rút ra từ các cuộc trò chuyện, tách theo nhóm/người.
// Hiện trong trang Trí nhớ; xem, tìm, sửa, xoá từng mục, hoặc "Quên" cả một nhóm/người.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Icon, Live, Notice, Spinner } from '../ui.js';
import { BulkBar, bulkMessage, flip, stillPicked } from './multi-pick.js';

const CATEGORY = {
  'profile.md': 'Hồ sơ', preferences: 'Sở thích, cách xưng hô', entities: 'Người, việc, đồ vật', events: 'Sự việc',
  cases: 'Tình huống đã gặp', patterns: 'Cách làm quen thuộc', tools: 'Cách dùng công cụ', skills: 'Kỹ năng',
};

/** Nhãn một phạm vi: tên nhóm/người, hoặc "Nhóm/Người chưa rõ tên"; chủ nhân có thêm "(chủ nhân)". */
export function scopeLabel(s) {
  const base = s.name || `${s.kind === 'group' ? 'Nhóm' : 'Người'} chưa rõ tên`;
  return s.owner ? `${base} (chủ nhân)` : base;
}

/** Tên dễ đọc của một mục: nhóm trí nhớ quen thuộc thì dịch, còn lại là phần cuối URI bỏ ".md". */
export function entryLabel(uri) {
  const last = String(uri).replace(/\/+$/, '').split('/').pop() || '';
  return CATEGORY[last] || last.replace(/\.md$/, '');
}

function Item({ scope, uri, onChanged }) {
  const [text, setText] = useState(null);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState({});
  const q = (o) => new URLSearchParams(o);
  useEffect(() => { api(`/api/learned-memory/${scope}/read?${q({ uri })}`).then((r) => setText(r.text)).catch((e) => setMsg({ error: e.message })); }, [uri]);
  async function save() {
    try { await api(`/api/learned-memory/${scope}/item`, { method: 'PUT', body: { uri, text: draft } }); setText(draft); setDraft(null); setMsg({ ok: 'Đã lưu — có hiệu lực từ lượt trò chuyện sau.' }); } catch (e) { setMsg({ error: e.message }); }
  }
  async function remove() {
    if (!confirm('Xoá mục trí nhớ này? Trợ lý sẽ không còn nhớ điều này nữa.')) return;
    try { await api(`/api/learned-memory/${scope}/item`, { method: 'DELETE', body: { uri } }); onChanged('Đã xoá mục trí nhớ.'); } catch (e) { setMsg({ error: e.message }); }
  }
  return html`<div class="mem-block">
    <p class="muted small mono">${uri}</p>
    <${Live} error=${msg.error} ok=${msg.ok} />
    ${text === null && !msg.error ? html`<${Spinner} />` : null}
    ${text !== null && draft === null ? html`<pre class="sb-text">${text}</pre>
      <div class="row form-end">
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => setDraft(text)}>Sửa</button>
        <button type="button" class="btn btn-danger-outline btn-sm" onClick=${remove}>Xoá</button></div>` : null}
    ${draft !== null ? html`<label class="sr-only" for="lm-edit">Nội dung mục trí nhớ</label>
      <textarea id="lm-edit" rows="6" maxlength="8000" value=${draft} onInput=${(e) => setDraft(e.currentTarget.value)}></textarea>
      <div class="row form-end">
        <button type="button" class="btn btn-primary btn-sm" disabled=${!draft.trim()} onClick=${save}>Lưu</button>
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => setDraft(null)}>Huỷ</button></div>` : null}
  </div>`;
}

/** Chữ mô tả chu kỳ rút: "120 phút (2 giờ)". */
export function intervalText(minutes) {
  const m = Number(minutes) || 0;
  if (m < 60 || m % 60) return `${m} phút`;
  return `${m} phút (${m / 60} giờ)`;
}

function IntervalForm({ settings, onSaved }) {
  const [value, setValue] = useState(String(settings.extractMinutes));
  const [msg, setMsg] = useState({});
  async function save(e) {
    e.preventDefault(); setMsg({});
    try { const r = await api('/api/learned-memory/settings', { method: 'PUT', body: { extractMinutes: Number(value) } }); onSaved(r.settings); setMsg({ ok: `Đã lưu — trợ lý rút trí nhớ mỗi ${intervalText(r.settings.extractMinutes)}, áp dụng ngay.` }); } catch (err) { setMsg({ error: err.message }); }
  }
  return html`<form class="toolbar" onSubmit=${save} novalidate>
    <label for="lm-interval">Rút trí nhớ mỗi (phút, ${settings.min}–${settings.max})</label>
    <input id="lm-interval" type="number" inputmode="numeric" min=${settings.min} max=${settings.max} step="10" value=${value} onInput=${(e) => setValue(e.currentTarget.value)} />
    <button class="btn btn-secondary btn-sm">Lưu chu kỳ</button>
    <${Live} error=${msg.error} ok=${msg.ok} />
  </form>`;
}

function ScopeView({ s, canAdmin, onForgotten }) {
  const root = `viking://user/${s.scope}/memories`;
  const [cwd, setCwd] = useState(root);
  const [entries, setEntries] = useState(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [open, setOpen] = useState('');
  const [msg, setMsg] = useState({});
  const [tick, setTick] = useState(0);
  // Chế độ "Chọn nhiều": Set URI tệp đã tích, null = tắt.
  const [bulk, setBulk] = useState(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/learned-memory/${s.scope}`;
  useEffect(() => { setEntries(null); api(`${base}/list?${new URLSearchParams({ uri: cwd })}`).then((r) => setEntries(r.entries)).catch((e) => setMsg({ error: e.message })); }, [cwd, tick]);
  async function search(e) {
    e.preventDefault(); setMsg({});
    try { setHits((await api(`${base}/search?${new URLSearchParams({ q })}`)).hits); } catch (err) { setMsg({ error: err.message }); }
  }
  async function forget() {
    if (!confirm(`Quên toàn bộ những gì trợ lý tự học về "${scopeLabel(s)}"? Không khôi phục được. Lịch sử tin nhắn Zalo không bị ảnh hưởng.`)) return;
    try { await api(base, { method: 'DELETE' }); onForgotten(`Đã xoá toàn bộ trí nhớ tự học của ${scopeLabel(s)}.`); } catch (err) { setMsg({ error: err.message }); }
  }
  async function extractNow() {
    setMsg({});
    try {
      const r = await api(`${base}/extract`, { method: 'POST' });
      setMsg({ ok: r.committed ? `Đã gửi ${r.committed} phiên đi rút — mục mới hiện sau khoảng 1–2 phút (còn ${r.left} lần hôm nay).` : 'Không có tin nào chờ rút ở kho này.' });
    } catch (err) { setMsg({ error: err.message }); }
  }
  async function removeMany(uris) {
    if (!confirm(`Xoá ${uris.length} mục? Không hoàn tác được.`)) return;
    setBusy(true); setMsg({});
    try {
      const r = await api(`${base}/bulk-delete`, { method: 'POST', body: { uris } });
      setBulk(new Set()); setOpen(''); setHits(null); setTick(tick + 1);
      setMsg(bulkMessage(r, { name: (f) => entryLabel(f.uri) }));
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }
  const files = (entries || []).filter((e) => !e.dir).map((e) => ({ uid: e.uri }));
  const sel = bulk ? stillPicked(bulk, files) : [];
  const changed = (text) => { setOpen(''); setHits(null); setMsg({ ok: text }); setTick(tick + 1); };
  return html`<div>
    <${Live} error=${msg.error} ok=${msg.ok} />
    <form class="toolbar" onSubmit=${search}><label class="sr-only" for="lm-q">Tìm trong trí nhớ của ${scopeLabel(s)}</label>
      <input id="lm-q" type="search" placeholder="Tìm theo ý nghĩa, vd. 'lịch họp tổ'" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      <button class="btn btn-primary btn-sm"><${Icon} name="search" size=${16} /> Tìm</button>
      ${canAdmin ? html`<button type="button" class="btn btn-secondary btn-sm" onClick=${extractNow}>Rút trí nhớ ngay</button>` : null}
      <button type="button" class="btn btn-danger-outline btn-sm" onClick=${forget}>Quên nhóm/người này</button></form>
    ${hits ? html`<ul class="row-list">${hits.length ? hits.map((h) => html`<li key=${h.uri} class="row-item">
      <span class="row-main"><button type="button" class="link-btn" onClick=${() => setOpen(h.uri)}>${entryLabel(h.uri)}</button><small class="muted">${h.abstract}</small></span>
      <span class="badge">${Math.round(h.score * 100)}%</span></li>`) : html`<li class="muted">Không thấy gì.</li>`}</ul>` : null}
    ${open ? html`<${Item} key=${open} scope=${s.scope} uri=${open} onChanged=${changed} />` : null}
    <div class="toolbar">${cwd !== root ? html`<button type="button" class="btn btn-secondary btn-sm" onClick=${() => setCwd(cwd.replace(/\/[^/]+\/?$/, '').length < root.length ? root : cwd.replace(/\/[^/]+\/?$/, ''))}><${Icon} name="prev" size=${14} /> Lên</button>` : null}
      <span class="muted small">${cwd === root ? 'Tất cả mục' : entryLabel(cwd)}</span>
      ${files.length > 1 ? html`<button type="button" class="btn btn-ghost btn-sm" aria-pressed=${bulk ? 'true' : 'false'} onClick=${() => setBulk(bulk ? null : new Set())}>${bulk ? 'Xong' : 'Chọn nhiều'}</button>` : null}</div>
    ${bulk && files.length ? html`<${BulkBar} shown=${files} picked=${new Set(sel)} onPick=${setBulk} unit="mục">
      <button type="button" class="btn btn-danger-outline btn-sm" disabled=${busy} onClick=${() => removeMany(sel)}>Xoá ${sel.length} mục</button><//>` : null}
    ${!entries && !msg.error ? html`<${Spinner} />` : null}
    ${entries && !entries.length ? html`<p class="muted">${cwd === root ? 'Chưa tự học được gì.' : 'Chưa có gì ở đây.'}</p>` : null}
    <ul class="row-list">${(entries || []).map((e) => html`<li key=${e.uri} class="row-item">
      ${bulk && !e.dir ? html`<input type="checkbox" class="bulk-check" checked=${bulk.has(e.uri)} disabled=${busy}
        aria-label=${`Chọn ${entryLabel(e.uri)}`} onChange=${() => setBulk(flip(bulk, e.uri))} />` : null}
      <${Icon} name=${e.dir ? 'list' : 'file'} />
      <span class="row-main"><button type="button" class="link-btn" onClick=${() => (e.dir ? setCwd(e.uri) : setOpen(e.uri))}>${entryLabel(e.uri)}</button>
        ${e.abstract ? html`<small class="muted">${e.abstract}</small>` : null}</span>
      ${e.modTime ? html`<small class="muted">${fmtTime(Date.parse(e.modTime))}</small>` : null}</li>`)}</ul>
  </div>`;
}

export function LearnedMemory() {
  const [st, setSt] = useState(null);
  const [scopes, setScopes] = useState(null);
  const [pick, setPick] = useState('');
  const [msg, setMsg] = useState({});
  const load = () => api('/api/learned-memory/scopes').then((r) => { setScopes(r.scopes); if (!r.scopes.some((s) => s.scope === pick)) setPick(r.scopes[0]?.scope || ''); }).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { api('/api/learned-memory/status').then((s) => { setSt(s); if (s.enabled) load(); }).catch((e) => setMsg({ error: e.message })); }, []);
  const current = (scopes || []).find((s) => s.scope === pick);
  const minutes = st?.settings?.extractMinutes;
  return html`<section class="card">
    <h2>Kho tri thức tự học</h2>
    <p class="muted small">Trợ lý tự rút ra điều đáng nhớ từ các cuộc trò chuyện (mỗi ${intervalText(minutes)}) — tách riêng từng nhóm, từng người; nhóm này không bao giờ thấy trí nhớ của nhóm khác hay tin nhắn riêng. Khác Kho tri thức (tài liệu bạn tải lên). Hỏi "hôm trước ai nói gì" thì trợ lý tra lịch sử tin nhắn thật, không dựa vào đây.${st?.canAdmin ? ' Trí nhớ tin nhắn riêng của chủ nhân bot chỉ Quản trị thấy.' : ''}</p>
    <${Live} error=${msg.error} ok=${msg.ok} />
    ${!st && !msg.error ? html`<${Spinner} />` : null}
    ${st && !st.enabled ? html`<${Notice} kind="info">${st.note}<//>` : null}
    ${st?.enabled && st.canAdmin ? html`<${IntervalForm} settings=${st.settings} onSaved=${(settings) => setSt({ ...st, settings })} />` : null}
    ${st?.enabled && scopes && !scopes.length ? html`<p class="muted">Trợ lý chưa tự học được gì — trí nhớ xuất hiện sau chu kỳ rút đầu tiên (${intervalText(minutes)}).</p>` : null}
    ${scopes?.length ? html`<div class="field"><label for="lm-scope">Nhóm hoặc người</label>
      <select id="lm-scope" value=${pick} onChange=${(e) => { setMsg({}); setPick(e.currentTarget.value); }}>
        ${scopes.map((s) => html`<option key=${s.scope} value=${s.scope}>${s.kind === 'group' ? 'Nhóm: ' : 'Nhắn riêng: '}${scopeLabel(s)}</option>`)}
      </select></div>` : null}
    ${current ? html`<${ScopeView} key=${current.scope} s=${current} canAdmin=${Boolean(st?.canAdmin)} onForgotten=${(text) => { setMsg({ ok: text }); load(); }} />` : null}
  </section>`;
}
