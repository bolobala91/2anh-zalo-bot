// Kết nối MCP (spec §18.6, chỉ Quản trị): dịch vụ bên ngoài trợ lý dùng làm công cụ. Xem, bật/tắt, kiểm tra thật
// (liệt kê công cụ), chọn công cụ, đăng nhập lại, gỡ; thêm từ danh mục của Hermes (một lần bấm) hoặc theo địa chỉ https.
import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Dialog, Icon, Live, Notice, PageHead, Spinner } from '../ui.js';
import { fold } from '../fold.js';
import { RestartBanner } from './restart-banner.js';

/** Màu nhãn trạng thái. */
export function mcpKind(status) {
  return { 'Đang mở': 'ok', 'Chạy cùng trợ lý — không kiểm được từ dashboard': 'idle', 'Không phản hồi': 'danger', 'Đã tắt': 'idle' }[status] || 'warn';
}

export const AUTH_LABEL = { oauth: 'Đăng nhập tài khoản', key: 'Khoá (token)', none: 'Không cần đăng nhập', api_key: 'Khoá (token)' };

/** Câu kết quả kiểm tra kết nối. */
export function testText(t) {
  if (!t) return '';
  if (t.needsLogin) return 'Chưa đăng nhập — bấm Đăng nhập.';
  if (!t.connected) return `Không kết nối được: ${t.error || 'không rõ lý do'}`;
  const on = t.tools.filter((x) => x.enabled).length;
  return t.tools.length === on ? `Kết nối được — ${on} công cụ.` : `Kết nối được — dùng ${on}/${t.tools.length} công cụ.`;
}

/** Kết nối đang tắt bớt công cụ (exclude) hoặc chỉ dùng một số (include) → có nút "Bật hết công cụ". */
export const someToolsOff = (s) => Boolean(s.toolsOff) || (s.toolsOnly !== null && s.toolsOnly !== undefined);

const restartNote = 'Khởi động lại trợ lý để áp dụng.';

/** Chọn công cụ của một kết nối: kiểm tra thật rồi bật/tắt từng công cụ. */
function ToolsDialog({ server, onSaved, onClose }) {
  const [test, setTest] = useState(null);
  const [off, setOff] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/api/admin/mcp/${encodeURIComponent(server.name)}/test`, { method: 'POST' })
      .then((t) => { setTest(t); setOff(new Set(t.tools.filter((x) => !x.enabled).map((x) => x.name))); }).catch((e) => setError(e.message));
  }, [server.name]);
  const flip = (n, on) => setOff((s) => { const d = new Set(s); if (on) d.delete(n); else d.add(n); return d; });
  async function save() {
    setBusy(true); setError('');
    try { await api(`/api/admin/mcp/${encodeURIComponent(server.name)}/tools`, { method: 'PUT', body: { disabled: [...off] } }); onSaved(`Đã lưu công cụ của ${server.name}. ${restartNote}`); } catch (e) { setError(e.message); setBusy(false); }
  }
  return html`<${Dialog} title=${`Công cụ — ${server.name}`} onClose=${onClose} wide>
    <div class="stack">
      ${!test && !error ? html`<${Spinner} label="Đang kết nối thử…" />` : null}
      ${test ? html`<p class=${`ai-result ${test.connected ? 'is-ok' : 'is-bad'}`}>${testText(test)}</p>` : null}
      ${test?.tools?.length ? html`<div class="toolbar"><button type="button" class="btn btn-ghost btn-sm" onClick=${() => setOff(new Set())}>Bật hết</button>
          <button type="button" class="btn btn-ghost btn-sm" onClick=${() => setOff(new Set(test.tools.map((x) => x.name)))}>Tắt hết</button></div>
        <ul class="row-list">${test.tools.map((t) => html`<li key=${t.name} class="row-item">
          <label class="check row-main"><input type="checkbox" checked=${!off.has(t.name)} onChange=${(e) => flip(t.name, e.currentTarget.checked)} />
            <span><strong class="mono">${t.name}</strong><small class="clamp-2">${t.description}</small></span></label></li>`)}</ul>` : null}
      <${Live} error=${error} />
      ${test?.tools?.length ? html`<div class="dialog-actions"><button type="button" class="btn btn-primary" disabled=${busy} onClick=${save}>${busy ? 'Đang lưu…' : 'Lưu lựa chọn'}</button></div>` : null}
    </div>
  <//>`;
}

