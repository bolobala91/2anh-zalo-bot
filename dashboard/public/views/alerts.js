import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, PageHead, Spinner } from '../ui.js';

export function Alerts() {
  const [cfg, setCfg] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});

  useEffect(() => {
    api('/api/admin/telegram').then(setCfg).catch((err) => setLoadError(err.message));
  }, []);

  async function save(body, okText) {
    setBusy(true); setMsg({});
    try { setCfg(await api('/api/admin/telegram', { method: 'PUT', body })); setToken(''); setMsg({ ok: okText }); } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }
  const submit = (e) => {
    e.preventDefault();
    if (!token.trim()) { setMsg({ error: 'Dán token bot lấy từ @BotFather vào ô trước khi lưu.' }); return; }
    save({ token: token.trim() }, 'Đã lưu bot cảnh báo. Mỗi người vào "Tài khoản của tôi" để nối Telegram của mình.');
  };
  const remove = () => {
    if (!confirm('Gỡ bot cảnh báo? Mọi người đã nối sẽ phải nối lại khi cài bot mới.')) return;
    save({}, 'Đã gỡ bot cảnh báo.');
  };

  const head = html`<${PageHead} title="Cảnh báo Telegram" sub="Gửi tin Telegram cho Quản trị và Chủ bot khi bot Zalo gặp sự cố." />`;
  if (loadError) return html`${head}<section class="card"><${Live} error=${loadError} /></section>`;
  if (!cfg) return html`${head}<${Spinner} />`;
  const configured = Boolean(cfg.tokenMasked);

  return html`${head}
    <div class="grid grid-2">
      <section class="card">
        <h2>Bot gửi cảnh báo</h2>
        ${configured ? html`
          <p class="badge badge-ok"><${Icon} name="check" size=${16} /> Đã cài${cfg.botUsername ? html` — <strong>@${cfg.botUsername}</strong>` : null}</p>
          <dl class="facts"><div><dt>Token</dt><dd class="mono">${cfg.tokenMasked}</dd></div></dl>`
        : html`<p class="badge badge-warn"><${Icon} name="warn" size=${16} /> Chưa cài bot — chưa ai nhận được cảnh báo</p>`}
        <form onSubmit=${submit} novalidate>
          <div class="field">
            <label for="tg-token">${configured ? 'Đổi sang token mới' : 'Token bot'}</label>
            <input id="tg-token" type="password" autocomplete="off" spellcheck="false" placeholder="123456789:ABC…"
              aria-describedby="tg-token-help" value=${token} onInput=${(e) => setToken(e.currentTarget.value)} />
            <small id="tg-token-help">Tạo một bot riêng cho cảnh báo bằng @BotFather trên Telegram (lệnh /newbot), rồi dán token vào đây.</small>
          </div>
          <${Live} error=${msg.error} ok=${msg.ok} />
          <div class="row">
            <button class="btn btn-primary" disabled=${busy}>${busy ? 'Đang kiểm tra…' : 'Lưu'}</button>
            ${configured ? html`<button type="button" class="btn btn-danger-outline" disabled=${busy} onClick=${remove}>Gỡ bot</button>` : null}
          </div>
        </form>
      </section>
      <section class="card">
        <h2>Người đã nối</h2>
        ${cfg.linkedUsers.length ? html`<ul class="list">
          ${cfg.linkedUsers.map((u) => html`<li key=${u}><span class="avatar avatar-sm" aria-hidden="true">${u.slice(0, 1).toUpperCase()}</span> ${u}</li>`)}
        </ul>` : html`<p class="muted">Chưa ai nối Telegram.</p>`}
        <p class="muted small">Mỗi người tự nối và gửi tin thử trong <a href="#/profile">Tài khoản của tôi</a>.</p>
      </section>
    </div>`;
}
