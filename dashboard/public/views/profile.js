import { useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, PageHead, roleLabel } from '../ui.js';

export function Profile({ me, status }) {
  const [busy, setBusy] = useState('');
  const [tg, setTg] = useState({});
  const [linkUrl, setLinkUrl] = useState('');
  const [sessionMsg, setSessionMsg] = useState({});

  async function run(key, fn, setMsg) {
    setBusy(key); setMsg({});
    try { await fn(); } catch (err) { setMsg({ error: err.message }); } finally { setBusy(''); }
  }
  const link = () => run('link', async () => {
    const r = await api('/api/telegram/link', { method: 'POST' });
    setLinkUrl(r.url);
    window.open(r.url, '_blank', 'noopener');
    setTg({ ok: 'Đã mở Telegram — bấm "Start" (Bắt đầu) trong cuộc trò chuyện với bot để hoàn tất. Link dùng được trong 10 phút.' });
  }, setTg);
  const test = () => run('test', async () => {
    await api('/api/telegram/test', { method: 'POST' });
    setTg({ ok: 'Đã gửi tin thử — mở Telegram để kiểm tra.' });
  }, setTg);
  const logout = (all) => {
    if (all && !confirm('Đăng xuất khỏi mọi thiết bị đang đăng nhập tài khoản này?')) return;
    run(all ? 'all' : 'one', async () => {
      await api(all ? '/api/auth/logout-all' : '/api/auth/logout', { method: 'POST' });
      window.dispatchEvent(new Event('zd:logout'));
    }, setSessionMsg);
  };

  const linked = Boolean(status?.telegramLinked);
  return html`
    <${PageHead} title="Tài khoản của tôi" />
    <div class="grid grid-2">
      <section class="card account">
        <span class="avatar avatar-lg" aria-hidden="true">${me.username.slice(0, 1).toUpperCase()}</span>
        <div class="account-info">
          <h2>${me.username}</h2>
          <p class="muted">${roleLabel(me.role)}${me.zaloUid ? html` · UID Zalo <span class="mono">${me.zaloUid}</span>` : ' · Chưa có UID Zalo'}</p>
        </div>
        <div class="row">
          <button class="btn btn-secondary" disabled=${!!busy} onClick=${() => logout(false)}><${Icon} name="logout" size=${16} /> Đăng xuất</button>
          <button class="btn btn-danger-outline" disabled=${!!busy} onClick=${() => logout(true)}>Đăng xuất mọi nơi</button>
        </div>
        <${Live} error=${sessionMsg.error} />
      </section>
      <section class="card">
        <h2>Cảnh báo qua Telegram</h2>
        ${!status ? html`<p class="muted">Đang kiểm tra…</p>`
          : linked ? html`<p class="badge badge-ok"><${Icon} name="check" size=${16} /> Đã nối — bạn sẽ nhận tin khi bot gặp sự cố</p>`
            : html`<p class="badge badge-warn"><${Icon} name="warn" size=${16} /> Chưa nối — bạn chưa nhận được cảnh báo</p>`}
        <div class="row">
          <button class="btn btn-primary" disabled=${!!busy} onClick=${link}><${Icon} name="external" size=${16} />
            ${linked ? 'Nối lại Telegram' : 'Nối Telegram của tôi'}</button>
          <button class="btn btn-secondary" disabled=${!!busy || !linked} onClick=${test}><${Icon} name="send" size=${16} /> Gửi thử</button>
        </div>
        ${linkUrl && !linked ? html`<p class="small muted">Telegram chưa mở? <a href=${linkUrl} target="_blank" rel="noopener noreferrer">Bấm vào đây để mở</a>.</p>` : null}
        <${Live} error=${tg.error} ok=${tg.ok} />
      </section>
    </div>`;
}
