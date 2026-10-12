// Trí nhớ (spec §18.5) cho người không rành kỹ thuật: Sổ người quen thành THẺ NGƯỜI (thông tin dạng nhãn "Lớp: 12A1",
// kèm nơi bot được dùng — Sổ người quen theo nơi ghi), bấm thẻ để sửa trong cửa sổ có nút gợi ý; bộ nhớ của trợ lý
// (chỉ Quản trị) là danh sách câu thường, có nút thêm/sửa/xoá. Kho tri thức tự học ở cuối.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { Dialog, html, fmtTime, Icon, Live, PageHead, Spinner } from '../ui.js';
import { LearnedMemory } from './learned-memory.js';

/** Gợi ý tên mục hay dùng — bấm là thêm dòng, khỏi nghĩ tên. */
export const FIELD_PRESETS = ['Xưng hô', 'Chức vụ', 'Lớp', 'Môn dạy', 'Đơn vị', 'Sở thích', 'Ngày sinh'];

/** Lựa chọn "Dùng ở" mặc định của mục đang có: theo máy chủ, thiếu thì suy từ nơi dùng. */
const useFrom = (use, places) => use || (places?.length ? 'keep' : 'dm');

/** Bản nháp sửa hồ sơ (không còn dòng trống thừa — thêm bằng nút). */
export function personDraft(p) {
  return { name: p?.name || '', note: p?.note || '', noteUse: useFrom(p?.noteUse, p?.notePlaces),
    fields: (p?.fields || []).map((f) => ({ key: f.key, value: f.value, places: f.places || [], use: useFrom(f.use, f.places) })) };
}

/** Thân PUT /api/people/:uid — bỏ dòng thông tin thêm trống hoàn toàn; kèm "Dùng ở" của từng mục. */
export function personPayload(d, updatedAt) {
  const out = { name: d.name, note: d.note, noteUse: d.noteUse || 'keep',
    fields: d.fields.filter((f) => f.key.trim() || f.value.trim()).map(({ key, value, use }) => ({ key, value, use: use || 'keep' })) };
  if (updatedAt !== undefined) out.updatedAt = updatedAt;   // mốc sửa khách đã thấy: bot sửa sau đó thì server trả 409
  return out;
}

/** "1.234/2.200 ký tự (56 %)" cho thanh dung lượng bộ nhớ. */
export function usageText(used, limit) {
  const n = new Intl.NumberFormat('vi-VN');
  return `${n.format(used)}/${n.format(limit)} ký tự (${limit ? Math.min(100, Math.round((used / limit) * 100)) : 0} %)`;
}

/** Nhãn "dùng ở đâu" của một mục: danh sách nơi, rỗng = chỉ khi nhắn riêng với chính người đó. */
export const placesText = (places) => (places && places.length ? places.join(', ') : 'Chỉ khi nhắn riêng');

/**
 * Ô "Dùng ở" của một mục hồ sơ: Mọi nơi / Chỉ khi người này nhắn riêng / Như cũ (nơi bot đã nghe người đó nói —
 * chỉ có khi mục chưa đổi nội dung và bot đã nghe ở nhóm nào đó).
 */
function UseSelect({ use, keepPlaces, label, onChange }) {
  const canKeep = keepPlaces && keepPlaces.length && !keepPlaces.includes('Mọi nơi');
  return html`<label class="mem-use"><span class="muted small">Dùng ở</span>
    <select aria-label=${`Bot dùng ${label} ở đâu`} value=${use === 'keep' && !canKeep ? 'dm' : use} onChange=${(e) => onChange(e.currentTarget.value)}>
      <option value="all">Mọi nơi (mọi nhóm và nhắn riêng)</option>
      <option value="dm">Chỉ khi người này nhắn riêng</option>
      ${canKeep ? html`<option value="keep">Như cũ: ${keepPlaces.join(', ')}</option>` : null}
    </select></label>`;
}