/** Đăng nhập OAuth: mở trang của dịch vụ ở tab mới, chờ dịch vụ chuyển về dashboard. */
function LoginDialog({ server, onDone, onClose }) {
  const [flow, setFlow] = useState(null);
  const [state, setState] = useState({ status: 'starting' });
  const timer = useRef(0);
  useEffect(() => {
    let live = true;
    api(`/api/admin/mcp/${encodeURIComponent(server.name)}/oauth`, { method: 'POST' })
      .then((f) => { if (!live) return; setFlow(f); setState({ status: 'pending' }); })
      .catch((e) => live && setState({ status: 'error', error: e.message }));
    return () => { live = false; clearTimeout(timer.current); };
  }, [server.name]);
  // Đóng hộp khi còn chờ → huỷ để máy chủ thôi giữ lần đăng nhập này.
  const latest = useRef({});
  latest.current = { flow, status: state.status };
  useEffect(() => () => { const { flow: f, status } = latest.current; if (f && status === 'pending') api(`/api/admin/mcp/oauth/${f.flowId}`, { method: 'DELETE' }).catch(() => {}); }, []);
  useEffect(() => {
    if (!flow || state.status !== 'pending') return undefined;
    timer.current = setTimeout(() => api(`/api/admin/mcp/oauth/${flow.flowId}`).then((s) => {
      setState(s);
      if (s.status === 'done') onDone(`Đã đăng nhập ${server.name}${s.tools ? ` — ${s.tools} công cụ` : ''}. ${restartNote}`);
    }).catch((e) => setState({ status: 'error', error: e.message })), 2000);
    return () => clearTimeout(timer.current);
  }, [flow, state]);
  return html`<${Dialog} title=${`Đăng nhập — ${server.name}`} onClose=${onClose}>
    <div class="stack">
      ${state.status === 'starting' ? html`<${Spinner} label="Đang chuẩn bị trang đăng nhập…" />` : null}
      ${state.status === 'pending' && flow ? html`<p class="small">Bấm nút dưới để mở trang đăng nhập của dịch vụ (tab mới). Đăng nhập và cho phép truy cập — dịch vụ sẽ chuyển về dashboard, cửa sổ này tự báo khi xong.</p>
        <a class="btn btn-primary" href=${flow.url} target="_blank" rel="noopener noreferrer"><${Icon} name="external" size=${16} /> Mở trang đăng nhập</a>
        <p class="muted small">Đang chờ… (tối đa 5 phút)</p>` : null}
      <${Live} error=${state.status === 'error' ? state.error : ''} />
    </div>
  <//>`;
}

