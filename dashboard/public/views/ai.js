// Khoá API & Model (chỉ Quản trị): mỗi chức năng dùng AI một thẻ (model gì, qua đâu, nút Thử, đổi model chính);
// mỗi khoá dịch vụ một dòng (dùng cho gì, đã đặt chưa ••••1234, Kiểm tra, Thay khoá — không bao giờ hiện khoá cũ).
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { Dialog, html, Icon, Live, PageHead, Spinner } from '../ui.js';
import { fold } from '../fold.js';
import { RestartBanner } from './restart-banner.js';
import { modelOptions } from './agent.js';
import { FreeApis } from './free-apis.js';

const fmtMs = (ms) => (ms < 1000 ? `${ms} ms` : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(ms / 1000)} giây`);

/** Câu kết quả "Thử"/"Kiểm tra": ✓ … (1,2 giây) / ✗ … */
export function resultText(r) {
  if (!r) return '';
  return r.ok ? `Được — ${r.reply ? `"${r.reply}"` : r.detail} (${fmtMs(r.ms)})` : `Không được — ${r.detail}`;
}

function Models({ onRestart }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [tests, setTests] = useState({});
  const [msg, setMsg] = useState({});
  useEffect(() => { api('/api/admin/ai/models').then(setData).catch((e) => setMsg({ error: e.message })); }, []);
  async function test(id, model) {
    setBusy(id); setTests((t) => ({ ...t, [id]: null }));
    try { const r = await api('/api/admin/ai/test', { method: 'POST', body: { model } }); setTests((t) => ({ ...t, [id]: r })); } catch (e) { setTests((t) => ({ ...t, [id]: { ok: false, detail: e.message } })); } finally { setBusy(''); }
  }
  async function setModel(model) {
    setBusy('main'); setMsg({});
    try { const r = await api('/api/admin/ai/model', { method: 'PUT', body: { model } }); setData((d) => ({ ...d, ...r })); setMsg({ ok: `Đã đổi model chính sang ${model} — có hiệu lực từ tin nhắn tiếp theo.` }); onRestart(); } catch (e) { setMsg({ error: e.message }); } finally { setBusy(''); }
  }
  if (!data) return html`<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  const main = data.cards.find((c) => c.id === 'main');
  return html`<${Live} error=${msg.error} ok=${msg.ok} />
    <div class="ai-cards">${data.cards.map((c) => html`<section key=${c.id} class="ai-card">
      <h3>${c.label}</h3>
      <p class="ai-model">${c.model || html`<span class="muted">—</span>`}</p>
      ${c.via ? html`<p class="muted small">Qua: <span class="mono">${c.via}</span></p>` : null}
      ${c.note ? html`<p class="muted small">${c.note}</p>` : null}
      ${c.id === 'main' ? html`<div class="field"><label for="ai-main">Đổi model chính</label>
        <input type="search" placeholder="Lọc, vd. gemini" aria-label="Lọc model" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
        <select id="ai-main" value=${main.model} disabled=${busy !== '' || !data.models.length} onChange=${(e) => setModel(e.currentTarget.value)}>
          ${modelOptions({ current: main.model, choices: data.choices, all: data.models, q }).map((m) => html`<option key=${m} value=${m}>${m}${m === data.defaultModel ? ' (mặc định /model)' : ''}</option>`)}
        </select>
        ${data.listError ? html`<small class="muted">${data.listError}</small>` : html`<small class="muted">Danh sách lấy từ cổng AI (gồm cả combo). Đổi là có hiệu lực ngay, như lệnh /model trong Zalo.</small>`}</div>` : null}
      ${c.testable ? html`<p><button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => test(c.id, c.model)}>${busy === c.id ? 'Đang thử…' : 'Thử'}</button></p>` : null}
      ${tests[c.id] ? html`<p class=${`ai-result ${tests[c.id].ok ? 'is-ok' : 'is-bad'}`} role="status">${resultText(tests[c.id])}</p>` : null}
    </section>`)}</div>
    <p class="muted small"><${Icon} name="info" size=${14} /> Mức suy nghĩ và tính cách của bot nằm ở trang Agent. Giọng đọc, nghe giọng nói, tạo ảnh đặt bằng cấu hình trên máy chủ — nhờ người cài đặt nếu muốn đổi.</p>`;
}

const hhmm = (ms) => new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(ms));

