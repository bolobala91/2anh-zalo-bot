import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live } from '../ui.js';

const RESEND_SECONDS = 60;

export function AuthCard({ brand, title, sub, children }) {
  return html`<main class="auth">
    <div class="auth-card">
      <div class="auth-brand"><span class="logo" aria-hidden="true"><${Icon} name="bot" size=${22} /></span><span>${brand}</span></div>
      <h1>${title}</h1>
      ${sub ? html`<p class="muted">${sub}</p>` : null}
      ${children}
    </div>
  </main>`;
}

export function Login({ brand, onDone }) {
  const [step, setStep] = useState('user'); // user → code | password
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  const focusRef = useRef(null);

  useEffect(() => { focusRef.current?.focus(); }, [step]);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function start(e) {
    e?.preventDefault();
    if (!username.trim()) { setError('Nhập tên đăng nhập trước.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api('/api/auth/start', { method: 'POST', body: { username: username.trim() } });
      setMessage(r.message || ''); setCode(''); setWait(RESEND_SECONDS);
      if (step === 'user') setStep('code');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function verify(e) {
    e.preventDefault();
    const body = step === 'code' ? { username: username.trim(), code: code.trim() } : { username: username.trim(), password };
    if (step === 'code' && !/^\d{6}$/.test(body.code)) { setError('Mã gồm đúng 6 chữ số — kiểm tra lại tin nhắn Zalo.'); return; }
    if (step === 'password' && !password) { setError('Nhập mật khẩu trước.'); return; }
    setBusy(true); setError('');
    try {
      await api('/api/auth/verify', { method: 'POST', body });
      await onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  const switchTo = (s) => { setStep(s); setError(''); };
  const back = () => { setStep('user'); setError(''); setCode(''); setPassword(''); };

  if (step === 'user') {
    return html`<${AuthCard} brand=${brand} title="Đăng nhập" sub="Quản lý bot Zalo của bạn.">
      <form onSubmit=${start} novalidate>
        <div class="field">
          <label for="login-user">Tên đăng nhập</label>
          <input id="login-user" ref=${focusRef} autocomplete="username" autocapitalize="none" spellcheck="false"
            value=${username} onInput=${(e) => setUsername(e.currentTarget.value)} />
        </div>
        <${Live} error=${error} />
        <button class="btn btn-primary btn-block" disabled=${busy}>${busy ? 'Đang xử lý…' : 'Tiếp tục'}</button>
      </form>
    <//>`;
  }

  const isCode = step === 'code';
  return html`<${AuthCard} brand=${brand} title=${isCode ? 'Nhập mã đăng nhập' : 'Nhập mật khẩu'}>
    <p class="who">
      <span><${Icon} name="user" size=${16} /> <strong>${username.trim()}</strong></span>
      <button type="button" class="link" onClick=${back}>Đổi tên đăng nhập</button>
    </p>
    ${isCode && message ? html`<p class="hint" role="status"><${Icon} name="info" size=${16} /> ${message}</p>` : null}
    <form onSubmit=${verify} novalidate>
      ${isCode ? html`
        <div class="field">
          <label for="login-code">Mã đã gửi qua Zalo của bạn</label>
          <input id="login-code" ref=${focusRef} class="code-input" inputmode="numeric" autocomplete="one-time-code"
            maxlength="6" placeholder="••••••" value=${code}
            onInput=${(e) => setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} />
        </div>` : html`
        <div class="field">
          <label for="login-pass">Mật khẩu</label>
          <input id="login-pass" ref=${focusRef} type="password" autocomplete="current-password"
            value=${password} onInput=${(e) => setPassword(e.currentTarget.value)} />
        </div>`}
      <${Live} error=${error} />
      <button class="btn btn-primary btn-block" disabled=${busy}>${busy ? 'Đang kiểm tra…' : 'Đăng nhập'}</button>
    </form>
    <div class="auth-alt">
      ${isCode ? html`
        <button type="button" class="btn btn-ghost" disabled=${busy || wait > 0} onClick=${start}>
          ${wait > 0 ? `Gửi lại mã sau ${wait} giây` : 'Gửi lại mã'}</button>
        <button type="button" class="btn btn-ghost" onClick=${() => switchTo('password')}><${Icon} name="key" size=${16} /> Dùng mật khẩu</button>`
      : html`<button type="button" class="btn btn-ghost" onClick=${() => switchTo('code')}><${Icon} name="phone" size=${16} /> Dùng mã Zalo</button>`}
    </div>
  <//>`;
}