function PersonDialog({ person, onDone, onStale, onClose }) {
  const [d, setD] = useState(personDraft(person));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const original = JSON.stringify(personPayload(personDraft(person)));
  const dirty = () => !busy && JSON.stringify(personPayload(d)) !== original;
  // Đổi tên mục hoặc nội dung → nơi bot đã nghe không còn đúng: "Như cũ" chuyển thành "Mọi nơi" (anh tự đổi được).
  const setField = (i, patch) => setD({ ...d, fields: d.fields.map((f, j) => (j === i
    ? { ...f, ...patch, places: [], use: f.use === 'keep' ? 'all' : f.use } : f)) });
  const setUse = (i, use) => setD({ ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, use } : f)) });
  const origField = (f) => (person.fields || []).find((o) => o.key === f.key && o.value === f.value);
  const addField = (key = '') => setD({ ...d, fields: [...d.fields, { key, value: '', places: [], use: 'all' }] });
  async function save(e) {
    e.preventDefault(); setBusy(true); setMsg('');
    try { await api(`/api/people/${person.uid}`, { method: 'PUT', body: personPayload(d, person.updatedAt ?? null) }); onDone('Đã lưu hồ sơ.'); } catch (err) { if (err.status === 409) onStale(err.message); else { setMsg(err.message); setBusy(false); } }
  }
  async function remove() {
    if (!confirm(`Xoá hồ sơ của ${person.name || person.uid}? Bot sẽ không còn nhớ người này.`)) return;
    setBusy(true); setMsg('');
    try { await api(`/api/people/${person.uid}`, { method: 'DELETE', body: { updatedAt: person.updatedAt ?? null } }); onDone('Đã xoá hồ sơ.'); } catch (err) { if (err.status === 409) onStale(err.message); else { setMsg(err.message); setBusy(false); } }
  }
  const used = new Set(d.fields.map((f) => f.key.trim().toLowerCase()));
  const presets = FIELD_PRESETS.filter((p) => !used.has(p.toLowerCase()));
  return html`<${Dialog} title=${person.name || 'Hồ sơ'} onClose=${onClose} dirty=${dirty} wide>
    <form class="stack" onSubmit=${save} novalidate>
      <label class="field"><span>Tên gọi</span><input maxlength="80" value=${d.name} placeholder="Ví dụ: Cô Lan" onInput=${(e) => setD({ ...d, name: e.currentTarget.value })} /></label>
      <label class="field"><span>Ghi chú</span><textarea maxlength="400" rows="2" value=${d.note} placeholder="Ví dụ: Giáo viên chủ nhiệm 12A1, thích được gọi là cô"
        onInput=${(e) => setD({ ...d, note: e.currentTarget.value, noteUse: d.noteUse === 'keep' ? 'all' : d.noteUse })}></textarea></label>
      ${d.note ? html`<${UseSelect} use=${d.noteUse} label="ghi chú" keepPlaces=${person.note && d.note === person.note ? person.notePlaces : null}
        onChange=${(noteUse) => setD({ ...d, noteUse })} />` : null}
      <fieldset class="field"><legend>Thông tin thêm <small class="muted">(tối đa 12)</small></legend>
        ${d.fields.length ? null : html`<p class="muted small">Chưa có — bấm một gợi ý bên dưới để thêm.</p>`}
        ${d.fields.map((f, i) => html`<div class="mem-field" key=${i}>
          <input aria-label="Tên mục" placeholder="Tên mục" maxlength="40" value=${f.key} onInput=${(e) => setField(i, { key: e.currentTarget.value })} />
          <input aria-label=${`Nội dung ${f.key || 'mục'}`} placeholder="Nội dung" maxlength="120" value=${f.value} onInput=${(e) => setField(i, { value: e.currentTarget.value })} />
          <button type="button" class="btn btn-ghost btn-sm" aria-label=${`Bỏ ${f.key || 'mục này'}`} onClick=${() => setD({ ...d, fields: d.fields.filter((_, j) => j !== i) })}><${Icon} name="close" size=${14} /></button>
          ${f.key || f.value ? html`<${UseSelect} use=${f.use} label=${f.key || 'mục này'} keepPlaces=${origField(f)?.places || null} onChange=${(use) => setUse(i, use)} />` : null}
        </div>`)}
        ${d.fields.length < 12 ? html`<div class="chips">${presets.map((p) => html`<button type="button" key=${p} class="btn btn-secondary btn-sm chip" onClick=${() => addField(p)}><${Icon} name="plus" size=${12} /> ${p}</button>`)}
          <button type="button" class="btn btn-secondary btn-sm chip" onClick=${() => addField('')}><${Icon} name="plus" size=${12} /> Mục khác</button></div>` : null}
      </fieldset>
      <p class="muted small">Sửa lần cuối ${fmtTime(person.updatedAt)}${person.updatedBy.startsWith('dashboard:') ? ` trên dashboard (${person.updatedBy.slice(10)})` : ' bởi bot'}. Mỗi mục chọn được bot dùng ở đâu: <strong>Mọi nơi</strong>, <strong>chỉ khi người này nhắn riêng</strong>, hoặc <strong>như cũ</strong> (đúng nhóm bot đã nghe người đó nói). Thông tin riêng tư (tài sản, gia đình…) nên để "chỉ khi nhắn riêng".</p>
      <${Live} error=${msg} />
      <div class="dialog-actions">
        <button class="btn btn-primary" disabled=${busy}>${busy ? 'Đang lưu…' : 'Lưu'}</button>
        <button type="button" class="btn btn-danger-outline" disabled=${busy} onClick=${remove}>Xoá hồ sơ</button>
      </div>
    </form>
  <//>`;
}