/** Trạng thái một khoá trong danh sách dự phòng. */
export function entryState(e) {
  if (e.active) return { kind: 'ok', text: 'Đang dùng' };
  if (e.coolUntil) return { kind: 'warn', text: `Nghỉ đến ${hhmm(e.coolUntil)}` };
  return { kind: 'idle', text: 'Dự phòng' };
}

/** Cửa sổ quản lý khoá của một dịch vụ: thay khoá đang dùng, danh sách khoá dự phòng (thứ tự = thứ tự đổi khi lỗi). */
function KeyDialog({ row, available, onSaved, onClose }) {
  const [key, setKey] = useState(row?.key || '');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tests, setTests] = useState({});
  const [cur, setCur] = useState(row);
  const keyPath = (k) => `/api/admin/ai/keys/${encodeURIComponent(k)}`;
  const pool = cur?.pool || [];
  async function run(fn, okText, close = false) {
    setBusy(true); setError('');
    try {
      const r = await fn();
      const next = r.keys?.find((x) => x.key === key);
      if (close || !next) onSaved(r, okText); else { setCur(next); onSaved(r, okText, true); }
      setValue(''); setLabel('');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const replace = (e) => { e?.preventDefault(); run(() => api(keyPath(key), { method: 'PUT', body: { value: value.trim() } }), cur?.restart ? 'Đã lưu khoá — khởi động lại trợ lý để áp dụng.' : 'Đã lưu khoá — có hiệu lực ngay từ lần dùng tới.', !row); };
  const addBackup = () => run(() => api(`${keyPath(key)}/pool`, { method: 'POST', body: { value: value.trim(), label } }), 'Đã thêm khoá dự phòng.');
  const remove = () => confirm(`Gỡ hẳn khoá ${cur.label}? Tính năng dùng khoá này sẽ ngừng.`) && run(() => api(keyPath(key), { method: 'PUT', body: { value: '' } }), 'Đã gỡ khoá.', true);
  const act = (id, what, body) => run(() => api(`${keyPath(key)}/pool/${encodeURIComponent(id)}/${what}`, { method: 'POST', body }),
    { activate: 'Đã chuyển sang khoá này — có hiệu lực ngay.', remove: 'Đã xoá khoá khỏi danh sách.', move: 'Đã đổi thứ tự.' }[what]);
  async function test(id) {
    setTests((t) => ({ ...t, [id]: null }));
    try { const r = await api(`${keyPath(key)}/pool/${encodeURIComponent(id)}/test`, { method: 'POST' }); setTests((t) => ({ ...t, [id]: r.result })); } catch (e) { setTests((t) => ({ ...t, [id]: { ok: false, detail: e.message } })); }
  }
  return html`<${Dialog} title=${cur ? `Khoá — ${cur.label}` : 'Thêm khoá dịch vụ'} onClose=${onClose} dirty=${() => !busy && Boolean(value)} wide=${pool.length > 0}>
    <div class="stack">
      ${cur ? html`<p class="muted small">${cur.feature}${cur.restart ? ' · Đổi khoá này cần khởi động lại trợ lý.' : ' · Đổi khoá có hiệu lực ngay, không cần khởi động lại.'}</p>`
        : html`<label class="field"><span>Dịch vụ</span><select value=${key} onChange=${(e) => setKey(e.currentTarget.value)}>
          <option value="">— Chọn dịch vụ —</option>${available.map((a) => html`<option key=${a.key} value=${a.key}>${a.label}</option>`)}</select>
          ${key ? html`<small class="muted">${available.find((a) => a.key === key)?.feature}</small>` : null}</label>`}
      ${pool.length ? html`<div class="field"><span>Danh sách khoá <small class="muted">— lỗi hoặc hết lượt thì tự chuyển sang khoá kế theo thứ tự này</small></span>
        <ol class="key-pool">${pool.map((e, i) => { const st = entryState(e); return html`<li key=${e.id} class="key-entry">
          <span class="key-main"><span class="mono">${e.hint}</span>${e.label ? html` <small class="muted">${e.label}</small>` : null}
            <span class=${`badge badge-${st.kind}`}>${st.text}</span>
            ${e.lastError ? html`<small class="muted key-err">Lỗi gần nhất: ${e.lastError}</small>` : null}
            ${tests[e.id] ? html`<small class=${`ai-result ${tests[e.id].ok ? 'is-ok' : 'is-bad'}`}>${resultText(tests[e.id])}</small>` : null}</span>
          <span class="key-actions">
            <button type="button" class="btn btn-ghost btn-sm" aria-label="Lên trên" disabled=${busy || i === 0} onClick=${() => act(e.id, 'move', { dir: -1 })}>↑</button>
            <button type="button" class="btn btn-ghost btn-sm" aria-label="Xuống dưới" disabled=${busy || i === pool.length - 1} onClick=${() => act(e.id, 'move', { dir: 1 })}>↓</button>
            ${e.active ? null : html`<button type="button" class="btn btn-secondary btn-sm" disabled=${busy} onClick=${() => act(e.id, 'activate')}>Dùng khoá này</button>`}
            ${cur.testable ? html`<button type="button" class="btn btn-secondary btn-sm" disabled=${busy} onClick=${() => test(e.id)}>Kiểm tra</button>` : null}
            ${pool.length > 1 ? html`<button type="button" class="btn btn-ghost btn-sm" aria-label=${`Xoá khoá ${e.hint}`} disabled=${busy} onClick=${() => confirm(`Xoá khoá ${e.hint} khỏi danh sách?`) && act(e.id, 'remove')}><${Icon} name="close" size=${14} /></button>` : null}
          </span></li>`; })}</ol></div>`
        : cur?.set ? html`<p class="small">Đang dùng khoá <span class="mono">${cur.hint}</span>. Thêm khoá dự phòng để bot tự đổi khi khoá này lỗi hoặc hết lượt.</p>` : null}
      ${cur?.events?.length ? html`<div class="field"><span>Lần tự đổi gần đây</span>
        <ul class="key-events">${cur.events.map((ev) => html`<li key=${ev.at}><small>${hhmm(ev.at)} — ${ev.to ? `chuyển ${ev.from} → ${ev.to}` : 'hết khoá dự phòng'} (${ev.reason})</small></li>`)}</ul></div>` : null}
      <form class="stack" onSubmit=${(e) => { e.preventDefault(); if (cur?.poolable && (pool.length || cur.set)) addBackup(); else replace(e); }}>
        <label class="field"><span>${cur?.poolable && (pool.length || cur?.set) ? 'Thêm khoá dự phòng' : 'Khoá'}</span>
          <input type="password" autocomplete="off" spellcheck="false" class="mono" value=${value} placeholder="Dán khoá dịch vụ cấp" onInput=${(e) => setValue(e.currentTarget.value)} />
          ${cur?.poolable && (pool.length || cur?.set) ? html`<input value=${label} maxlength="40" placeholder="Ghi chú (tuỳ chọn), vd. tài khoản 2" aria-label="Ghi chú cho khoá" onInput=${(e) => setLabel(e.currentTarget.value)} />` : null}
          <small class="muted">Khoá không bao giờ hiện lại — chỉ 4 ký tự cuối.</small></label>
        <${Live} error=${error} />
        <div class="dialog-actions">
          <button class="btn btn-primary" disabled=${busy || !value.trim() || !key}>${busy ? 'Đang lưu…' : cur?.poolable && (pool.length || cur?.set) ? 'Thêm vào danh sách' : 'Lưu khoá'}</button>
          ${cur?.set && !pool.length ? html`<button type="button" class="btn btn-secondary" disabled=${busy || !value.trim()} onClick=${replace}>Thay khoá đang dùng</button>` : null}
          ${cur?.set && cur.key !== 'model.api_key' ? html`<button type="button" class="btn btn-danger-outline" disabled=${busy} onClick=${remove}>Gỡ khoá</button>` : null}
        </div>
      </form>
    </div>
  <//>`;
}

function Keys({ onRestart }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [tests, setTests] = useState({});
  const [open, setOpen] = useState(null); // { row } | { row: null } (thêm)
  const [msg, setMsg] = useState({});
  useEffect(() => { api('/api/admin/ai/keys').then(setData).catch((e) => setMsg({ error: e.message })); }, []);
  async function test(row) {
    setBusy(row.key); setTests((t) => ({ ...t, [row.key]: null }));
    try { const r = await api(`/api/admin/ai/keys/${encodeURIComponent(row.key)}/test`, { method: 'POST' }); setTests((t) => ({ ...t, [row.key]: r })); } catch (e) { setTests((t) => ({ ...t, [row.key]: { ok: false, detail: e.message } })); } finally { setBusy(''); }
  }
  // keepOpen: thao tác trong danh sách khoá — giữ cửa sổ mở, chỉ cập nhật trang.
  const saved = (r, text, keepOpen = false) => { setData(r); if (!keepOpen) setOpen(null); setMsg({ ok: text }); setTests({}); onRestart(); };
  if (!data) return html`<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  const n = fold(q).trim();
  const rows = data.keys.filter((k) => !n || fold(`${k.label} ${k.feature} ${k.key}`).includes(n));
  const known = rows.filter((k) => k.known);
  const others = rows.filter((k) => !k.known);
  const line = (k) => html`<li key=${k.key} class="row-item">
    <span class="row-main"><strong>${k.label}</strong><small class="muted">${k.feature || k.key}</small></span>
    <span class=${`badge ${k.set ? 'badge-ok' : 'badge-idle'}`}>${k.set ? `Đã đặt ${k.hint}` : 'Chưa đặt'}</span>
    ${k.pool?.length > 1 ? html`<span class="badge badge-idle" title="Tự đổi sang khoá kế khi lỗi hoặc hết lượt">${k.pool.length} khoá · tự đổi</span>` : null}
    ${k.pool?.some((e) => e.coolUntil) ? html`<span class="badge badge-warn">${k.pool.filter((e) => e.coolUntil).length} khoá đang nghỉ</span>` : null}
    ${k.testable && k.set ? html`<button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => test(k)}>${busy === k.key ? 'Đang kiểm…' : 'Kiểm tra'}</button>` : null}
    ${k.editable ? html`<button type="button" class="btn btn-secondary btn-sm" aria-label=${`Quản lý khoá ${k.label}`} onClick=${() => setOpen({ row: k })}>${k.set ? 'Quản lý khoá' : 'Đặt khoá'}</button>` : null}
    ${tests[k.key] ? html`<p class=${`ai-result row-full ${tests[k.key].ok ? 'is-ok' : 'is-bad'}`} role="status">${resultText(tests[k.key])}</p>` : null}
  </li>`;
  return html`<${Live} error=${msg.error} ok=${msg.ok} />
    <div class="toolbar"><label class="sr-only" for="key-q">Tìm khoá</label>
      <input id="key-q" type="search" placeholder="Tìm theo dịch vụ, tính năng…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      ${data.available.length ? html`<button type="button" class="btn btn-primary btn-sm" onClick=${() => setOpen({ row: null })}><${Icon} name="plus" size=${14} /> Thêm khoá dịch vụ</button>` : null}</div>
    <ul class="row-list">${known.map(line)}</ul>
    ${others.length ? html`<h3>Khoá khác <small class="muted">${others.length}</small></h3><ul class="row-list">${others.map(line)}</ul>` : null}
    <p class="muted small"><${Icon} name="info" size=${14} /> Mỗi dịch vụ có thể có nhiều khoá: khi khoá đang dùng báo lỗi hoặc hết lượt, bot tự chuyển sang khoá kế (khoá lỗi nghỉ 1 giờ, khoá sai nghỉ 1 ngày) — không cần khởi động lại. "Kiểm tra" gọi thử dịch vụ (Tavily/Exa tính một lượt tìm). Khoá chỉ hiện 4 ký tự cuối; Nhật ký chỉ ghi tên khoá.</p>
    ${open ? html`<${KeyDialog} row=${open.row} available=${data.available} onSaved=${saved} onClose=${() => setOpen(null)} />` : null}`;
}

const TAB_KEY = 'zd-ai-tab';
const TABS = ['models', 'keys', 'free'];
export function Ai() {
  const [tab, setTab] = useState(() => { try { const t = localStorage.getItem(TAB_KEY); return TABS.includes(t) ? t : 'models'; } catch { return 'models'; } });
  const [rev, setRev] = useState(0);
  const pick = (t) => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* tiện ích */ } };
  return html`<${PageHead} title="Khoá API & Model" sub="Bot đang dùng model AI nào cho từng việc, và các khoá dịch vụ đã cài. Chỉ Quản trị." />
    <${RestartBanner} version=${rev} />
    <section class="card">
      <div class="chips" role="group" aria-label="Mục">
        <button type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${tab === 'models' ? 'true' : 'false'} onClick=${() => pick('models')}>Model AI</button>
        <button type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${tab === 'keys' ? 'true' : 'false'} onClick=${() => pick('keys')}>Khoá API</button>
        <button type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${tab === 'free' ? 'true' : 'false'} onClick=${() => pick('free')}>API miễn phí</button>
      </div>
      ${tab === 'models' ? html`<${Models} onRestart=${() => setRev((r) => r + 1)} />`
        : tab === 'free' ? html`<${FreeApis} />`
        : html`<${Keys} onRestart=${() => setRev((r) => r + 1)} />`}
    </section>`;
}