/** Thêm kết nối: danh mục Hermes hoặc địa chỉ https riêng. */
function AddDialog({ onAdded, onClose }) {
  const [tab, setTab] = useState('catalog');
  const [catalog, setCatalog] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState('');
  const [env, setEnv] = useState({});
  const [form, setForm] = useState({ name: '', url: '', auth: 'none', token: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/admin/mcp-catalog').then((r) => setCatalog(r.entries)).catch((e) => setError(e.message)); }, []);
  async function install(e) {
    setBusy(true); setError('');
    try { await api('/api/admin/mcp-catalog/install', { method: 'POST', body: { name: e.name, env } });
      onAdded(`Đã thêm ${e.name}.${e.auth === 'oauth' ? ' Bấm Đăng nhập ở kết nối này để cấp quyền.' : ''} ${restartNote}`, e.auth === 'oauth' ? e.name : ''); } catch (err) { setError(err.message); setBusy(false); }
  }
  async function addCustom(ev) {
    ev.preventDefault(); setBusy(true); setError('');
    try { await api('/api/admin/mcp-add', { method: 'POST', body: form });
      onAdded(`Đã thêm ${form.name}.${form.auth === 'oauth' ? ' Bấm Đăng nhập ở kết nối này để cấp quyền.' : ''} ${restartNote}`, form.auth === 'oauth' ? form.name : ''); } catch (err) { setError(err.message); setBusy(false); }
  }
  const n = fold(q).trim();
  const shown = (catalog || []).filter((e) => !n || fold(`${e.name} ${e.description}`).includes(n));
  const set = (k) => (ev) => setForm({ ...form, [k]: ev.currentTarget.value });
  return html`<${Dialog} title="Thêm kết nối MCP" onClose=${onClose} dirty=${() => !busy && (Boolean(form.url) || Object.values(env).some(Boolean))} wide>
    <div class="stack">
      <div class="chips" role="group" aria-label="Cách thêm">
        <button type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${tab === 'catalog' ? 'true' : 'false'} onClick=${() => setTab('catalog')}>Danh mục có sẵn</button>
        <button type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${tab === 'url' ? 'true' : 'false'} onClick=${() => setTab('url')}>Địa chỉ riêng</button>
      </div>
      <${Live} error=${error} />
      ${tab === 'catalog' ? html`
        <input type="search" aria-label="Tìm kết nối" placeholder="Tìm: notion, linear, google…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
        ${!catalog && !error ? html`<${Spinner} />` : null}
        <ul class="row-list">${shown.map((e) => html`<li key=${e.name} class="row-item mcp-cat">
          <span class="row-main"><strong>${e.name}</strong><small class="clamp-2">${e.description}</small>
            <small class="muted">${AUTH_LABEL[e.auth] || e.auth}${e.transport === 'stdio' ? ' · chạy trên máy chủ' : ''}</small></span>
          ${e.installed ? html`<span class="badge badge-ok">Đã thêm</span>`
            : e.needsBuild ? html`<small class="muted">Cần người cài đặt chạy <span class="mono">hermes mcp install ${e.name}</span></small>`
            : html`<button type="button" class="btn btn-secondary btn-sm" disabled=${busy} onClick=${() => { setOpen(open === e.name ? '' : e.name); setEnv({}); }}>${open === e.name ? 'Đóng' : 'Thêm'}</button>`}
          ${open === e.name ? html`<div class="stack mcp-cat-form">
            <p class="muted small">Sẽ ${e.transport === 'http' ? 'kết nối tới' : 'chạy'}: <span class="mono">${e.runs}</span></p>
            ${e.env.map((v) => html`<label key=${v.name} class="field"><span>${v.prompt || v.name}${v.required ? '' : ' (tuỳ chọn)'}</span>
              <input type=${v.secret ? 'password' : 'text'} autocomplete="off" spellcheck="false" placeholder=${v.isSet ? 'Đã có — để trống để giữ' : ''} value=${env[v.name] || ''} onInput=${(ev) => setEnv({ ...env, [v.name]: ev.currentTarget.value })} /></label>`)}
            ${e.postInstall ? html`<details><summary class="small">Hướng dẫn của dịch vụ</summary><p class="muted small mem-text">${e.postInstall}</p></details>` : null}
            <div class="dialog-actions"><button type="button" class="btn btn-primary" disabled=${busy} onClick=${() => install(e)}>${busy ? 'Đang thêm…' : `Thêm ${e.name}`}</button></div>
          </div>` : null}
        </li>`)}</ul>` : html`
        <form class="stack" onSubmit=${addCustom}>
          <label class="field"><span>Tên ngắn</span><input value=${form.name} maxlength="64" placeholder="vd. tai-lieu-truong" onInput=${set('name')} required /></label>
          <label class="field"><span>Địa chỉ MCP</span><input type="url" value=${form.url} placeholder="https://…/mcp" onInput=${set('url')} required /></label>
          <label class="field"><span>Cách đăng nhập</span><select value=${form.auth} onChange=${set('auth')}>
            <option value="none">Không cần</option><option value="oauth">Đăng nhập tài khoản (OAuth)</option><option value="bearer">Khoá (token)</option></select></label>
          ${form.auth === 'bearer' ? html`<label class="field"><span>Khoá</span><input type="password" autocomplete="off" spellcheck="false" value=${form.token} onInput=${set('token')} required />
            <small class="muted">Lưu trong .env của trợ lý, không hiện lại.</small></label>` : null}
          <div class="dialog-actions"><button class="btn btn-primary" disabled=${busy}>${busy ? 'Đang thêm…' : 'Thêm kết nối'}</button></div>
        </form>`}
    </div>
  <//>`;
}

export function Mcp() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState('');
  const [version, setVersion] = useState(0);
  const [tests, setTests] = useState({});
  const [dialog, setDialog] = useState(null); // { kind: 'add'|'tools'|'login', server }
  const load = () => api('/api/admin/mcp').then(setData).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { load(); }, []);
  const done = (text) => { setDialog(null); setMsg({ ok: text }); setVersion((v) => v + 1); load(); };
  async function toggle(s) {
    const enabled = !s.enabled;
    if (!confirm(`${enabled ? 'Bật' : 'Tắt'} kết nối ${s.name}? Cần khởi động lại trợ lý để áp dụng.`)) return;
    setBusy(s.name); setMsg({});
    try { setData(await api(`/api/admin/mcp/${encodeURIComponent(s.name)}`, { method: 'PUT', body: { enabled } })); setVersion((v) => v + 1); } catch (e) { setMsg({ error: e.message }); } finally { setBusy(''); }
  }
  async function test(s) {
    setTests((t) => ({ ...t, [s.name]: 'busy' }));
    try { const r = await api(`/api/admin/mcp/${encodeURIComponent(s.name)}/test`, { method: 'POST' }); setTests((t) => ({ ...t, [s.name]: r })); } catch (e) { setTests((t) => ({ ...t, [s.name]: { connected: false, error: e.message, tools: [] } })); }
  }
  async function allToolsOn(s) {
    if (!confirm(`Bật hết công cụ của ${s.name}? Cần khởi động lại trợ lý để áp dụng.`)) return;
    setBusy(s.name); setMsg({});
    try { await api(`/api/admin/mcp/${encodeURIComponent(s.name)}/tools`, { method: 'PUT', body: { disabled: [] } }); done(`Đã bật hết công cụ của ${s.name}. ${restartNote}`); } catch (e) { setMsg({ error: e.message }); } finally { setBusy(''); }
  }
  async function remove(s) {
    if (!confirm(`Gỡ hẳn kết nối ${s.name}? Trợ lý sẽ mất các công cụ của nó.`)) return;
    setBusy(s.name); setMsg({});
    try { setData(await api(`/api/admin/mcp/${encodeURIComponent(s.name)}/remove`, { method: 'POST' })); setMsg({ ok: `Đã gỡ ${s.name}. ${restartNote}` }); setVersion((v) => v + 1); } catch (e) { setMsg({ error: e.message }); } finally { setBusy(''); }
  }
  const list = data?.servers;
  return html`<${PageHead} title="Kết nối MCP" sub="Dịch vụ bên ngoài trợ lý dùng làm công cụ (tra tài liệu, lịch, tệp…). Chỉ Quản trị." />
    <${RestartBanner} version=${version} />
    <section class="card">
      <div class="toolbar">${data?.manage ? html`<button type="button" class="btn btn-primary btn-sm" onClick=${() => setDialog({ kind: 'add' })}><${Icon} name="plus" size=${16} /> Thêm kết nối</button>` : null}</div>
      ${data && !data.manage ? html`<${Notice} kind="info">Máy này chưa tìm thấy Python của Hermes nên chỉ bật/tắt được. Người cài đặt đặt ZALO_HERMES_PYTHON trong .env của sidecar.<//>` : null}
      <${Live} error=${msg.error} ok=${msg.ok} />
      ${!list && !msg.error ? html`<${Spinner} />` : null}
      ${list && !list.length ? html`<p class="muted">Trợ lý chưa có kết nối MCP nào. Bấm Thêm kết nối để chọn từ danh mục.</p>` : null}
      <ul class="row-list">${(list || []).map((s) => html`<li key=${s.name} class="row-item mcp-row">
        <span class="row-main"><strong>${s.name}</strong><small class="muted mono">${s.transport === 'http' ? s.target : `lệnh: ${s.target}`}</small>
          <small class="muted">${s.publicToMembers ? 'Thành viên nhóm dùng được (ZALO_PUBLIC_MCP)' : 'Chỉ chủ nhân dùng'}${s.auth !== 'none' ? ` · ${AUTH_LABEL[s.auth]}` : ''}${s.toolsOff ? ` · tắt ${s.toolsOff} công cụ` : ''}${s.toolsOnly !== null ? ` · chỉ dùng ${s.toolsOnly} công cụ` : ''}</small>
          ${tests[s.name] === 'busy' ? html`<small class="muted">Đang kết nối thử…</small>` : tests[s.name] ? html`<small class=${`ai-result ${tests[s.name].connected ? 'is-ok' : 'is-bad'}`}>${testText(tests[s.name])}</small>` : null}</span>
        <span class=${`badge badge-${mcpKind(s.status)}`}>${s.status}</span>
        <span class="key-actions">
          ${data.manage ? html`<button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== '' || tests[s.name] === 'busy'} onClick=${() => test(s)}>Kiểm tra</button>
            <button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => setDialog({ kind: 'tools', server: s })}>Công cụ</button>
            ${someToolsOff(s) ? html`<button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => allToolsOn(s)}>Bật hết công cụ</button>` : null}
            ${s.auth === 'oauth' ? html`<button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => setDialog({ kind: 'login', server: s })}>Đăng nhập</button>` : null}` : null}
          <button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => toggle(s)}>${s.enabled ? 'Tắt' : 'Bật'}</button>
          ${data.manage ? html`<button type="button" class="btn btn-ghost btn-sm" aria-label=${`Gỡ kết nối ${s.name}`} disabled=${busy !== ''} onClick=${() => remove(s)}><${Icon} name="close" size=${14} /></button>` : null}
        </span>
      </li>`)}</ul>
    </section>
    ${dialog?.kind === 'add' ? html`<${AddDialog} onClose=${() => setDialog(null)} onAdded=${(text, loginName) => {
      done(text);
      if (loginName) setDialog({ kind: 'login', server: { name: loginName } });
    }} />` : null}
    ${dialog?.kind === 'tools' ? html`<${ToolsDialog} server=${dialog.server} onSaved=${done} onClose=${() => setDialog(null)} />` : null}
    ${dialog?.kind === 'login' ? html`<${LoginDialog} server=${dialog.server} onDone=${done} onClose=${() => setDialog(null)} />` : null}`;
}