function People() {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState({});
  const [open, setOpen] = useState(null);
  const load = () => api(`/api/people?${new URLSearchParams({ q })}`).then((r) => setData(r)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { const id = setTimeout(load, 250); return () => clearTimeout(id); }, [q]);
  const done = (text) => { setOpen(null); setMsg(text ? { ok: text } : {}); load(); };
  const stale = (text) => { setOpen(null); setMsg({ error: text }); load(); };   // bot vừa sửa hồ sơ: đóng cửa sổ, tải lại
  return html`<section class="card">
    <div class="toolbar"><h2>Sổ người quen</h2>
      <label class="sr-only" for="people-q">Tìm hồ sơ</label>
      <input id="people-q" type="search" placeholder="Tìm theo tên, lớp, chức vụ…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      ${data ? html`<small class="muted">${data.total} người</small>` : null}</div>
    <p class="muted small">Bot tự ghi khi được dặn "nhớ giúp…" (lời tự khai — không dùng để cấp quyền). Bấm vào thẻ để sửa; có hiệu lực từ tin nhắn sau.</p>
    <${Live} error=${msg.error} ok=${msg.ok} />
    ${!data && !msg.error ? html`<${Spinner} />` : null}
    ${data && !data.people.length ? html`<p class="muted">${data.total ? 'Không có ai khớp.' : 'Bot chưa nhớ ai.'}</p>` : null}
    <div class="person-grid">${(data?.people || []).map((p) => html`<button type="button" key=${p.uid} class="person-card" onClick=${() => setOpen(p)}>
      <strong>${p.name || 'Chưa rõ tên'}</strong>
      ${p.note ? html`<span class="person-note">${p.note}</span>` : null}
      ${p.fields.length ? html`<span class="chips">${p.fields.slice(0, 6).map((f) => html`<span key=${f.key} class="tag" title=${`Dùng ở: ${placesText(f.places)}`}>${f.key}: ${f.value}</span>`)}${p.fields.length > 6 ? html`<span class="tag">+${p.fields.length - 6}</span>` : null}</span>` : null}
      <small class="muted">Sửa ${fmtTime(p.updatedAt)}</small>
    </button>`)}</div>
    ${open ? html`<${PersonDialog} person=${open} onDone=${done} onStale=${stale} onClose=${() => setOpen(null)} />` : null}
  </section>`;
}

