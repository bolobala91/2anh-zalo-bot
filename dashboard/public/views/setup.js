import { useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Live } from '../ui.js';
import { AuthCard } from './login.js';

export function Setup({ brand, token, onDone }) {
  const [f, setF] = useState({ username: '', zaloUid: '', password: '', password2: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bind = (k) => ({ value: f[k], onInput: (e) => setF({ ...f, [k]: e.currentTarget.value }) });

  async function submit(e) {
    e.preventDefault();
    if (f.password.length < 8) { setError('Mật khẩu cần ít nhất 8 ký tự — nhập lại mật khẩu dài hơn.'); return; }
    if (f.password !== f.password2) { setError('Hai lần nhập mật khẩu chưa khớp — nhập lại cho giống nhau.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api('/api/auth/setup', { method: 'POST', body: { token, username: f.username.trim(), zaloUid: f.zaloUid.trim(), password: f.password } });
      onDone(r.user);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return html`<${AuthCard} brand=${brand} title="Tạo tài khoản Quản trị"
    sub="Đây là tài khoản đầu tiên, có toàn quyền với dashboard. Link này chỉ dùng được một lần.">
    <form onSubmit=${submit} novalidate>
      <div class="field">
        <label for="su-user">Tên đăng nhập</label>
        <input id="su-user" autocomplete="username" autocapitalize="none" spellcheck="false" aria-describedby="su-user-help" ...${bind('username')} />
        <small id="su-user-help">3–32 ký tự: chữ thường, số, dấu . _ -</small>
      </div>
      <div class="field">
        <label for="su-uid">UID Zalo của bạn <span class="muted">(không bắt buộc)</span></label>
        <input id="su-uid" inputmode="numeric" aria-describedby="su-uid-help" ...${bind('zaloUid')} />
        <small id="su-uid-help">Dãy 15–22 chữ số. Có UID thì đăng nhập được bằng mã gửi qua Zalo.</small>
      </div>
      <div class="field">
        <label for="su-pass">Mật khẩu</label>
        <input id="su-pass" type="password" autocomplete="new-password" aria-describedby="su-pass-help" ...${bind('password')} />
        <small id="su-pass-help">Ít nhất 8 ký tự.</small>
      </div>
      <div class="field">
        <label for="su-pass2">Nhập lại mật khẩu</label>
        <input id="su-pass2" type="password" autocomplete="new-password" ...${bind('password2')} />
      </div>
      <${Live} error=${error} />
      <button class="btn btn-primary btn-block" disabled=${busy}>${busy ? 'Đang tạo…' : 'Tạo tài khoản'}</button>
    </form>
  <//>`;
}
