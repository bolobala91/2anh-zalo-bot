import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, PageHead, Spinner, fmtTime, roleLabel } from '../ui.js';

const EMPTY = { username: '', role: 'owner', zaloUid: '', password: '' };

function AddUser({ onAdded }) {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const bind = (k) => ({ value: f[k], onInput: (e) => setF({ ...f, [k]: e.currentTarget.value }) });

  async function submit(e) {
    e.preventDefault();
    if (!f.zaloUid.trim() && !f.password) { setMsg({ error: 'Cần UID Zalo hoặc mật khẩu để người này đăng nhập được — điền ít nhất một ô.' }); return; }
    setBusy(true); setMsg({});
    try {
      const r = await api('/api/admin/users', { method: 'POST', body: { ...f, username: f.username.trim(), zaloUid: f.zaloUid.trim() } });
      setF(EMPTY); setMsg({ ok: `Đã tạo tài khoản ${r.user.username} (${roleLabel(r.user.role)}).` });
      onAdded();
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }

  return html`<section class="card">
    <h2>Thêm người dùng</h2>
    <form class="form-grid" onSubmit=${submit} novalidate>
      <div class="field">
        <label for="nu-user">Tên đăng nhập</label>
        <input id="nu-user" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="nu-user-help" ...${bind('username')} />
        <small id="nu-user-help">3–32 ký tự: chữ thường, số, dấu . _ -</small>
      </div>
      <div class="field">
        <label for="nu-role">Vai trò</label>
        <select id="nu-role" ...${bind('role')}>
          <option value="owner">Chủ bot</option>
          <option value="admin">Quản trị</option>
        </select>
        <small>Chủ bot không thấy mục Quản trị.</small>
      </div>
      <div class="field">
        <label for="nu-uid">UID Zalo</label>
        <input id="nu-uid" inputmode="numeric" autocomplete="off" aria-describedby="nu-uid-help" ...${bind('zaloUid')} />
        <small id="nu-uid-help">Để đăng nhập bằng mã gửi qua Zalo.</small>
      </div>
      <div class="field">
        <label for="nu-pass">Mật khẩu <span class="muted">(không bắt buộc)</span></label>
        <input id="nu-pass" type="password" autocomplete="new-password" aria-describedby="nu-pass-help" ...${bind('password')} />
        <small id="nu-pass-help">Ít nhất 8 ký tự.</small>
      </div>
      <div class="form-actions">
        <${Live} error=${msg.error} ok=${msg.ok} />
        <button class="btn btn-primary" disabled=${busy}><${Icon} name="plus" size=${16} /> ${busy ? 'Đang tạo…' : 'Thêm người dùng'}</button>
      </div>
    </form>
  </section>`;
}

export function Users({ me }) {
  const [list, setList] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({});

  const load = () => api('/api/admin/users').then((r) => { setList(r.users); setLoadError(''); }).catch((err) => setLoadError(err.message));
  useEffect(() => { load(); }, []);

  async function patch(u, body, okText) {
    setBusy(u.username); setMsg({});
    try { await api(`/api/admin/users/${encodeURIComponent(u.username)}`, { method: 'PATCH', body }); setMsg({ ok: okText }); await load(); } catch (err) { setMsg({ error: err.message }); } finally { setBusy(''); }
  }
  const toggle = (u) => {
    if (!u.disabled && !confirm(`Khoá tài khoản ${u.username}? Người này sẽ bị đăng xuất ngay.`)) return;
    patch(u, { disabled: !u.disabled }, u.disabled ? `Đã mở khoá ${u.username}.` : `Đã khoá ${u.username}.`);
  };
  const resetPassword = (u) => {
    const pw = prompt(`Mật khẩu mới cho ${u.username} (ít nhất 8 ký tự):`);
    if (pw === null) return;
    if (pw.length < 8) { setMsg({ error: 'Mật khẩu cần ít nhất 8 ký tự — bấm "Đặt lại mật khẩu" và nhập lại.' }); return; }
    patch(u, { password: pw }, `Đã đặt mật khẩu mới cho ${u.username}. Người này cần đăng nhập lại.`);
  };

  return html`
    <${PageHead} title="Người dùng" sub="Ai được vào dashboard và với vai trò gì." />
    <section class="card">
      <h2>Danh sách</h2>
      ${loadError ? html`<${Live} error=${loadError} />` : !list ? html`<${Spinner} />` : html`
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th scope="col">Tên đăng nhập</th><th scope="col">Vai trò</th><th scope="col">UID Zalo</th>
              <th scope="col">Trạng thái</th><th scope="col">Tạo lúc</th><th scope="col"><span class="sr-only">Thao tác</span></th></tr></thead>
            <tbody>
              ${list.map((u) => html`<tr key=${u.username}>
                <td><strong>${u.username}</strong>${u.username === me.username ? html` <span class="tag">bạn</span>` : null}</td>
                <td>${roleLabel(u.role)}</td>
                <td class="mono">${u.zaloUid || html`<span class="muted">Chưa có</span>`}</td>
                <td>${u.disabled ? html`<span class="badge badge-danger"><${Icon} name="lock" size=${14} /> Đã khoá</span>`
                  : html`<span class="badge badge-ok"><${Icon} name="check" size=${14} /> Đang dùng</span>`}</td>
                <td>${fmtTime(u.createdAt)}</td>
                <td><div class="actions">
                  <button class="btn btn-secondary btn-sm" disabled=${busy === u.username || u.username === me.username}
                    title=${u.username === me.username ? 'Không thể tự khoá tài khoản đang dùng' : undefined} onClick=${() => toggle(u)}>
                    <${Icon} name=${u.disabled ? 'unlock' : 'lock'} size=${14} /> ${u.disabled ? 'Mở khoá' : 'Khoá'}</button>
                  <button class="btn btn-secondary btn-sm" disabled=${busy === u.username} onClick=${() => resetPassword(u)}>
                    <${Icon} name="key" size=${14} /> Đặt lại mật khẩu</button>
                </div></td>
              </tr>`)}
            </tbody>
          </table>
        </div>`}
      <${Live} error=${msg.error} ok=${msg.ok} />
    </section>
    <${AddUser} onAdded=${load} />`;
}