/** Cửa sổ thêm/sửa một điều trợ lý cần nhớ. */
function EntryDialog({ target, label, entry, onSaved, onClose }) {
  const [text, setText] = useState(entry?.text || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = entry ? await api(`/api/admin/agent-memory/${target}/${entry.index}`, { method: 'PUT', body: { old: entry.text, text } })
        : await api(`/api/admin/agent-memory/${target}`, { method: 'POST', body: { text } });
      onSaved(r, entry ? 'Đã lưu.' : 'Đã thêm.');
    } catch (err) { setError(err.message); setBusy(false); }
  }
  async function remove() {
    if (!confirm('Xoá điều này khỏi bộ nhớ của trợ lý?')) return;
    setBusy(true); setError('');
    try { onSaved(await api(`/api/admin/agent-memory/${target}/${entry.index}`, { method: 'DELETE', body: { old: entry.text } }), 'Đã xoá.'); } catch (err) { setError(err.message); setBusy(false); }
  }
  return html`<${Dialog} title=${entry ? `Sửa — ${label}` : `Thêm vào ${label}`} onClose=${onClose} dirty=${() => !busy && text !== (entry?.text || '')} wide>
    <form class="stack" onSubmit=${save}>
      <label class="field"><span>Điều trợ lý cần nhớ</span>
        <textarea rows="5" required value=${text} placeholder="Ví dụ: Chủ nhân dạy Hoá, thích câu trả lời ngắn gọn có gạch đầu dòng." onInput=${(e) => setText(e.currentTarget.value)}></textarea>
        <small class="muted">Viết như dặn một người trợ lý: một ý, rõ ràng. Áp dụng từ phiên trò chuyện mới.</small></label>
      <${Live} error=${error} />
      <div class="dialog-actions">
        <button class="btn btn-primary" disabled=${busy || !text.trim()}>${busy ? 'Đang lưu…' : entry ? 'Lưu' : 'Thêm'}</button>
        ${entry ? html`<button type="button" class="btn btn-danger-outline" disabled=${busy} onClick=${remove}>Xoá</button>` : null}
      </div>
    </form>
  <//>`;
}

function AgentMemory() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [open, setOpen] = useState(null); // { target, entry|null }
  useEffect(() => { api('/api/admin/agent-memory').then(setData).catch((e) => setError(e.message)); }, []);
  const saved = (r, text) => { setData(r); setOpen(null); setOk(text); };
  return html`<section class="card">
    <h2>Bộ nhớ của trợ lý <span class="badge">Quản trị</span></h2>
    <p class="muted small">Những điều trợ lý luôn nhớ ở mọi cuộc trò chuyện. Bấm một dòng để sửa hoặc xoá.</p>
    <${Live} error=${error} ok=${ok} />
    ${!data && !error ? html`<${Spinner} />` : null}
    ${data ? ['user', 'memory'].map((t) => html`<div key=${t} class="mem-block">
      <div class="toolbar"><h3>${data[t].label} <small class="muted">${usageText(data[t].used, data[t].limit)}</small></h3>
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => setOpen({ target: t, entry: null })}><${Icon} name="plus" size=${14} /> Thêm điều cần nhớ</button></div>
      <progress class="mem-usage" max=${data[t].limit} value=${Math.min(data[t].used, data[t].limit)} aria-label=${`Dung lượng ${data[t].label}`}></progress>
      ${data[t].entries.length ? null : html`<p class="muted">Chưa có điều nào.</p>`}
      <ul class="mem-list">${data[t].entries.map((text, i) => html`<li key=${`${t}-${i}-${text.length}`}>
        <button type="button" class="mem-line" onClick=${() => setOpen({ target: t, entry: { index: i, text } })}>${text}</button></li>`)}</ul>
    </div>`) : null}
    ${open ? html`<${EntryDialog} target=${open.target} label=${data[open.target].label} entry=${open.entry} onSaved=${saved} onClose=${() => setOpen(null)} />` : null}
  </section>`;
}

export function Memory({ me }) {
  return html`<${PageHead} title="Trí nhớ" sub="Những gì bot nhớ về mọi người và về chủ nhân." />
    <${People} />
    ${me?.role === 'admin' ? html`<${AgentMemory} />` : null}
    <${LearnedMemory} />
    <p class="muted small"><${Icon} name="info" size=${14} /> Tài liệu dài để bot tra cứu nằm ở Kho tri thức.</p>`;
}
